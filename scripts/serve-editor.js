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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
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

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0] || "/");
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
    try {
      const payload = await readJsonBody(req);
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

  const filePath = path.join(root, urlPath === "/" ? "/editor/index.html" : urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Editor running at http://localhost:${port}`);
});
