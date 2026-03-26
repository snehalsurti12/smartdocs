/**
 * Captures a screenshot of the editor with a template loaded.
 * Usage: node scripts/capture-editor-screenshot.js [template-path]
 * Default: /examples/bank-statement-template.json
 */
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.EDITOR_URL || "http://localhost:5177";
const templatePath = process.argv[2] || "/examples/bank-statement-template.json";
const outFile = path.join(__dirname, "..", "docs", "screenshots", "editor-with-template.jpg");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Set cookie to bypass registration gate
  await page.context().addCookies([{
    name: "smartdocs_registered",
    value: "1",
    domain: new URL(BASE).hostname,
    path: "/"
  }]);

  await page.goto(`${BASE}/editor/index.html`, { waitUntil: "networkidle" });

  // Load a starter template
  await page.evaluate((tplPath) => {
    const select = document.getElementById("starter-template-select");
    if (select) {
      select.value = tplPath;
      select.dispatchEvent(new Event("change"));
    }
  }, templatePath);

  // Wait for template to load and render
  await page.waitForTimeout(2000);

  await page.screenshot({ path: outFile, type: "jpeg", quality: 90 });
  console.log("Screenshot saved to", outFile);

  await browser.close();
})();
