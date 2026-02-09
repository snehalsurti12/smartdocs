#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const { renderHtml, readJson, evaluateDataContract } = require("./render");
const { computeFlowPagesBrowser } = require("./flow-measure");
const { launchChromium } = require("./playwright-launch");

const DEFAULT_TEMPLATE = path.join(__dirname, "..", "examples", "template.json");
const DEFAULT_DATA = path.join(__dirname, "..", "examples", "data.json");
const DEFAULT_OUT = path.join(__dirname, "..", "out", "render.pdf");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = argv[i + 1];
      if (!val || val.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = val;
        i += 1;
      }
    }
  }
  return args;
}

function printHelp() {
  const msg = `
Usage:
  node scripts/render-pdf.js --template examples/template.json --data examples/data.json --out out/render.pdf

Defaults:
  --template ${path.relative(process.cwd(), DEFAULT_TEMPLATE)}
  --data     ${path.relative(process.cwd(), DEFAULT_DATA)}
  --out      ${path.relative(process.cwd(), DEFAULT_OUT)}
  `.trim();
  console.log(msg);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const templatePath = args.template || DEFAULT_TEMPLATE;
  const dataPath = args.data || DEFAULT_DATA;
  const outPath = args.out || DEFAULT_OUT;

  const template = readJson(templatePath);
  const rawData = readJson(dataPath);
  const evaluation = evaluateDataContract(template, rawData);
  const data = evaluation.data;
  let flowData = null;
  if (template.options && template.options.flowMeasure === "browser") {
    const page = template.page;
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

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const browser = await launchChromium();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: outPath,
    printBackground: true,
    preferCSSPageSize: true
  });
  await browser.close();

  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
