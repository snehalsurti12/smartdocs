#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const { renderHtml, evaluateDataContract } = require("./render");
const { computeFlowPagesBrowser } = require("./flow-measure");
const { launchChromium } = require("./playwright-launch");
const renderPool = require("./render-pool");
const templateStoreDb = require("./template-store-db");
const auth = require("./auth");
const authUsers = require("./auth-users");
const permissions = require("./permissions");
const projectsModule = require("./projects");
const approvalModule = require("./approval");

const root = path.join(__dirname, "..");
const port = process.env.PORT || 5177;
const demoMode = process.env.DEMO_MODE === "true" || process.env.DEMO_MODE === "1";

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function respondJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes) {
  const limit = maxBytes || 2 * 1024 * 1024; // 2MB default
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Free/disposable email domain block list
const BLOCKED_EMAIL_DOMAINS = new Set([
  "gmail.com","yahoo.com","hotmail.com","outlook.com","aol.com","icloud.com",
  "mail.com","protonmail.com","zoho.com","yandex.com","gmx.com","live.com",
  "msn.com","me.com","mac.com","inbox.com","fastmail.com","hushmail.com",
  "tutanota.com","guerrillamail.com","mailinator.com","tempmail.com",
  "throwaway.email","sharklasers.com","guerrillamailblock.com","grr.la",
  "dispostable.com","yopmail.com","trashmail.com","fakeinbox.com",
  "mailnesia.com","maildrop.cc","discard.email","33mail.com",
  "temp-mail.org","tempmailaddress.com","emailondeck.com","getnada.com",
  "mailsac.com","burnermail.io","inboxbear.com","mytemp.email",
  "10minutemail.com","mohmal.com","guerrillamail.info","spam4.me",
  "trashmail.me","harakirimail.com","cuvox.de","armyspy.com",
  "dayrep.com","einrot.com","fleckens.hu","gustr.com","jourrapide.com",
  "rhyta.com","superrito.com","teleworm.us"
]);

function isBlockedEmail(email) {
  if (!email || !email.includes("@")) return true;
  const domain = email.split("@")[1].toLowerCase();
  return BLOCKED_EMAIL_DOMAINS.has(domain);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

const dns = require("dns");
function verifyEmailDomain(email) {
  return new Promise((resolve) => {
    const domain = email.split("@")[1];
    if (!domain) { resolve(false); return; }
    dns.resolveMx(domain, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function dbUnavailableResponse(res) {
  respondJson(res, 501, {
    error: "Database persistence is not configured.",
    hint: "Install Prisma deps, run migrations, and set DATABASE_URL."
  });
}

function demoBlockedResponse(res) {
  respondJson(res, 403, {
    error: "This action is disabled in demo mode.",
    hint: "The public demo is read-only. Run your own instance for full access."
  });
}

function isDemoBlocked(req) {
  if (!demoMode) return false;
  // Authenticated API requests bypass demo mode
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer sk_live_")) return false;
  // Admin requests bypass demo mode
  if (auth.isAdminRequest(req)) return false;
  return true;
}

// Rate limiter — per-IP, sliding window
const rateLimits = new Map();
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_MAX_PDF = Number(process.env.RATE_LIMIT_PDF) || 10; // 10 PDFs/min
const RATE_MAX_API = Number(process.env.RATE_LIMIT_API) || 60; // 60 API calls/min

function rateLimit(req, bucket, maxRequests) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const key = `${ip}:${bucket}`;
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimits.set(key, entry);
  }
  entry.count++;
  if (entry.count > maxRequests) {
    return false;
  }
  return true;
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now - entry.windowStart > RATE_WINDOW_MS * 2) rateLimits.delete(key);
  }
}, 5 * 60 * 1000);

// Simple analytics — in-memory counters, exposed via /api/stats
const stats = {
  startedAt: new Date().toISOString(),
  pageViews: 0,
  pdfRenders: 0,
  templateLoads: 0,
  uniqueVisitors: new Set(),
  dailyVisitors: new Map() // date -> Set of IPs
};

function trackVisit(req, event) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const today = new Date().toISOString().slice(0, 10);
  if (event === "pageView") {
    stats.pageViews++;
    stats.uniqueVisitors.add(ip);
    if (!stats.dailyVisitors.has(today)) stats.dailyVisitors.set(today, new Set());
    stats.dailyVisitors.get(today).add(ip);
  } else if (event === "pdfRender") {
    stats.pdfRenders++;
  } else if (event === "templateLoad") {
    stats.templateLoads++;
  }
}

function getStats() {
  const daily = {};
  for (const [date, visitors] of stats.dailyVisitors) {
    daily[date] = visitors.size;
  }
  return {
    startedAt: stats.startedAt,
    pageViews: stats.pageViews,
    uniqueVisitors: stats.uniqueVisitors.size,
    pdfRenders: stats.pdfRenders,
    templateLoads: stats.templateLoads,
    dailyVisitors: daily
  };
}

function addSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline' data: https://images.unsplash.com; img-src * data:; font-src 'self' data:;");
  }
}

const server = http.createServer(async (req, res) => {
  addSecurityHeaders(res);

  const urlPath = decodeURIComponent(req.url.split("?")[0] || "/");

  // API rate limiting
  if (urlPath.startsWith("/api/")) {
    if (!rateLimit(req, "api", RATE_MAX_API)) {
      respondJson(res, 429, { error: "Too many requests. Please try again later." });
      return;
    }
  }

  // ── Auth endpoints ──
  try {
    if (urlPath === "/api/auth/login" && req.method === "POST") {
      if (!authUsers.canUseDb()) { dbUnavailableResponse(res); return; }
      const payload = await readJsonBody(req);
      const result = await authUsers.login(payload.email, payload.password);
      // Set httpOnly session cookie
      const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.setHeader("Set-Cookie", `smartdocs_session=${result.token}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${7 * 24 * 3600}`);
      respondJson(res, 200, { user: result.user });
      return;
    }

    if (urlPath === "/api/auth/logout" && req.method === "POST") {
      const cookies = authUsers.parseCookies(req);
      if (cookies.smartdocs_session) {
        try {
          const jwt = require("jsonwebtoken");
          const decoded = jwt.decode(cookies.smartdocs_session);
          if (decoded && decoded.sessionToken) await authUsers.logout(decoded.sessionToken);
        } catch (_) {}
      }
      const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.setHeader("Set-Cookie", `smartdocs_session=; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=0`);
      respondJson(res, 200, { ok: true });
      return;
    }

    if (urlPath === "/api/auth/me" && req.method === "GET") {
      if (!authUsers.canUseDb()) { dbUnavailableResponse(res); return; }
      const user = await authUsers.authenticateSession(req);
      if (!user) { respondJson(res, 401, { error: "Not authenticated." }); return; }
      respondJson(res, 200, { user });
      return;
    }

    if (urlPath === "/api/auth/accept-invite" && req.method === "POST") {
      if (!authUsers.canUseDb()) { dbUnavailableResponse(res); return; }
      const payload = await readJsonBody(req);
      const result = await authUsers.acceptInvite(payload.token, payload.name, payload.password);
      const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.setHeader("Set-Cookie", `smartdocs_session=${result.token}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${7 * 24 * 3600}`);
      respondJson(res, 201, { user: result.user });
      return;
    }

    // ── User management (ADMIN only via session) ──
    if (urlPath === "/api/users" && req.method === "GET") {
      if (!authUsers.canUseDb()) { dbUnavailableResponse(res); return; }
      const user = await authUsers.authenticateSession(req);
      const perm = permissions.requirePermission(user, "user:manage");
      if (perm.denied) { respondJson(res, perm.status, { error: perm.error }); return; }
      const users = await authUsers.listUsers(user.tenantId);
      respondJson(res, 200, { users });
      return;
    }

    if (urlPath === "/api/users/invite" && req.method === "POST") {
      if (!authUsers.canUseDb()) { dbUnavailableResponse(res); return; }
      const user = await authUsers.authenticateSession(req);
      const perm = permissions.requirePermission(user, "user:manage");
      if (perm.denied) { respondJson(res, perm.status, { error: perm.error }); return; }
      const payload = await readJsonBody(req);
      const result = await authUsers.createInvite(user.tenantId, payload.email, payload.role, user.id, payload.projectIds);
      respondJson(res, 201, { invite: result.invite, inviteUrl: result.inviteUrl });
      return;
    }

    if (urlPath === "/api/users/invites" && req.method === "GET") {
      if (!authUsers.canUseDb()) { dbUnavailableResponse(res); return; }
      const user = await authUsers.authenticateSession(req);
      const perm = permissions.requirePermission(user, "user:manage");
      if (perm.denied) { respondJson(res, perm.status, { error: perm.error }); return; }
      const invites = await authUsers.listInvites(user.tenantId);
      respondJson(res, 200, { invites });
      return;
    }

    const userIdMatch = urlPath.match(/^\/api\/users\/([^/]+)$/);
    if (userIdMatch && (req.method === "PATCH" || req.method === "DELETE")) {
      if (!authUsers.canUseDb()) { dbUnavailableResponse(res); return; }
      const sessionUser = await authUsers.authenticateSession(req);
      const perm = permissions.requirePermission(sessionUser, "user:manage");
      if (perm.denied) { respondJson(res, perm.status, { error: perm.error }); return; }
      const targetUserId = userIdMatch[1];
      if (req.method === "DELETE") {
        const updated = await authUsers.deactivateUser(targetUserId);
        respondJson(res, 200, { user: updated });
      } else {
        const payload = await readJsonBody(req);
        const updated = await authUsers.updateUser(targetUserId, payload);
        respondJson(res, 200, { user: updated });
      }
      return;
    }

    // ── Project endpoints ──
    if (urlPath === "/api/projects" && req.method === "GET") {
      const user = await authUsers.authenticateSession(req);
      if (!user) { respondJson(res, 401, { error: "Authentication required." }); return; }
      const projects = await projectsModule.listProjects(user.tenantId, user.id, user.role);
      respondJson(res, 200, { projects });
      return;
    }
    if (urlPath === "/api/projects" && req.method === "POST") {
      const user = await authUsers.authenticateSession(req);
      const perm = permissions.requirePermission(user, "project:manage");
      if (perm.denied) { respondJson(res, perm.status, { error: perm.error }); return; }
      const payload = await readJsonBody(req);
      const project = await projectsModule.createProject(user.tenantId, payload.name, payload.description, user.id);
      respondJson(res, 201, { project });
      return;
    }

    const projectIdMatch = urlPath.match(/^\/api\/projects\/([^/]+)$/);
    if (projectIdMatch) {
      const projectId = projectIdMatch[1];
      if (req.method === "GET") {
        const user = await authUsers.authenticateSession(req);
        if (!user) { respondJson(res, 401, { error: "Authentication required." }); return; }
        const project = await projectsModule.getProject(projectId);
        if (!project || project.tenantId !== user.tenantId) { respondJson(res, 404, { error: "Project not found." }); return; }
        respondJson(res, 200, { project });
        return;
      }
      if (req.method === "PATCH") {
        const user = await authUsers.authenticateSession(req);
        const perm = permissions.requirePermission(user, "project:manage");
        if (perm.denied) { respondJson(res, perm.status, { error: perm.error }); return; }
        const payload = await readJsonBody(req);
        const updated = await projectsModule.updateProject(projectId, payload);
        respondJson(res, 200, { project: updated });
        return;
      }
    }

    const projectMembersMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/members$/);
    if (projectMembersMatch) {
      const projectId = projectMembersMatch[1];
      if (req.method === "POST") {
        const user = await authUsers.authenticateSession(req);
        const perm = permissions.requirePermission(user, "project:manage");
        if (perm.denied) { respondJson(res, perm.status, { error: perm.error }); return; }
        const payload = await readJsonBody(req);
        const member = await projectsModule.addMember(projectId, payload.userId);
        respondJson(res, 201, { member });
        return;
      }
    }

    const projectMemberRemoveMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/members\/([^/]+)$/);
    if (projectMemberRemoveMatch && req.method === "DELETE") {
      const user = await authUsers.authenticateSession(req);
      const perm = permissions.requirePermission(user, "project:manage");
      if (perm.denied) { respondJson(res, perm.status, { error: perm.error }); return; }
      await projectsModule.removeMember(projectMemberRemoveMatch[1], projectMemberRemoveMatch[2]);
      respondJson(res, 200, { ok: true });
      return;
    }

    // ── Approval Chain endpoints ──
    const chainListMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/approval-chains$/);
    if (chainListMatch) {
      const projectId = chainListMatch[1];
      if (req.method === "GET") {
        const user = await authUsers.authenticateSession(req);
        if (!user) { respondJson(res, 401, { error: "Authentication required." }); return; }
        const chains = await projectsModule.listApprovalChains(projectId);
        respondJson(res, 200, { chains });
        return;
      }
      if (req.method === "POST") {
        const user = await authUsers.authenticateSession(req);
        const perm = permissions.requirePermission(user, "chain:manage");
        if (perm.denied) { respondJson(res, perm.status, { error: perm.error }); return; }
        const payload = await readJsonBody(req);
        const chain = await projectsModule.saveApprovalChain(projectId, payload.name, payload.levels);
        respondJson(res, 201, { chain });
        return;
      }
    }

    // ── Approval Flow endpoints ──
    const submitMatch = urlPath.match(/^\/api\/templates\/([^/]+)\/submit$/);
    if (submitMatch && req.method === "POST") {
      const user = await authUsers.authenticateSession(req);
      if (!user) { respondJson(res, 401, { error: "Authentication required." }); return; }
      const templateId = submitMatch[1];
      const payload = await readJsonBody(req);
      const result = await approvalModule.submitForApproval(templateId, payload.chainId, user.id, payload.reviewerOverrides);
      respondJson(res, 200, { request: result });
      return;
    }

    const approveMatch = urlPath.match(/^\/api\/templates\/([^/]+)\/approve$/);
    if (approveMatch && req.method === "POST") {
      const user = await authUsers.authenticateSession(req);
      if (!user) { respondJson(res, 401, { error: "Authentication required." }); return; }
      const templateId = approveMatch[1];
      const payload = await readJsonBody(req);
      const result = await approvalModule.approveStep(templateId, user.id, payload.comment);
      respondJson(res, 200, result);
      return;
    }

    const rejectMatch = urlPath.match(/^\/api\/templates\/([^/]+)\/reject$/);
    if (rejectMatch && req.method === "POST") {
      const user = await authUsers.authenticateSession(req);
      if (!user) { respondJson(res, 401, { error: "Authentication required." }); return; }
      const templateId = rejectMatch[1];
      const payload = await readJsonBody(req);
      const result = await approvalModule.rejectStep(templateId, user.id, payload.reason);
      respondJson(res, 200, result);
      return;
    }

    const approvalStatusMatch = urlPath.match(/^\/api\/templates\/([^/]+)\/approval$/);
    if (approvalStatusMatch && req.method === "GET") {
      const user = await authUsers.authenticateSession(req);
      if (!user) { respondJson(res, 401, { error: "Authentication required." }); return; }
      const result = await approvalModule.getApprovalStatus(approvalStatusMatch[1]);
      if (!result) { respondJson(res, 404, { error: "Template not found." }); return; }
      respondJson(res, 200, result);
      return;
    }

    if (urlPath === "/api/approvals/pending" && req.method === "GET") {
      const user = await authUsers.authenticateSession(req);
      if (!user) { respondJson(res, 401, { error: "Authentication required." }); return; }
      const pending = await approvalModule.listPendingReviews(user.id);
      respondJson(res, 200, { pending });
      return;
    }

  } catch (err) {
    const message = err && err.message ? err.message : "Auth request failed";
    const status = err.statusCode || 400;
    respondJson(res, status, { error: message });
    return;
  }

  try {
    if (urlPath === "/api/templates") {
      if (!templateStoreDb.canUseDb()) {
        dbUnavailableResponse(res);
        return;
      }
      if (req.method === "GET") {
        const templates = await templateStoreDb.listTemplates();
        respondJson(res, 200, { templates });
        return;
      }
      if (req.method === "POST") {
        if (isDemoBlocked(req)) { demoBlockedResponse(res); return; }
        const payload = await readJsonBody(req);
        const created = await templateStoreDb.createTemplate({
          name: payload.name,
          description: payload.description,
          contentJson: payload.contentJson || payload.template || {},
          actorId: payload.actorId || "editor",
          projectId: payload.projectId || null,
          tenantId: payload.tenantId || null
        });
        respondJson(res, 201, { template: created });
        return;
      }
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const templatePathMatch = urlPath.match(/^\/api\/templates\/([^/]+)$/);
    if (templatePathMatch) {
      if (!templateStoreDb.canUseDb()) {
        dbUnavailableResponse(res);
        return;
      }
      const templateId = templatePathMatch[1];
      if (req.method === "GET") {
        const template = await templateStoreDb.getTemplate(templateId);
        if (!template) {
          respondJson(res, 404, { error: "Template not found" });
          return;
        }
        respondJson(res, 200, { template });
        return;
      }
      if (req.method === "PATCH") {
        if (isDemoBlocked(req)) { demoBlockedResponse(res); return; }
        const payload = await readJsonBody(req);
        const updated = await templateStoreDb.updateTemplateMetadata(templateId, payload);
        respondJson(res, 200, { template: updated });
        return;
      }
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const versionsPathMatch = urlPath.match(/^\/api\/templates\/([^/]+)\/versions$/);
    if (versionsPathMatch) {
      if (!templateStoreDb.canUseDb()) {
        dbUnavailableResponse(res);
        return;
      }
      const templateId = versionsPathMatch[1];
      if (req.method === "GET") {
        const versions = await templateStoreDb.listTemplateVersions(templateId);
        respondJson(res, 200, { versions });
        return;
      }
      if (req.method === "POST") {
        if (isDemoBlocked(req)) { demoBlockedResponse(res); return; }
        const payload = await readJsonBody(req);
        const updated = await templateStoreDb.createTemplateVersion(templateId, {
          contentJson: payload.contentJson || payload.template || {},
          actorId: payload.actorId || "editor"
        });
        respondJson(res, 201, { template: updated });
        return;
      }
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const auditPathMatch = urlPath.match(/^\/api\/templates\/([^/]+)\/audit$/);
    if (auditPathMatch) {
      if (!templateStoreDb.canUseDb()) {
        dbUnavailableResponse(res);
        return;
      }
      if (req.method !== "GET") {
        respondJson(res, 405, { error: "Method not allowed" });
        return;
      }
      const templateId = auditPathMatch[1];
      const query = req.url.includes("?") ? req.url.split("?")[1] : "";
      const params = new URLSearchParams(query);
      const limit = params.get("limit");
      const events = await templateStoreDb.listTemplateAudit(templateId, limit);
      respondJson(res, 200, { events });
      return;
    }

    // ── Template status transition ──
    const transitionMatch = urlPath.match(/^\/api\/templates\/([^/]+)\/transition$/);
    if (transitionMatch) {
      if (!templateStoreDb.canUseDb()) { dbUnavailableResponse(res); return; }
      if (req.method !== "POST") { respondJson(res, 405, { error: "Method not allowed" }); return; }
      if (isDemoBlocked(req)) { demoBlockedResponse(res); return; }
      const templateId = transitionMatch[1];
      const payload = await readJsonBody(req);
      const toStatus = payload.to || payload.status;
      const reason = payload.reason || null;
      const actorId = payload.actorId || "editor";
      const updated = await templateStoreDb.transitionTemplateStatus(templateId, toStatus, reason, actorId);
      const workflow = require("./workflow");
      respondJson(res, 200, {
        template: updated,
        transitions: workflow.getAllowedTransitions(updated.status)
      });
      return;
    }

    // ── Template workflow info (allowed transitions) ──
    const workflowMatch = urlPath.match(/^\/api\/templates\/([^/]+)\/workflow$/);
    if (workflowMatch) {
      if (!templateStoreDb.canUseDb()) { dbUnavailableResponse(res); return; }
      if (req.method !== "GET") { respondJson(res, 405, { error: "Method not allowed" }); return; }
      const templateId = workflowMatch[1];
      const template = await templateStoreDb.getTemplate(templateId);
      if (!template) { respondJson(res, 404, { error: "Template not found" }); return; }
      const workflow = require("./workflow");
      respondJson(res, 200, {
        status: template.status,
        locked: workflow.isContentLocked(template.status),
        transitions: workflow.getAllowedTransitions(template.status)
      });
      return;
    }
  } catch (err) {
    const message = err && err.message ? err.message : "Request failed";
    const status = err.statusCode || (message.toLowerCase().includes("not found") ? 404 : 400);
    respondJson(res, status, { error: message });
    return;
  }

  // ── Admin endpoints (protected by ADMIN_TOKEN) ──
  try {
    if (urlPath === "/api/tenants" && req.method === "POST") {
      if (!auth.isAdminRequest(req)) { respondJson(res, 401, { error: "Admin token required" }); return; }
      const payload = await readJsonBody(req);
      const tenant = await auth.createTenant(payload.name, payload.slug);
      respondJson(res, 201, { tenant });
      return;
    }
    if (urlPath === "/api/tenants" && req.method === "GET") {
      if (!auth.isAdminRequest(req)) { respondJson(res, 401, { error: "Admin token required" }); return; }
      const tenants = await auth.listTenants();
      respondJson(res, 200, { tenants });
      return;
    }
    const tenantKeysMatch = urlPath.match(/^\/api\/tenants\/([^/]+)\/keys$/);
    if (tenantKeysMatch) {
      if (!auth.isAdminRequest(req)) { respondJson(res, 401, { error: "Admin token required" }); return; }
      const tenantId = tenantKeysMatch[1];
      if (req.method === "POST") {
        const payload = await readJsonBody(req);
        const result = await auth.createApiKey(tenantId, payload.name, payload.scopes);
        respondJson(res, 201, result);
        return;
      }
      if (req.method === "GET") {
        const keys = await auth.listApiKeys(tenantId);
        respondJson(res, 200, { keys });
        return;
      }
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const revokeKeyMatch = urlPath.match(/^\/api\/keys\/([^/]+)$/);
    if (revokeKeyMatch && req.method === "DELETE") {
      if (!auth.isAdminRequest(req)) { respondJson(res, 401, { error: "Admin token required" }); return; }
      await auth.revokeApiKey(revokeKeyMatch[1]);
      respondJson(res, 200, { status: "revoked" });
      return;
    }
  } catch (err) {
    respondJson(res, 400, { error: err && err.message ? err.message : "Admin request failed" });
    return;
  }

  // ── Authenticated render endpoint (template ID based) ──
  if (req.method === "POST" && urlPath === "/api/render") {
    trackVisit(req, "pdfRender");
    if (!rateLimit(req, "pdf", RATE_MAX_PDF)) {
      respondJson(res, 429, { error: "Rate limit exceeded" });
      return;
    }
    try {
      const authResult = await auth.authenticateRequest(req);
      if (!authResult.authenticated && !authResult.bypass) {
        respondJson(res, 401, { error: authResult.error || "Authentication required" });
        return;
      }
      const payload = await readJsonBody(req, 5 * 1024 * 1024);
      if (!payload.templateId) {
        respondJson(res, 400, { error: "templateId is required" });
        return;
      }
      if (!templateStoreDb.canUseDb()) {
        respondJson(res, 501, { error: "Database not configured" });
        return;
      }
      const tmpl = await templateStoreDb.getTemplate(payload.templateId);
      if (!tmpl || !tmpl.currentVersion) {
        respondJson(res, 404, { error: "Template not found" });
        return;
      }
      // Tenant isolation: if authenticated, verify ownership
      if (authResult.authenticated && tmpl.tenantId && tmpl.tenantId !== authResult.tenantId) {
        respondJson(res, 404, { error: "Template not found" });
        return;
      }
      const templateJson = tmpl.currentVersion.contentJson;
      const evaluation = evaluateDataContract(templateJson, payload.data || {});
      if (evaluation.missingRequired && evaluation.missingRequired.length) {
        respondJson(res, 422, { error: "Missing required fields", missingRequired: evaluation.missingRequired });
        return;
      }
      const format = payload.format || "pdf";
      if (format === "html") {
        const html = renderHtml(templateJson, evaluation.data, { dataAlreadyMapped: true });
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html");
        res.setHeader("X-SmartDocs-Template-Id", payload.templateId);
        res.end(html);
        return;
      }
      // PDF render
      let flowData = null;
      if (templateJson.options && templateJson.options.flowMeasure === "browser") {
        const page = templateJson.page || {};
        const margin = page.margin || { top: 0, right: 0, bottom: 0, left: 0 };
        const headerH = page.headerHeight || 0;
        const footerH = page.footerHeight || 0;
        const bodyW = page.width - margin.left - margin.right;
        const bodyH = page.height - margin.top - margin.bottom - headerH - footerH;
        const flowEl = (templateJson.elements || []).find((el) => el.type === "flowText");
        if (flowEl) {
          flowData = await computeFlowPagesBrowser(flowEl, evaluation.data, templateJson, bodyW, bodyH);
        }
      }
      const html = renderHtml(templateJson, evaluation.data, { flowData, dataAlreadyMapped: true });
      const poolPage = await renderPool.acquirePage();
      try {
        await poolPage.setContent(html, { waitUntil: "load" });
        await poolPage.emulateMedia({ media: "print" });
        const pdf = await poolPage.pdf({ printBackground: true, preferCSSPageSize: true });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("X-SmartDocs-Template-Id", payload.templateId);
        res.end(pdf);
      } finally {
        renderPool.releasePage(poolPage);
      }
    } catch (err) {
      respondJson(res, 500, { error: "Render failed" });
    }
    return;
  }

  // ── Template fields API (for Salesforce mapping UI) ──
  const fieldsMatch = urlPath.match(/^\/api\/templates\/([^/]+)\/fields$/);
  if (fieldsMatch && req.method === "GET") {
    try {
      const authResult = await auth.authenticateRequest(req);
      if (!authResult.authenticated && !authResult.bypass) {
        respondJson(res, 401, { error: authResult.error || "Authentication required" });
        return;
      }
      if (!templateStoreDb.canUseDb()) {
        respondJson(res, 501, { error: "Database not configured" });
        return;
      }
      const tmpl = await templateStoreDb.getTemplate(fieldsMatch[1]);
      if (!tmpl || !tmpl.currentVersion) {
        respondJson(res, 404, { error: "Template not found" });
        return;
      }
      if (authResult.authenticated && tmpl.tenantId && tmpl.tenantId !== authResult.tenantId) {
        respondJson(res, 404, { error: "Template not found" });
        return;
      }
      const content = tmpl.currentVersion.contentJson;
      const contract = content.dataContract || {};
      const elements = content.elements || [];

      // Detect array bindings from table rows and chart dataSources
      const arrayBindings = new Map(); // path → { sourceElement, childFields }
      for (const el of elements) {
        if (el.type === "table" && el.rows) {
          const rowsPath = (el.rows || "").replace(/\{\{|\}\}/g, "").trim();
          if (rowsPath) {
            const childFields = (el.columns || []).map((col) => ({
              path: col.field,
              header: col.header || col.field,
              type: col.format === "currency" || col.format === "number" ? "number" : "string",
              format: col.format || null
            }));
            arrayBindings.set(rowsPath, { sourceElement: "table", elementId: el.id, childFields });
          }
        }
        if (el.type === "chart" && el.dataSource) {
          const dsPath = (el.dataSource || "").replace(/\{\{|\}\}/g, "").trim();
          if (dsPath) {
            const childFields = [];
            if (el.labelField) childFields.push({ path: el.labelField, header: "Label", type: "string", format: null });
            if (el.valueField) childFields.push({ path: el.valueField, header: "Value", type: "number", format: null });
            arrayBindings.set(dsPath, { sourceElement: "chart", elementId: el.id, childFields });
          }
        }
      }

      // Build field list from data contract
      const contractFields = (contract.fields || []).map((f) => {
        const isArray = f.type === "array" || arrayBindings.has(f.path);
        const arrayInfo = arrayBindings.get(f.path);
        return {
          path: f.path,
          required: Boolean(f.required),
          type: isArray ? "array" : (f.type || "string"),
          cardinality: isArray ? "many" : "one",
          transform: f.transform || "none",
          pii: Boolean(f.pii),
          piiCategory: f.piiCategory || null,
          defaultValue: f.defaultValue,
          children: arrayInfo ? arrayInfo.childFields : undefined,
          sourceElement: arrayInfo ? arrayInfo.sourceElement : undefined
        };
      });

      // Also add array bindings not in the data contract
      for (const [path, info] of arrayBindings) {
        if (!contractFields.find((f) => f.path === path)) {
          contractFields.push({
            path,
            required: false,
            type: "array",
            cardinality: "many",
            transform: "none",
            pii: false,
            piiCategory: null,
            defaultValue: undefined,
            children: info.childFields,
            sourceElement: info.sourceElement
          });
        }
      }

      // Scan all text elements for single-value bindings not in contract
      const bindingRegex = /\{\{\s*([^}]+?)\s*\}\}/g;
      const knownPaths = new Set(contractFields.map((f) => f.path));
      for (const el of elements) {
        const textSources = [el.text, el.value, el.src, el.url, el.title].filter(Boolean);
        for (const src of textSources) {
          let match;
          while ((match = bindingRegex.exec(src)) !== null) {
            const p = match[1].trim();
            if (p === "page.number" || p === "page.count") continue;
            // Skip child paths of known arrays (e.g. "items.name" when "items" is array)
            const isChildOfArray = [...arrayBindings.keys()].some((arrPath) => p.startsWith(arrPath + ".") || p.startsWith(arrPath + "["));
            if (!knownPaths.has(p) && !isChildOfArray) {
              contractFields.push({
                path: p,
                required: false,
                type: "string",
                cardinality: "one",
                transform: "none",
                pii: false,
                piiCategory: null,
                defaultValue: undefined
              });
              knownPaths.add(p);
            }
          }
        }
      }

      respondJson(res, 200, {
        templateId: tmpl.id,
        templateName: tmpl.name,
        version: tmpl.currentVersion.version,
        fields: contractFields
      });
    } catch (err) {
      respondJson(res, 400, { error: err && err.message ? err.message : "Request failed" });
    }
    return;
  }

  // ── Legacy render-pdf (editor preview, no auth required) ──
  if (req.method === "POST" && urlPath === "/api/render-pdf") {
    trackVisit(req, "pdfRender");
    if (!rateLimit(req, "pdf", RATE_MAX_PDF)) {
      respondJson(res, 429, { error: "PDF rate limit exceeded. Max " + RATE_MAX_PDF + " per minute." });
      return;
    }
    try {
      const payload = await readJsonBody(req, 5 * 1024 * 1024); // 5MB for PDF payloads
      const template = payload.template || {};
      const evaluation = evaluateDataContract(template, payload.data || {});
      const data = evaluation.data;
      if (evaluation.missingRequired && evaluation.missingRequired.length) {
        respondJson(res, 422, { error: "Missing required fields", missingRequired: evaluation.missingRequired });
        return;
      }
      let flowData = null;
      if (template.options && template.options.flowMeasure === "browser") {
        const page = template.page || {};
        const margin = page.margin || { top: 0, right: 0, bottom: 0, left: 0 };
        const headerH = page.headerHeight || 0;
        const footerH = page.footerHeight || 0;
        const bodyW = page.width - margin.left - margin.right;
        const bodyH = page.height - margin.top - margin.bottom - headerH - footerH;
        const flowEl = (template.elements || []).find((el) => el.type === "flowText");
        if (flowEl) {
          flowData = await computeFlowPagesBrowser(flowEl, data, template, bodyW, bodyH);
        }
      }

      const html = renderHtml(template, data, { flowData, dataAlreadyMapped: true });

      const poolPage = await renderPool.acquirePage();
      try {
        await poolPage.setContent(html, { waitUntil: "load" });
        await poolPage.emulateMedia({ media: "print" });
        const pdf = await poolPage.pdf({
          printBackground: true,
          preferCSSPageSize: true
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/pdf");
        res.end(pdf);
      } finally {
        renderPool.releasePage(poolPage);
      }
    } catch (err) {
      respondJson(res, 500, { error: "PDF render failed" });
    }
    return;
  }

  // Health check endpoint
  if (urlPath === "/api/health") {
    respondJson(res, 200, {
      status: "ok",
      version: require("../package.json").version,
      demoMode,
      db: templateStoreDb.canUseDb(),
      renderPool: renderPool.getPoolStats()
    });
    return;
  }

  // Stats endpoint (protected with simple token in production)
  if (urlPath === "/api/stats") {
    const token = process.env.STATS_TOKEN;
    if (token) {
      const query = req.url.includes("?") ? req.url.split("?")[1] : "";
      const params = new URLSearchParams(query);
      if (params.get("token") !== token) {
        respondJson(res, 401, { error: "Unauthorized" });
        return;
      }
    }
    respondJson(res, 200, getStats());
    return;
  }

  // Landing page and subpages
  if (urlPath === "/landing" || urlPath.startsWith("/landing/")) {
    let filePath;
    if (urlPath === "/landing" || urlPath === "/landing/") {
      filePath = path.join(root, "landing", "index.html");
    } else {
      const relative = urlPath.replace(/^\/landing\//, "");
      filePath = path.join(root, "landing", relative);
    }
    // Prevent directory traversal
    if (!filePath.startsWith(path.join(root, "landing"))) {
      res.statusCode = 403; res.end("Forbidden"); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
    fs.readFile(filePath, (err, data) => {
      if (err) { res.statusCode = 404; res.end("Not found"); return; }
      res.setHeader("Content-Type", mimeTypes[ext] || "text/html");
      res.end(data);
    });
    return;
  }

  // Registration endpoint
  if (req.method === "POST" && urlPath === "/api/register") {
    if (!rateLimit(req, "register", 3)) {
      respondJson(res, 429, { error: "Too many registration attempts. Please try again later." });
      return;
    }
    try {
      const payload = await readJsonBody(req);
      // Honeypot check
      if (payload.website) {
        respondJson(res, 200, { status: "ok" }); // Silently accept but don't store
        return;
      }
      const name = (payload.name || "").trim();
      const email = (payload.email || "").trim().toLowerCase();
      const company = (payload.company || "").trim();
      const title = (payload.title || "").trim();

      if (!name || !email || !company) {
        respondJson(res, 400, { error: "Name, email, and company are required." });
        return;
      }
      if (!isValidEmail(email)) {
        respondJson(res, 400, { error: "Please enter a valid email address." });
        return;
      }
      if (isBlockedEmail(email)) {
        respondJson(res, 400, { error: "Please use your work email address. Free email providers are not accepted." });
        return;
      }
      const hasMx = await verifyEmailDomain(email);
      if (!hasMx) {
        respondJson(res, 400, { error: "This email domain does not appear to be valid. Please check your email address." });
        return;
      }
      if (name.length < 2 || name.length > 100) {
        respondJson(res, 400, { error: "Please enter a valid name." });
        return;
      }
      if (company.length < 2 || company.length > 200) {
        respondJson(res, 400, { error: "Please enter a valid company name." });
        return;
      }

      if (templateStoreDb.canUseDb()) {
        try {
          const { PrismaClient } = require("@prisma/client");
          const prisma = new PrismaClient();
          await prisma.registration.upsert({
            where: { email },
            create: {
              name, email, company, title: title || null,
              ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || null,
              userAgent: req.headers["user-agent"] || null
            },
            update: { name, company, title: title || null }
          });
          await prisma.$disconnect();
        } catch (dbErr) {
          // DB save failed but still let them through
          console.error("Registration DB error:", dbErr.message);
        }
      }
      respondJson(res, 201, { status: "registered" });
    } catch (err) {
      respondJson(res, 400, { error: "Registration failed. Please try again." });
    }
    return;
  }

  // Admin: list registrations
  if (urlPath === "/api/registrations" && req.method === "GET") {
    if (!auth.isAdminRequest(req)) {
      respondJson(res, 401, { error: "Admin token required" });
      return;
    }
    if (!templateStoreDb.canUseDb()) {
      respondJson(res, 501, { error: "Database not configured" });
      return;
    }
    try {
      const db = require("@prisma/client");
      const prisma = new db.PrismaClient();
      const registrations = await prisma.registration.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
      await prisma.$disconnect();
      respondJson(res, 200, { total: registrations.length, registrations });
    } catch (err) {
      respondJson(res, 500, { error: "Failed to fetch registrations" });
    }
    return;
  }

  // Track page views
  if (urlPath === "/" || urlPath === "/editor/index.html") {
    trackVisit(req, "pageView");
  }
  // Track template loads (example JSON fetches)
  if (urlPath.startsWith("/examples/") && urlPath.endsWith("-template.json")) {
    trackVisit(req, "templateLoad");
  }

  // Gate: require login for editor pages when DB is available
  const dbAvailable = templateStoreDb.canUseDb() && authUsers.canUseDb();
  const isEditorPage = urlPath === "/" || urlPath === "/editor/index.html";
  const isPublicPage = urlPath.includes("login") || urlPath.includes("invite") || urlPath.includes("register") || urlPath.startsWith("/landing") || urlPath.startsWith("/api/") || urlPath.startsWith("/examples/") || urlPath.startsWith("/docs/");

  if (dbAvailable && isEditorPage && !isPublicPage) {
    // Check for valid session cookie
    const sessionUser = await authUsers.authenticateSession(req);
    if (!sessionUser) {
      // No session — serve login page
      const loginPath = path.join(root, "/editor/login.html");
      fs.readFile(loginPath, (err, data) => {
        if (err) { res.statusCode = 404; res.end("Not found"); return; }
        res.setHeader("Content-Type", "text/html");
        res.end(data);
      });
      return;
    }
  }

  const filePath = path.join(root, urlPath === "/" ? "/editor/index.html" : urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Cache-Control", ext === ".html" ? "no-cache" : "public, max-age=3600");
    }
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Editor running at http://localhost:${port}`);
  if (demoMode) console.log("Demo mode: ON (write operations blocked)");
});
