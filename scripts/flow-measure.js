const { buildFontCss } = require("./render");
const { launchChromium } = require("./playwright-launch");

function resolvePath(obj, pathStr) {
  if (!pathStr) return undefined;
  const normalized = pathStr.replace(/\[(\w+)\]/g, ".$1");
  const parts = normalized.split(".").filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function resolveText(text, data) {
  if (typeof text !== "string") return "";
  const resolved = text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, p1) => {
    const key = p1.trim();
    const val = resolvePath(data, key);
    return val == null ? "" : String(val);
  });
  return resolved
    .replace(/\\\\r\\\\n/g, "\n")
    .replace(/\\\\n/g, "\n")
    .replace(/\\\\t/g, "\t")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function tokenizeText(text) {
  const raw = String(text || "").replace(/\r/g, "");
  const parts = raw.split(/(\n\s*\n)/);
  const tokens = [];
  parts.forEach((part) => {
    if (part.trim() === "" && part.includes("\n")) {
      tokens.push("\n\n");
      return;
    }
    const words = part.trim().split(/\s+/).filter(Boolean);
    words.forEach((w) => tokens.push(w));
  });
  return tokens;
}

function buildText(tokens) {
  let out = "";
  tokens.forEach((t) => {
    if (t === "\n\n") {
      out = out.trimEnd() + "\n\n";
      return;
    }
    if (!out || out.endsWith("\n")) {
      out += t;
    } else {
      out += ` ${t}`;
    }
  });
  return out;
}

async function computeFlowPagesBrowser(el, data, template, regionW, regionH) {
  const defaultText = template.styles && template.styles.defaultText;
  const style = { ...(defaultText || {}), ...(el.style || {}) };
  const fontSize = style.size || 11;
  const lineHeight = style.lineHeight || Math.round(fontSize * 1.2);
  const columns = el.columns || 1;
  const gap = el.gap || 12;
  const flowW = el.w && el.w > 0 ? el.w : regionW - el.x;
  const flowH = el.h && el.h > 0 ? el.h : regionH - el.y;

  const fontCss = buildFontCss(template);
  const fontFamily = style.font ? style.font : "serif";

  const resolved = resolveText(el.text || "", data);
  const tokens = tokenizeText(resolved);

  const browser = await launchChromium();
  const page = await browser.newPage();
  await page.setContent(`
    <html>
      <head>
        <style>
          ${fontCss}
          body { margin: 0; }
          #box {
            width: ${flowW}pt;
            height: ${flowH}pt;
            column-count: ${columns};
            column-gap: ${gap}pt;
            column-fill: auto;
            font-family: ${fontFamily};
            font-size: ${fontSize}pt;
            line-height: ${lineHeight}pt;
            white-space: pre-wrap;
            overflow: hidden;
          }
        </style>
      </head>
      <body>
        <div id="box"></div>
      </body>
    </html>
  `);

  const pages = [];
  let idx = 0;

  while (idx < tokens.length) {
    let lo = 1;
    let hi = tokens.length - idx;
    let best = 1;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const slice = tokens.slice(idx, idx + mid);
      const text = buildText(slice);
      const fits = await page.evaluate((t) => {
        const box = document.getElementById("box");
        box.textContent = t;
        return box.scrollWidth <= box.clientWidth && box.scrollHeight <= box.clientHeight;
      }, text);

      if (fits) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const pageTokens = tokens.slice(idx, idx + best);
    pages.push(buildText(pageTokens));
    idx += best;
  }

  await browser.close();

  return {
    pages,
    columnWidth: columns > 1 ? (flowW - gap * (columns - 1)) / columns : flowW,
    flowH,
    gap,
    columns,
    lineHeight,
    mode: "browser"
  };
}

module.exports = {
  computeFlowPagesBrowser
};
