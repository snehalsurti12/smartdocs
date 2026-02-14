#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const GOLDEN_DIR = path.join(ROOT, "tests", "goldens", "pdf");
const OUT_DIR = path.join(ROOT, "out", "golden-pdf");
const RENDER_SCRIPT = path.join(ROOT, "scripts", "render-pdf.js");

const CASES = [
  {
    id: "invoice",
    template: path.join(ROOT, "examples", "template.json"),
    data: path.join(ROOT, "examples", "data.json")
  },
  {
    id: "credit-card",
    template: path.join(ROOT, "examples", "cc-template.json"),
    data: path.join(ROOT, "examples", "cc-data.json")
  },
  {
    id: "bank-statement",
    template: path.join(ROOT, "examples", "bank-statement-template.json"),
    data: path.join(ROOT, "examples", "bank-statement-data.json")
  },
  {
    id: "enterprise-cover",
    template: path.join(ROOT, "examples", "enterprise-cover-template.json"),
    data: path.join(ROOT, "examples", "enterprise-cover-data.json")
  }
];

function parseArgs(argv) {
  const out = { update: false };
  argv.forEach((arg) => {
    if (arg === "--update") out.update = true;
  });
  return out;
}

function normalizePdfForHash(buf) {
  let text = buf.toString("latin1");
  text = text
    .replace(/\/CreationDate\s*\(D:[^\)]*\)/g, "/CreationDate(D:STAMP)")
    .replace(/\/ModDate\s*\(D:[^\)]*\)/g, "/ModDate(D:STAMP)")
    .replace(/<xmp:CreateDate>[^<]*<\/xmp:CreateDate>/g, "<xmp:CreateDate>STAMP</xmp:CreateDate>")
    .replace(/<xmp:ModifyDate>[^<]*<\/xmp:ModifyDate>/g, "<xmp:ModifyDate>STAMP</xmp:ModifyDate>")
    .replace(/\/ID\s*\[\s*<[^>]+>\s*<[^>]+>\s*\]/g, "/ID[<ID><ID>]");
  return Buffer.from(text, "latin1");
}

function countPdfPages(buf) {
  const text = buf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

function fileSha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function buildSignature(pdfPath) {
  const raw = fs.readFileSync(pdfPath);
  const normalized = normalizePdfForHash(raw);
  return {
    schema: "smartdocs-golden-pdf@1",
    pageCount: countPdfPages(normalized),
    bytes: normalized.length,
    sha256: fileSha256(normalized)
  };
}

function runRenderCase(testCase, outPdf) {
  const args = [
    RENDER_SCRIPT,
    "--template",
    testCase.template,
    "--data",
    testCase.data,
    "--out",
    outPdf
  ];
  execFileSync(process.execPath, args, {
    stdio: "pipe",
    cwd: ROOT,
    env: process.env
  });
}

function readGolden(goldenPath) {
  return JSON.parse(fs.readFileSync(goldenPath, "utf8"));
}

function writeGolden(goldenPath, signature) {
  fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
  fs.writeFileSync(goldenPath, `${JSON.stringify(signature, null, 2)}\n`);
}

function diffSignature(expected, actual) {
  const diffs = [];
  if (expected.schema !== actual.schema) diffs.push(`schema: expected ${expected.schema}, got ${actual.schema}`);
  if (expected.pageCount !== actual.pageCount) diffs.push(`pageCount: expected ${expected.pageCount}, got ${actual.pageCount}`);
  if (expected.bytes !== actual.bytes) diffs.push(`bytes: expected ${expected.bytes}, got ${actual.bytes}`);
  if (expected.sha256 !== actual.sha256) diffs.push(`sha256: expected ${expected.sha256}, got ${actual.sha256}`);
  return diffs;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  let failures = 0;

  CASES.forEach((testCase) => {
    const outPdf = path.join(OUT_DIR, `${testCase.id}.pdf`);
    const goldenPath = path.join(GOLDEN_DIR, `${testCase.id}.json`);
    const hadGolden = fs.existsSync(goldenPath);
    try {
      runRenderCase(testCase, outPdf);
    } catch (err) {
      failures += 1;
      const stderr = err && err.stderr ? String(err.stderr) : "";
      console.error(`[golden:pdf] ${testCase.id}: render failed`);
      if (stderr.trim()) console.error(stderr.trim());
      return;
    }

    const actual = buildSignature(outPdf);
    if (args.update || !hadGolden) {
      writeGolden(goldenPath, actual);
      console.log(`[golden:pdf] ${testCase.id}: ${hadGolden ? "updated" : "created"} ${path.relative(ROOT, goldenPath)}`);
      return;
    }

    const expected = readGolden(goldenPath);
    const diffs = diffSignature(expected, actual);
    if (diffs.length) {
      failures += 1;
      console.error(`[golden:pdf] ${testCase.id}: mismatch`);
      diffs.forEach((d) => console.error(`  - ${d}`));
      return;
    }
    console.log(`[golden:pdf] ${testCase.id}: ok`);
  });

  if (failures > 0) {
    console.error(`[golden:pdf] failed: ${failures} case(s) differ from golden snapshots.`);
    process.exit(1);
  }
  console.log("[golden:pdf] all cases match.");
}

main();
