/**
 * Chromium browser pool for efficient PDF rendering.
 * Maintains a single browser instance with reusable page contexts.
 */
const { launchChromium } = require("./playwright-launch");

const POOL_SIZE = Number(process.env.RENDER_POOL_SIZE) || 4;

let browser = null;
let launching = false;
const idle = [];
const waiting = [];
let totalCreated = 0;
let activeCount = 0;

async function ensureBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (launching) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (browser && browser.isConnected()) {
          clearInterval(check);
          resolve(browser);
        }
      }, 100);
    });
  }
  launching = true;
  try {
    browser = await launchChromium();
    browser.on("disconnected", () => {
      browser = null;
      idle.length = 0;
      totalCreated = 0;
      activeCount = 0;
    });
    return browser;
  } finally {
    launching = false;
  }
}

async function acquirePage() {
  if (idle.length > 0) {
    const page = idle.pop();
    activeCount++;
    return page;
  }
  if (totalCreated < POOL_SIZE) {
    const b = await ensureBrowser();
    const context = await b.newContext();
    const page = await context.newPage();
    totalCreated++;
    activeCount++;
    return page;
  }
  // Pool exhausted — wait for a release
  return new Promise((resolve) => {
    waiting.push(resolve);
  });
}

function releasePage(page) {
  activeCount--;
  if (waiting.length > 0) {
    const resolve = waiting.shift();
    activeCount++;
    resolve(page);
    return;
  }
  // Return to idle pool, but close context if pool is oversized
  if (idle.length >= POOL_SIZE) {
    page.context().close().catch(() => {});
    totalCreated = Math.max(0, totalCreated - 1);
    return;
  }
  // Reset page before returning to pool
  page.setContent("<html><body></body></html>", { waitUntil: "commit" })
    .then(() => { idle.push(page); })
    .catch(() => {
      page.context().close().catch(() => {});
      totalCreated = Math.max(0, totalCreated - 1);
    });
}

function getPoolStats() {
  return {
    poolSize: POOL_SIZE,
    totalCreated,
    active: activeCount,
    idle: idle.length,
    waiting: waiting.length,
    browserConnected: browser ? browser.isConnected() : false
  };
}

async function shutdown() {
  waiting.length = 0;
  for (const page of idle) {
    try { await page.context().close(); } catch (_e) {}
  }
  idle.length = 0;
  if (browser) {
    try { await browser.close(); } catch (_e) {}
    browser = null;
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = { acquirePage, releasePage, getPoolStats, shutdown };
