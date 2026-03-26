#!/usr/bin/env node
/**
 * Seed an admin user for a tenant.
 *
 * Usage:
 *   node scripts/seed-admin.js <tenantId> <email> <password> [name]
 *
 * Or via env vars:
 *   TENANT_ID=xxx INITIAL_ADMIN_EMAIL=admin@co.com INITIAL_ADMIN_PASSWORD=secret node scripts/seed-admin.js
 */
const authUsers = require("./auth-users");

async function main() {
  const tenantId = process.argv[2] || process.env.TENANT_ID;
  const email = process.argv[3] || process.env.INITIAL_ADMIN_EMAIL;
  const password = process.argv[4] || process.env.INITIAL_ADMIN_PASSWORD;
  const name = process.argv[5] || process.env.INITIAL_ADMIN_NAME || "Admin";

  if (!tenantId || !email || !password) {
    console.error("Usage: node scripts/seed-admin.js <tenantId> <email> <password> [name]");
    console.error("  Or set TENANT_ID, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD env vars.");
    process.exit(1);
  }

  try {
    const user = await authUsers.seedAdmin(tenantId, email, password, name);
    console.log(`Done. User ID: ${user.id}, Role: ${user.role}`);
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
