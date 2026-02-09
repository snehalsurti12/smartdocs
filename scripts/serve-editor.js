#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const { renderHtml, evaluateDataContract } = require("./render");
const { computeFlowPagesBrowser } = require("./flow-measure");
const { launchChromium } = require("./playwright-launch");

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

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0] || "/");
  if (req.method === "POST" && urlPath === "/api/render-pdf") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const template = payload.template || {};
        const evaluation = evaluateDataContract(template, payload.data || {});
        const data = evaluation.data;
        if (evaluation.missingRequired && evaluation.missingRequired.length) {
          res.statusCode = 422;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Missing required fields", missingRequired: evaluation.missingRequired }));
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
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "PDF render failed" }));
      }
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
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Editor running at http://localhost:${port}`);
});
