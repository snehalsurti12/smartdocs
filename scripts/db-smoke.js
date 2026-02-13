#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  canUseDb,
  createTemplate,
  createTemplateVersion,
  listTemplates
} = require("./template-store-db");

async function main() {
  if (!canUseDb()) {
    console.error("Database not configured. Set DATABASE_URL and install Prisma packages.");
    process.exit(1);
  }

  const templatePath = path.join(__dirname, "..", "examples", "template.json");
  const templateJson = JSON.parse(fs.readFileSync(templatePath, "utf8"));

  const created = await createTemplate({
    name: "Smoke Test Template",
    description: "Created by scripts/db-smoke.js",
    contentJson: templateJson,
    actorId: "smoke-test"
  });

  const updatedTemplate = { ...templateJson, version: "1.0.1-smoke" };
  await createTemplateVersion(created.id, {
    contentJson: updatedTemplate,
    actorId: "smoke-test"
  });

  const templates = await listTemplates();
  console.log(`DB smoke test complete. Templates: ${templates.length}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
