const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");

function fileExists(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  try {
    return fs.existsSync(filePath);
  } catch (_err) {
    return false;
  }
}

function candidateExecutables() {
  const root = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const envExecutable = process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  return [
    envExecutable,
    path.join(
      root,
      "chromium_headless_shell-1208",
      "chrome-headless-shell-mac-arm64",
      "chrome-headless-shell"
    ),
    path.join(
      root,
      "chromium_headless_shell-1208",
      "chrome-headless-shell-mac-x64",
      "chrome-headless-shell"
    ),
    path.join(
      root,
      "chromium-1208",
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing"
    ),
    path.join(
      root,
      "chromium-1208",
      "chrome-mac-x64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing"
    ),
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter(fileExists);
}

async function launchChromium(opts = {}) {
  try {
    return await chromium.launch(opts);
  } catch (err) {
    const msg = String(err && err.message ? err.message : "");
    if (!msg.includes("Executable doesn't exist")) throw err;

    const candidates = candidateExecutables();
    for (const executablePath of candidates) {
      try {
        return await chromium.launch({ ...opts, executablePath });
      } catch (_fallbackErr) {
        // Keep trying fallbacks.
      }
    }
    throw err;
  }
}

module.exports = {
  launchChromium
};
