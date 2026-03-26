/**
 * User authentication module — login, logout, sessions, invites.
 */
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

let PrismaClientCtor = null;
try { PrismaClientCtor = require("@prisma/client").PrismaClient; } catch (_) {}
let prismaClient = null;

function getPrisma() {
  if (!PrismaClientCtor) throw new Error("Prisma client not installed.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (!prismaClient) prismaClient = new PrismaClientCtor();
  return prismaClient;
}

function canUseDb() {
  return Boolean(PrismaClientCtor && process.env.DATABASE_URL);
}

const JWT_SECRET = () => process.env.JWT_SECRET || "smartdocs-dev-secret-change-me";
const JWT_EXPIRY = () => process.env.JWT_EXPIRY || "7d";
const BCRYPT_ROUNDS = 12;

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── Login ──

async function login(email, password) {
  const prisma = getPrisma();
  email = (email || "").trim().toLowerCase();
  if (!email || !password) throw Object.assign(new Error("Email and password are required."), { statusCode: 400 });

  // Find user across all tenants by email (unique per tenant, so we need tenant context)
  // For now, find any active user with this email
  const user = await prisma.user.findFirst({
    where: { email, active: true },
    include: { tenant: { select: { id: true, name: true, slug: true, active: true } } }
  });

  if (!user) throw Object.assign(new Error("Invalid email or password."), { statusCode: 401 });
  if (!user.tenant || !user.tenant.active) throw Object.assign(new Error("Tenant is inactive."), { statusCode: 403 });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw Object.assign(new Error("Invalid email or password."), { statusCode: 401 });

  // Create session
  const sessionToken = generateToken();
  const expiresAt = new Date(Date.now() + parseExpiry(JWT_EXPIRY()));

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      expiresAt
    }
  });

  // Sign JWT
  const token = jwt.sign(
    { sessionToken, userId: user.id, tenantId: user.tenantId, role: user.role },
    JWT_SECRET(),
    { expiresIn: JWT_EXPIRY() }
  );

  return {
    token,
    user: { id: user.id, tenantId: user.tenantId, email: user.email, name: user.name, role: user.role, tenantName: user.tenant.name }
  };
}

// ── Logout ──

async function logout(sessionToken) {
  if (!sessionToken) return;
  const prisma = getPrisma();
  const tokenHash = hashToken(sessionToken);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

// ── Validate Session ──

async function validateSession(jwtToken) {
  if (!jwtToken) return null;
  try {
    const payload = jwt.verify(jwtToken, JWT_SECRET());
    const prisma = getPrisma();
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(payload.sessionToken) },
      include: {
        user: {
          select: { id: true, tenantId: true, email: true, name: true, role: true, active: true }
        }
      }
    });
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } });
      return null;
    }
    if (!session.user || !session.user.active) return null;
    return session.user;
  } catch (_) {
    return null;
  }
}

// ── Session Middleware ──

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = decodeURIComponent(v.join("="));
  });
  return cookies;
}

async function authenticateSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.smartdocs_session;
  if (!token) return null;
  return validateSession(token);
}

// ── Invite ──

async function createInvite(tenantId, email, role, invitedBy, projectIds) {
  const prisma = getPrisma();
  email = (email || "").trim().toLowerCase();
  if (!email) throw Object.assign(new Error("Email is required."), { statusCode: 400 });

  // Check if user already exists in this tenant
  const existing = await prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
  if (existing) throw Object.assign(new Error("User already exists in this tenant."), { statusCode: 409 });

  // Check for pending invite
  const pendingInvite = await prisma.invite.findFirst({
    where: { tenantId, email, status: "PENDING" }
  });
  if (pendingInvite) throw Object.assign(new Error("Pending invite already exists for this email."), { statusCode: 409 });

  const plainToken = generateToken();
  const invite = await prisma.invite.create({
    data: {
      tenantId,
      email,
      role: role || "AUTHOR",
      tokenHash: hashToken(plainToken),
      invitedBy,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    }
  });

  const appUrl = process.env.APP_URL || "";
  const inviteUrl = `${appUrl}/editor/invite.html?token=${plainToken}`;

  return { invite, inviteUrl, token: plainToken };
}

async function acceptInvite(plainToken, name, password) {
  const prisma = getPrisma();
  if (!plainToken || !name || !password) throw Object.assign(new Error("Token, name, and password are required."), { statusCode: 400 });
  if (password.length < 8) throw Object.assign(new Error("Password must be at least 8 characters."), { statusCode: 400 });

  const tokenHash = hashToken(plainToken);
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });

  if (!invite) throw Object.assign(new Error("Invalid invite token."), { statusCode: 404 });
  if (invite.status !== "PENDING") throw Object.assign(new Error("Invite has already been used."), { statusCode: 409 });
  if (invite.expiresAt < new Date()) {
    await prisma.invite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    throw Object.assign(new Error("Invite has expired."), { statusCode: 410 });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const result = await prisma.$transaction(async (tx) => {
    // Create user
    const user = await tx.user.create({
      data: {
        tenantId: invite.tenantId,
        email: invite.email,
        passwordHash,
        name: name.trim(),
        role: invite.role
      }
    });

    // Mark invite accepted
    await tx.invite.update({ where: { id: invite.id }, data: { status: "ACCEPTED" } });

    return user;
  });

  // Auto-login: create session
  const loginResult = await login(invite.email, password);
  return { user: result, ...loginResult };
}

// ── User Management ──

async function listUsers(tenantId) {
  const prisma = getPrisma();
  return prisma.user.findMany({
    where: { tenantId },
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    orderBy: { createdAt: "asc" }
  });
}

async function listInvites(tenantId) {
  const prisma = getPrisma();
  return prisma.invite.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 50
  });
}

async function updateUser(userId, updates) {
  const prisma = getPrisma();
  const patch = {};
  if (updates.role) patch.role = updates.role;
  if (typeof updates.active === "boolean") patch.active = updates.active;
  if (updates.name) patch.name = updates.name.trim();
  return prisma.user.update({ where: { id: userId }, data: patch });
}

async function deactivateUser(userId) {
  const prisma = getPrisma();
  // Deactivate user and delete all sessions
  await prisma.session.deleteMany({ where: { userId } });
  return prisma.user.update({ where: { id: userId }, data: { active: false } });
}

// ── Seed Admin ──

async function seedAdmin(tenantId, email, password, name) {
  const prisma = getPrisma();
  email = (email || "").trim().toLowerCase();
  if (!email || !password) throw new Error("Email and password required for admin seed.");

  const existing = await prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
  if (existing) {
    console.log(`Admin user already exists: ${email} (${existing.id})`);
    return existing;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { tenantId, email, passwordHash, name: name || "Admin", role: "ADMIN" }
  });
  console.log(`Admin user created: ${email} (${user.id})`);
  return user;
}

// ── Helpers ──

function parseExpiry(str) {
  const match = (str || "7d").match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return val * (ms[unit] || ms.d);
}

module.exports = {
  canUseDb,
  login,
  logout,
  validateSession,
  authenticateSession,
  parseCookies,
  createInvite,
  acceptInvite,
  listUsers,
  listInvites,
  updateUser,
  deactivateUser,
  seedAdmin,
};
