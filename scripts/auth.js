const crypto = require("crypto");

let prisma = null;

function getPrisma() {
  if (prisma) return prisma;
  try {
    const { PrismaClient } = require("@prisma/client");
    prisma = new PrismaClient();
    return prisma;
  } catch (_err) {
    return null;
  }
}

function hashKey(plaintext) {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

function generateKeyString() {
  const random = crypto.randomBytes(24).toString("hex");
  return `sk_live_${random}`;
}

async function createTenant(name, slug) {
  const db = getPrisma();
  if (!db) throw new Error("Database not available");
  if (!name || !slug) throw new Error("name and slug are required");
  const sanitizedSlug = slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return db.tenant.create({
    data: { name, slug: sanitizedSlug }
  });
}

async function listTenants() {
  const db = getPrisma();
  if (!db) return [];
  return db.tenant.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, slug: true, active: true, storageType: true, createdAt: true }
  });
}

async function createApiKey(tenantId, name, scopes) {
  const db = getPrisma();
  if (!db) throw new Error("Database not available");
  if (!tenantId || !name) throw new Error("tenantId and name are required");

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("Tenant not found");
  if (!tenant.active) throw new Error("Tenant is inactive");

  const plaintext = generateKeyString();
  const keyH = hashKey(plaintext);
  const prefix = plaintext.slice(0, 12) + "...";

  await db.apiKey.create({
    data: {
      tenantId,
      name,
      keyHash: keyH,
      prefix,
      scopes: scopes || ["render", "template:read"],
      active: true
    }
  });

  // Return plaintext ONCE — it cannot be retrieved again
  return { key: plaintext, prefix, name, tenantId, scopes: scopes || ["render", "template:read"] };
}

async function listApiKeys(tenantId) {
  const db = getPrisma();
  if (!db) return [];
  return db.apiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, scopes: true, active: true, createdAt: true, lastUsedAt: true }
  });
}

async function revokeApiKey(keyId) {
  const db = getPrisma();
  if (!db) throw new Error("Database not available");
  return db.apiKey.update({
    where: { id: keyId },
    data: { active: false }
  });
}

async function authenticateRequest(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) {
    // Check for editor bypass (same-origin)
    const origin = req.headers["origin"] || req.headers["referer"] || "";
    const host = req.headers["host"] || "";
    if (origin && (origin.includes(host) || origin.includes("localhost"))) {
      return { authenticated: false, bypass: true, tenantId: null, scopes: [] };
    }
    return { authenticated: false, bypass: false, error: "Missing Authorization header" };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { authenticated: false, bypass: false, error: "Empty bearer token" };
  }

  const db = getPrisma();
  if (!db) {
    return { authenticated: false, bypass: false, error: "Database not available" };
  }

  const keyH = hashKey(token);
  const apiKey = await db.apiKey.findUnique({
    where: { keyHash: keyH },
    include: { tenant: { select: { id: true, name: true, active: true } } }
  });

  if (!apiKey) {
    return { authenticated: false, bypass: false, error: "Invalid API key" };
  }
  if (!apiKey.active) {
    return { authenticated: false, bypass: false, error: "API key has been revoked" };
  }
  if (!apiKey.tenant || !apiKey.tenant.active) {
    return { authenticated: false, bypass: false, error: "Tenant is inactive" };
  }

  // Update last used (fire-and-forget, don't block the request)
  db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return {
    authenticated: true,
    bypass: false,
    tenantId: apiKey.tenant.id,
    tenantName: apiKey.tenant.name,
    scopes: apiKey.scopes || [],
    keyId: apiKey.id
  };
}

function hasScope(authResult, requiredScope) {
  if (!authResult.authenticated) return false;
  return authResult.scopes.includes(requiredScope);
}

function isAdminRequest(req) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return false;
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return false;
  return authHeader.slice(7).trim() === adminToken;
}

module.exports = {
  createTenant,
  listTenants,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  authenticateRequest,
  hasScope,
  isAdminRequest
};
