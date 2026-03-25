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
          actorId: payload.actorId || "editor"
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
  } catch (err) {
    const message = err && err.message ? err.message : "Request failed";
    const status = message.toLowerCase().includes("not found") ? 404 : 400;
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
      const fields = (contract.fields || []).map((f) => ({
        path: f.path,
        required: Boolean(f.required),
        type: f.type || "string",
        transform: f.transform || "none",
        pii: Boolean(f.pii),
        piiCategory: f.piiCategory || null,
        defaultValue: f.defaultValue
      }));
      respondJson(res, 200, {
        templateId: tmpl.id,
        templateName: tmpl.name,
        version: tmpl.currentVersion.version,
        fields
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

  // Track page views
  if (urlPath === "/" || urlPath === "/editor/index.html") {
    trackVisit(req, "pageView");
  }
  // Track template loads (example JSON fetches)
  if (urlPath.startsWith("/examples/") && urlPath.endsWith("-template.json")) {
    trackVisit(req, "templateLoad");
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
