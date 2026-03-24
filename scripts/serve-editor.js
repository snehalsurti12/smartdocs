#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const { renderHtml, evaluateDataContract } = require("./render");
const { computeFlowPagesBrowser } = require("./flow-measure");
const { launchChromium } = require("./playwright-launch");
const templateStoreDb = require("./template-store-db");

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
        if (demoMode) { demoBlockedResponse(res); return; }
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
        if (demoMode) { demoBlockedResponse(res); return; }
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
        if (demoMode) { demoBlockedResponse(res); return; }
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

  if (req.method === "POST" && urlPath === "/api/render-pdf") {
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

      const browser = await launchChromium();
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true
      });
      await browser.close();

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/pdf");
      res.end(pdf);
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
      db: templateStoreDb.canUseDb()
    });
    return;
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
