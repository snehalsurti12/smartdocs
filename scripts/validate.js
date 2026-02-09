#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv/dist/2020");

const DEFAULT_TEMPLATE = path.join(__dirname, "..", "examples", "template.json");
const DEFAULT_SCHEMA = path.join(__dirname, "..", "schemas", "template.schema.json");

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function printHelp() {
  const msg = `
Usage:
  node scripts/validate.js --template examples/template.json --schema schemas/template.schema.json

Defaults:
  --template ${path.relative(process.cwd(), DEFAULT_TEMPLATE)}
  --schema   ${path.relative(process.cwd(), DEFAULT_SCHEMA)}
  `.trim();
  console.log(msg);
}

function formatErrors(errors) {
  return errors.map((err) => {
    const pathStr = err.instancePath || "(root)";
    const msg = err.message || "invalid";
    return `- ${pathStr}: ${msg}`;
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const templatePath = args.template || DEFAULT_TEMPLATE;
  const schemaPath = args.schema || DEFAULT_SCHEMA;

  const template = readJson(templatePath);
  const schema = readJson(schemaPath);

  const ajv = new Ajv({ allErrors: true, strict: false, unevaluated: true });
  const validate = ajv.compile(schema);
  const valid = validate(template);

  if (valid) {
    console.log("Template is valid.");
    return;
  }

  console.error("Template is invalid:");
  for (const line of formatErrors(validate.errors || [])) {
    console.error(line);
  }
  process.exit(1);
}

main();
