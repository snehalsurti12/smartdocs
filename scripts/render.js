#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const DEFAULT_TEMPLATE = path.join(__dirname, "..", "examples", "template.json");
const DEFAULT_DATA = path.join(__dirname, "..", "examples", "data.json");
const DEFAULT_OUT = path.join(__dirname, "..", "out", "render.html");

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

function normalizeBinding(str) {
  if (!str || typeof str !== "string") return "";
  const match = str.match(/^\s*\{\{\s*(.+?)\s*\}\}\s*$/);
  return match ? match[1].trim() : str.trim();
}

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

function setPath(obj, pathStr, value) {
  if (!pathStr) return;
  const normalized = pathStr.replace(/\[(\w+)\]/g, ".$1");
  const parts = normalized.split(".").filter(Boolean);
  if (!parts.length) return;
  let current = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (current[key] == null || typeof current[key] !== "object") current[key] = {};
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}

function hasValue(v) {
  return !(v === undefined || v === null || v === "");
}

function toTitleCase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (m, p1) => p1.toUpperCase());
}

function applyTransform(value, field, template) {
  const transform = field && field.transform ? String(field.transform) : "none";
  if (!transform || transform === "none") return { value };

  try {
    if (transform === "trim") {
      return { value: typeof value === "string" ? value.trim() : value };
    }
    if (transform === "uppercase") {
      return { value: typeof value === "string" ? value.toUpperCase() : String(value).toUpperCase() };
    }
    if (transform === "lowercase") {
      return { value: typeof value === "string" ? value.toLowerCase() : String(value).toLowerCase() };
    }
    if (transform === "titlecase") {
      return { value: toTitleCase(value) };
    }
    if (transform === "number") {
      const num = Number(value);
      if (Number.isNaN(num)) return { value, error: `Cannot convert to number: ${value}` };
      return { value: num };
    }
    if (transform === "boolean") {
      if (typeof value === "boolean") return { value };
      const text = String(value).trim().toLowerCase();
      if (["true", "1", "yes", "y"].includes(text)) return { value: true };
      if (["false", "0", "no", "n"].includes(text)) return { value: false };
      return { value: Boolean(value) };
    }
    if (transform === "date") {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return { value, error: `Cannot parse date: ${value}` };
      const locale = field.transformLocale || "en-US";
      const dateStyle = field.transformDateStyle || "medium";
      const formatter = new Intl.DateTimeFormat(locale, { dateStyle });
      return { value: formatter.format(date) };
    }
    if (transform === "currency") {
      const num = Number(value);
      if (Number.isNaN(num)) return { value, error: `Cannot parse currency number: ${value}` };
      const locale = field.transformLocale || "en-US";
      const currency =
        field.transformCurrency ||
        (template && template.variables && template.variables.currency) ||
        "USD";
      const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
      return { value: formatter.format(num) };
    }
    return { value };
  } catch (err) {
    return { value, error: err && err.message ? err.message : "Transform error" };
  }
}

function evaluateDataContract(template, inputData) {
  const contract = template && template.dataContract;
  if (!contract || !Array.isArray(contract.fields) || !contract.fields.length) {
    return { data: inputData || {}, fields: [], missingRequired: [] };
  }
  const source = inputData || {};
  const out = JSON.parse(JSON.stringify(source));
  const fields = [];
  const missingRequired = [];
  contract.fields.forEach((field) => {
    if (!field || !field.path) return;
    const sourceKind = field.source || "external";
    const externalPath = field.externalPath || field.path;
    const info = {
      path: field.path,
      required: Boolean(field.required),
      source: sourceKind,
      externalPath,
      transform: field.transform || "none",
      usedDefault: false,
      missing: false,
      error: ""
    };
    let value;
    if (sourceKind === "external") {
      value = resolvePath(source, externalPath);
      if (!hasValue(value)) value = resolvePath(out, field.path);
      if (!hasValue(value) && field.defaultValue !== undefined) {
        value = field.defaultValue;
        info.usedDefault = true;
      }
    } else {
      value = resolvePath(out, field.path);
      if (!hasValue(value) && field.defaultValue !== undefined) {
        value = field.defaultValue;
        info.usedDefault = true;
      }
    }
    if (!hasValue(value)) {
      if (info.required) {
        info.missing = true;
        missingRequired.push(field.path);
      }
      fields.push(info);
      return;
    }
    const transformed = applyTransform(value, field, template);
    if (transformed.error) info.error = transformed.error;
    value = transformed.value;
    if (hasValue(value)) {
      setPath(out, field.path, value);
      info.value = value;
    }
    fields.push(info);
  });
  return { data: out, fields, missingRequired };
}

function applyDataContract(template, inputData) {
  return evaluateDataContract(template, inputData).data;
}

function decodeEscapedText(value) {
  return String(value)
    .replace(/\\\\r\\\\n/g, "\n")
    .replace(/\\\\n/g, "\n")
    .replace(/\\\\t/g, "\t")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function resolveText(text, data, ctx) {
  if (typeof text !== "string") return "";
  const resolved = text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, p1) => {
    const key = p1.trim();
    if (key === "page.number") return String(ctx && ctx.pageNumber ? ctx.pageNumber : 1);
    if (key === "page.count") return String(ctx && ctx.pageCount ? ctx.pageCount : 1);
    const val = resolvePath(data, key);
    return val == null ? "" : String(val);
  });
  return decodeEscapedText(resolved);
}

function splitByOperator(expr, op) {
  return expr.split(op).map((part) => part.trim()).filter(Boolean);
}

function parseLiteral(raw) {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (!Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function compareValues(left, op, right) {
  if (op === "==") return left === right;
  if (op === "!=") return left !== right;
  if (op === ">") return left > right;
  if (op === "<") return left < right;
  if (op === ">=") return left >= right;
  if (op === "<=") return left <= right;
  return false;
}

function evalValue(expr, data) {
  const trimmed = expr.trim();
  const existsMatch = trimmed.match(/^exists\((.+)\)$/);
  if (existsMatch) {
    const val = resolvePath(data, existsMatch[1].trim());
    return val !== undefined && val !== null && val !== "";
  }
  const lenMatch = trimmed.match(/^len\((.+)\)$/);
  if (lenMatch) {
    const val = resolvePath(data, lenMatch[1].trim());
    if (Array.isArray(val) || typeof val === "string") return val.length;
    return 0;
  }
  return resolvePath(data, trimmed);
}

function evalAtom(expr, data) {
  const trimmed = expr.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  const compareMatch = trimmed.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (compareMatch) {
    const leftVal = evalValue(compareMatch[1], data);
    const rightVal = parseLiteral(compareMatch[3]);
    return compareValues(leftVal, compareMatch[2], rightVal);
  }

  const val = evalValue(trimmed, data);
  return Boolean(val);
}

function evalNot(expr, data) {
  const trimmed = expr.trim();
  if (trimmed.startsWith("!")) {
    return !evalNot(trimmed.slice(1), data);
  }
  return evalAtom(trimmed, data);
}

function evalAnd(expr, data) {
  const parts = splitByOperator(expr, "&&");
  if (parts.length > 1) return parts.every((part) => evalNot(part, data));
  return evalNot(expr, data);
}

function evalOr(expr, data) {
  const parts = splitByOperator(expr, "||");
  if (parts.length > 1) return parts.some((part) => evalAnd(part, data));
  return evalAnd(expr, data);
}

function isVisible(visibleIf, data) {
  if (!visibleIf) return true;
  return evalOr(visibleIf, data);
}

function pt(val) {
  return `${val}pt`;
}

function fontFamilyFrom(template, fontName) {
  if (!fontName) return undefined;
  const fonts = template.fonts || [];
  const font = fonts.find((f) => f.name === fontName);
  const quote = (name) => {
    const value = String(name || "");
    return /\s/.test(value) ? `'${value.replace(/'/g, "\\'")}'` : value;
  };
  if (!font) return quote(fontName);
  if (font.fallback && font.fallback.length) {
    return [fontName, ...font.fallback].map(quote).join(", ");
  }
  return quote(fontName);
}

function mergeStyles(base, override) {
  return { ...(base || {}), ...(override || {}) };
}

function styleToCss(style, template) {
  if (!style) return "";
  const css = [];
  if (style.font) {
    const family = fontFamilyFrom(template, style.font);
    if (family) css.push(`font-family:${family}`);
  }
  if (style.size) css.push(`font-size:${pt(style.size)}`);
  if (style.weight) css.push(`font-weight:${style.weight}`);
  if (style.fontStyle) css.push(`font-style:${style.fontStyle}`);
  if (style.color) css.push(`color:${style.color}`);
  if (style.align) css.push(`text-align:${style.align}`);
  if (style.lineHeight) css.push(`line-height:${pt(style.lineHeight)}`);
  if (style.borderColor && style.borderWidth != null) {
    css.push(`border:${pt(style.borderWidth)} solid ${style.borderColor}`);
  }
  if (style.borderRadius != null) css.push(`border-radius:${pt(style.borderRadius)}`);
  if (style.fill) css.push(`background-color:${style.fill}`);
  if (style.opacity != null) css.push(`opacity:${style.opacity}`);
  return css.join(";");
}

function formatValue(val, col, template) {
  if (val == null) return "";
  if (!col || !col.format) return String(val);

  const currency = (template.variables && template.variables.currency) || "USD";
  if (col.format === "currency") {
    const num = Number(val);
    if (Number.isNaN(num)) return String(val);
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(num);
  }
  if (col.format === "number") {
    const num = Number(val);
    if (Number.isNaN(num)) return String(val);
    const precision = Number.isInteger(col.precision) ? col.precision : undefined;
    return new Intl.NumberFormat("en-US", precision != null ? { minimumFractionDigits: precision, maximumFractionDigits: precision } : undefined).format(num);
  }
  return String(val);
}

function renderTable(el, data, template, ctx, rowOverride, renderOpts = null) {
  const rowsPath = normalizeBinding(el.rows);
  const rows = resolvePath(data, rowsPath);
  const list = rowOverride || (Array.isArray(rows) ? rows : []);
  const rowH =
    (el.pagination && el.pagination.rowHeight) ||
    (el.rowStyle && el.rowStyle.lineHeight) ||
    14;
  let displayRows = Array.isArray(list) ? list.slice() : [];
  if (el.fillMode === "pad") {
    const targetH =
      renderOpts && Number.isFinite(renderOpts.height) ? renderOpts.height : (el.h && el.h > 0 ? el.h : 0);
    if (targetH > rowH) {
      const maxRows = Math.max(0, Math.floor((targetH - rowH) / rowH));
      if (displayRows.length < maxRows) {
        displayRows = displayRows.concat(Array.from({ length: maxRows - displayRows.length }, () => ({})));
      }
    }
  }
  const colgroup = el.columns
    .map((col) => `<col style="width:${pt(col.w)};" />`)
    .join("");

  const headerStyle = styleToCss(mergeStyles(template.styles && template.styles.defaultText, el.headerStyle), template);
  const rowStyle = styleToCss(mergeStyles(template.styles && template.styles.defaultText, el.rowStyle), template);

  const headers = el.columns
    .map(
      (col) =>
        `<th style="${headerStyle};text-align:${col.align || "left"};height:${pt(rowH)};line-height:${pt(
          Math.max(0, rowH - 4)
        )};">${col.header || ""}</th>`
    )
    .join("");

  const body = displayRows
    .map((row) => {
      const cells = el.columns
        .map((col) => {
          const value = resolvePath(row, col.field);
          const rendered = formatValue(value, col, template);
          return `<td style="${rowStyle};text-align:${col.align || "left"};height:${pt(
            rowH
          )};line-height:${pt(Math.max(0, rowH - 4))};">${rendered}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
    <table class="tbl">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${headers}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function joinVisibleIf(parentExpr, childExpr) {
  if (parentExpr && childExpr) return `(${parentExpr}) && (${childExpr})`;
  return parentExpr || childExpr || "";
}

function expandIncludes(elements, template) {
  const partials = template.partials || {};
  const expanded = [];

  for (const el of elements) {
    if (el.type !== "include") {
      expanded.push(el);
      continue;
    }
    const partial = partials[el.ref];
    if (!partial || !Array.isArray(partial.elements)) {
      continue;
    }
    for (const child of partial.elements) {
      const clone = {
        ...child,
        id: `${el.id}__${child.id}`,
        x: (child.x || 0) + (el.x || 0),
        y: (child.y || 0) + (el.y || 0),
        region: el.region || child.region,
        visibleIf: joinVisibleIf(el.visibleIf, child.visibleIf)
      };
      expanded.push(clone);
    }
  }

  return expanded;
}

function wrapTextIntoLines(text, maxChars) {
  if (!text) return [];
  const lines = [];
  const paragraphs = text.split(/\n\s*\n/);
  const limit = Math.max(1, Math.floor(maxChars));

  paragraphs.forEach((para, pIndex) => {
    const words = para.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    let line = "";
    words.forEach((word) => {
      if (!line) {
        if (word.length > limit) {
          for (let i = 0; i < word.length; i += limit) {
            lines.push(word.slice(i, i + limit));
          }
        } else {
          line = word;
        }
        return;
      }
      if (line.length + word.length + 1 <= limit) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    if (pIndex < paragraphs.length - 1) lines.push("");
  });

  return lines;
}

function computeFlowPages(el, data, template, regionW, regionH) {
  const defaultText = template.styles && template.styles.defaultText;
  const style = { ...(defaultText || {}), ...(el.style || {}) };
  const fontSize = style.size || 11;
  const lineHeight = style.lineHeight || Math.round(fontSize * 1.2);
  const columns = el.columns || 1;
  const gap = el.gap || 12;
  const flowW = el.w && el.w > 0 ? el.w : regionW - el.x;
  const flowH = el.h && el.h > 0 ? el.h : regionH - el.y;
  const columnWidth = columns > 1 ? (flowW - gap * (columns - 1)) / columns : flowW;
  const maxChars = columnWidth / (fontSize * 0.55);
  const lines = wrapTextIntoLines(resolveText(el.text || "", data), maxChars);

  const linesPerColumn = Math.max(1, Math.floor(flowH / lineHeight));
  const linesPerPage = Math.max(1, linesPerColumn * columns);
  const pages = [];

  for (let i = 0; i < lines.length; i += linesPerPage) {
    const chunk = lines.slice(i, i + linesPerPage);
    const cols = [];
    for (let c = 0; c < columns; c += 1) {
      const start = c * linesPerColumn;
      const end = start + linesPerColumn;
      cols.push(chunk.slice(start, end).join("\n"));
    }
    pages.push(cols);
  }

  if (pages.length === 0) pages.push([""]);
  return { pages, lineHeight, columnWidth, flowH, gap, columns };
}

function computeTablePages(el, data, template, regionH, pageSpace = {}) {
  if (!el.pagination || el.pagination.mode !== "auto") return null;
  const rowsPath = normalizeBinding(el.rows);
  const rows = resolvePath(data, rowsPath);
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { pages: [[]], rowHeight: 0 };

  const rowH =
    (el.pagination && el.pagination.rowHeight) ||
    (el.rowStyle && el.rowStyle.lineHeight) ||
    14;
  const headerH = rowH;
  const firstY = el.y || 0;
  const continuationY = el.continuationY != null ? el.continuationY : firstY;
  const explicitAvailableFirst = el.h && el.h > 0 ? el.h : null;
  const explicitAvailableOther = el.continuationH && el.continuationH > 0 ? el.continuationH : null;
  const baseAvailableFirst =
    explicitAvailableFirst != null ? explicitAvailableFirst : Math.max(0, regionH - firstY);
  const baseAvailableOther =
    explicitAvailableOther != null ? explicitAvailableOther : Math.max(0, regionH - continuationY);
  const firstAvailable = Math.max(
    0,
    Math.min(
      baseAvailableFirst,
      pageSpace.firstAvailable != null ? pageSpace.firstAvailable : baseAvailableFirst
    )
  );
  const otherAvailable = Math.max(
    0,
    Math.min(
      baseAvailableOther,
      pageSpace.otherAvailable != null ? pageSpace.otherAvailable : baseAvailableOther
    )
  );
  const perFirst = Math.max(1, Math.floor((firstAvailable - headerH) / rowH));
  const perOther = Math.max(1, Math.floor((otherAvailable - headerH) / rowH));

  const pages = [];
  let index = 0;
  let pageIndex = 0;
  while (index < list.length) {
    const perPage = pageIndex === 0 ? perFirst : perOther;
    pages.push(list.slice(index, index + perPage));
    index += perPage;
    pageIndex += 1;
  }
  return { pages, rowHeight: rowH, firstAvailable, otherAvailable };
}

function shouldRenderInPage(el, pageIndex, pageCount, region) {
  const explicitPage = Number(el.page);
  if (Number.isFinite(explicitPage) && explicitPage >= 1) {
    return pageIndex === Math.floor(explicitPage) - 1;
  }
  const repeat = el.repeat || (region === "body" ? "first" : "all");
  if (repeat === "all") return true;
  if (repeat === "first") return pageIndex === 0;
  if (repeat === "afterFirst") return pageIndex > 0;
  if (repeat === "middle") return pageIndex > 0 && pageIndex < pageCount - 1;
  if (repeat === "last") return pageIndex === pageCount - 1;
  return pageIndex === 0;
}

function renderElement(el, data, template, ctx) {
  if (!isVisible(el.visibleIf, data)) return "";
  const baseStyle = [
    `left:${pt(el.x)}`,
    `top:${pt(el.y)}`,
    `width:${pt(el.w)}`,
    `height:${pt(el.h)}`,
    el.zIndex != null ? `z-index:${el.zIndex}` : null
  ]
    .filter(Boolean)
    .join(";");

  const defaultText = template.styles && template.styles.defaultText;
  const mergedStyle = mergeStyles(defaultText, el.style);
  const textStyle = styleToCss(mergedStyle, template);

  if (el.type === "text") {
    const text = resolveText(el.text, data, ctx);
    if (el.richText) {
      return `<div class="el text" data-id="${el.id}" style="${baseStyle};${textStyle};white-space:normal;">${text}</div>`;
    }
    return `<div class="el text" data-id="${el.id}" style="${baseStyle};${textStyle};white-space:pre-wrap;">${escapeHtml(text)}</div>`;
  }

  if (el.type === "image") {
    const src = resolveText(el.src, data, ctx);
    const fit = el.fit || "contain";
    return `<img class="el image" data-id="${el.id}" src="${src}" style="${baseStyle};object-fit:${fit};" />`;
  }

  if (el.type === "table") {
    const tableHtml = renderTable(el, data, template, ctx, null, { height: el.h });
    return `<div class="el table" data-id="${el.id}" style="${baseStyle};overflow:hidden;">${tableHtml}</div>`;
  }

  if (el.type === "qr") {
    const value = resolveText(el.value, data, ctx);
    const qrSvg = renderQrSvg(value, el.w, el.h);
    return `<div class="el qr" data-id="${el.id}" style="${baseStyle};background:#fff;overflow:hidden;">${qrSvg}</div>`;
  }

  if (el.type === "line") {
    const border = el.style && el.style.borderColor ? el.style.borderColor : "#333";
    const width = el.style && el.style.borderWidth != null ? el.style.borderWidth : 1;
    return `<div class="el line" data-id="${el.id}" style="${baseStyle};border-top:${pt(width)} solid ${border};height:0;"></div>`;
  }

  if (el.type === "box") {
    const boxStyle = styleToCss(el.style, template);
    return `<div class="el box" data-id="${el.id}" style="${baseStyle};${boxStyle};"></div>`;
  }

  if (el.type === "barcode") {
    const value = resolveText(el.value, data, ctx);
    const format = el.format || "code128";
    const barH = el.h - 12;
    return `<div class="el barcode" data-id="${el.id}" data-format="${format}" style="${baseStyle};display:flex;flex-direction:column;overflow:hidden;background:#fff;padding:3pt 6pt;border-radius:2pt;">` +
      `<svg viewBox="0 0 ${el.w} ${barH}" preserveAspectRatio="none" style="width:100%;height:${barH}pt;display:block;flex-shrink:0;" xmlns="http://www.w3.org/2000/svg">${renderBarcodeSvg(value, el.w, barH)}</svg>` +
      `<div style="text-align:center;font-size:7pt;font-family:monospace;line-height:11pt;letter-spacing:0.5pt;color:#333;">${escapeHtml(value)}</div>` +
      `</div>`;
  }

  if (el.type === "link") {
    const text = resolveText(el.text, data, ctx);
    const url = resolveText(el.url, data, ctx);
    return `<a class="el link" data-id="${el.id}" href="${url}" style="${baseStyle};${textStyle};color:${(el.style && el.style.color) || '#1a6daf'};text-decoration:underline;display:flex;align-items:center;">${escapeHtml(text)}</a>`;
  }

  if (el.type === "pageBreak") {
    return `<div class="el page-break" data-id="${el.id}" style="${baseStyle};border-top:2pt dashed #b33a2b;display:flex;align-items:center;justify-content:center;font-size:8pt;color:#b33a2b;">PAGE BREAK</div>`;
  }

  if (el.type === "chart") {
    const chartType = el.chartType || "bar";
    const dataPath = normalizeBinding(el.dataSource || "");
    const items = dataPath ? (resolvePath(data, dataPath) || []) : [];
    const labelField = el.labelField || "label";
    const valueField = el.valueField || "value";
    const labels = items.map((item) => String(resolvePath(item, labelField) || ""));
    const values = items.map((item) => Number(resolvePath(item, valueField) || 0));
    const colors = el.colors || ["#b33a2b", "#2b6cb3", "#3c8f3a", "#d4a017", "#7b3cb3"];
    const title = resolveText(el.title || "", data, ctx);
    return `<div class="el chart" data-id="${el.id}" style="${baseStyle};overflow:hidden;">` +
      renderChartSvg(chartType, labels, values, colors, el.w, el.h, title) +
      `</div>`;
  }

  return "";
}

const qrEncoder = require("./qr-encode");

function renderQrSvg(value, w, h) {
  if (!value) return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:100%;" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#fff"/><text x="${w/2}" y="${h/2}" text-anchor="middle" font-size="8" fill="#999">No QR data</text></svg>`;
  const modules = qrEncoder.encode(value, "M");
  const size = modules.length;
  const margin = 2;
  const total = size + margin * 2;
  const cellW = w / total;
  const cellH = h / total;
  const cell = Math.min(cellW, cellH);
  const offsetX = (w - total * cell) / 2;
  const offsetY = (h - total * cell) / 2;
  let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:100%;display:block;" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="${w}" height="${h}" fill="#fff"/>`;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (modules[row][col]) {
        const x = offsetX + (col + margin) * cell;
        const y = offsetY + (row + margin) * cell;
        svg += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#000"/>`;
      }
    }
  }
  svg += `</svg>`;
  return svg;
}



function renderBarcodeSvg(value, width, height) {
  if (!value) return "";
  const CODE128B = [
    "11011001100","11001101100","11001100110","10010011000","10010001100",
    "10001001100","10011001000","10011000100","10001100100","11001001000",
    "11001000100","11000100100","10110011100","10011011100","10011001110",
    "10111001100","10011101100","10011100110","11001110010","11001011100",
    "11001001110","11011100100","11001110100","11100101100","11100100110",
    "11101100100","11100110100","11100110010","11011011000","11011000110",
    "11000110110","10100011000","10001011000","10001000110","10110001000",
    "10001101000","10001100010","11010001000","11000101000","11000100010",
    "10110111000","10110001110","10001101110","10111011000","10111000110",
    "10001110110","11101110110","11010001110","11000101110","11011101000",
    "11011100010","11011101110","11101011000","11101000110","11100010110",
    "11101101000","11101100010","11100011010","11101111010","11001000010",
    "11110001010","10100110000","10100001100","10010110000","10010000110",
    "10000101100","10000100110","10110010000","10110000100","10011010000",
    "10011000010","10000110100","10000110010","11000010010","11001010000",
    "11110111010","11000010100","10001111010","10100111100","10010111100",
    "10010011110","10111100100","10011110100","10011110010","11110100100",
    "11110010100","11110010010","11011011110","11011110110","11110110110",
    "10101111000","10100011110","10001011110","10111101000","10111100010",
    "11110101000","11110100010","10111011110","10111101110","11101011110",
    "11110101110","11010000100","11010010000","11010011100","1100011101011"
  ];
  const START_B = 104;
  const STOP = 106;
  let checksum = START_B;
  let bits = CODE128B[START_B];
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i) - 32;
    const idx = Math.max(0, Math.min(code, 94));
    bits += CODE128B[idx];
    checksum += idx * (i + 1);
  }
  bits += CODE128B[checksum % 103];
  bits += CODE128B[STOP];
  const quietZone = 10;
  const totalBits = bits.length + quietZone * 2;
  const unitW = width / totalBits;
  const bars = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") {
      const x = (quietZone + i) * unitW;
      bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${Math.max(unitW, 0.5).toFixed(2)}" height="${height}" fill="#000"/>`);
    }
  }
  return bars.join("");
}

function renderChartSvg(chartType, labels, values, colors, w, h, title) {
  const maxVal = Math.max(...values, 1);
  const titleH = title ? 16 : 0;
  const padTop = 8 + titleH;
  const padBottom = 20;
  const padLeft = 6;
  const padRight = 6;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">`;
  if (title) {
    svg += `<text x="${w / 2}" y="${14}" text-anchor="middle" font-size="10" font-weight="600" fill="#333">${title}</text>`;
  }
  if (chartType === "bar") {
    const barGap = 4;
    const barW = Math.max(4, (chartW - barGap * (values.length - 1)) / Math.max(1, values.length));
    values.forEach((v, i) => {
      const barH = (v / maxVal) * chartH;
      const x = padLeft + i * (barW + barGap);
      const y = padTop + chartH - barH;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${colors[i % colors.length]}" rx="2"/>`;
      if (labels[i]) {
        svg += `<text x="${x + barW / 2}" y="${h - 4}" text-anchor="middle" font-size="7" fill="#555">${labels[i].slice(0, 8)}</text>`;
      }
    });
  } else if (chartType === "line") {
    const stepX = values.length > 1 ? chartW / (values.length - 1) : chartW;
    const points = values.map((v, i) => {
      const x = padLeft + i * stepX;
      const y = padTop + chartH - (v / maxVal) * chartH;
      return `${x},${y}`;
    });
    svg += `<polyline points="${points.join(" ")}" fill="none" stroke="${colors[0]}" stroke-width="2"/>`;
    values.forEach((v, i) => {
      const x = padLeft + i * stepX;
      const y = padTop + chartH - (v / maxVal) * chartH;
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="${colors[0]}"/>`;
      if (labels[i]) {
        svg += `<text x="${x}" y="${h - 4}" text-anchor="middle" font-size="7" fill="#555">${labels[i].slice(0, 8)}</text>`;
      }
    });
  } else if (chartType === "pie" || chartType === "doughnut") {
    const cx = w / 2;
    const cy = padTop + chartH / 2;
    const r = Math.min(chartW, chartH) / 2 - 4;
    const innerR = chartType === "doughnut" ? r * 0.55 : 0;
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      const sweep = (v / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sweep);
      const y2 = cy + r * Math.sin(angle + sweep);
      const large = sweep > Math.PI ? 1 : 0;
      let d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      if (innerR > 0) {
        const ix1 = cx + innerR * Math.cos(angle);
        const iy1 = cy + innerR * Math.sin(angle);
        const ix2 = cx + innerR * Math.cos(angle + sweep);
        const iy2 = cy + innerR * Math.sin(angle + sweep);
        d = `M ${ix1} ${iy1} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1} Z`;
      }
      svg += `<path d="${d}" fill="${colors[i % colors.length]}"/>`;
      angle += sweep;
    });
  }
  svg += `</svg>`;
  return svg;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildFontCss(template) {
  const fonts = template.fonts || [];
  const rules = [];
  for (const font of fonts) {
    if (!font || !font.name || !font.source) continue;
    if (font.source === "local") continue;
    const src = font.source === "url" ? font.url : font.data;
    if (!src) continue;
    rules.push(`@font-face{font-family:"${font.name}";src:url("${src}");font-display:swap;}`);
  }
  return rules.join("");
}

function renderHtml(template, data, options = {}) {
  const renderData = options && options.dataAlreadyMapped ? (data || {}) : applyDataContract(template, data);
  const page = template.page;
  const margin = page.margin || { top: 0, right: 0, bottom: 0, left: 0 };
  const headerH = page.headerHeight || 0;
  const footerH = page.footerHeight || 0;
  const bodyW = page.width - margin.left - margin.right;
  const bodyH = page.height - margin.top - margin.bottom - headerH - footerH;

  const elements = expandIncludes(template.elements || [], template);
  const flowElements = elements.filter((el) => el.type === "flowText" && (el.region === "body" || !el.region));
  const flow = flowElements.length ? flowElements[0] : null;
  const flowData = options.flowData || (flow ? computeFlowPages(flow, renderData, template, bodyW, bodyH) : null);
  const flowRepeat = flow ? flow.repeat || "all" : "all";

  const tableElements = elements.filter((el) => el.type === "table" && (el.region === "body" || !el.region));
  const pagedTable = tableElements.find((el) => el.pagination && el.pagination.mode === "auto");
  let tablePageSpace = null;
  if (pagedTable) {
    const firstTableY = pagedTable.y || 0;
    const otherTableY = pagedTable.continuationY != null ? pagedTable.continuationY : firstTableY;
    const bodyElements = elements.filter((el) => !el.region || el.region === "body");
    const firstPageBlockers = bodyElements
      .filter((el) => el.id !== pagedTable.id && (el.y || 0) > firstTableY)
      .filter((el) => {
        const explicitPage = Number(el.page);
        if (Number.isFinite(explicitPage) && explicitPage >= 1) {
          return Math.floor(explicitPage) === 1;
        }
        const repeat = el.repeat || "first";
        return repeat === "first" || repeat === "all";
      });
    const allPagesBlockers = bodyElements
      .filter((el) => el.id !== pagedTable.id && (el.y || 0) > otherTableY)
      .filter((el) => {
        const explicitPage = Number(el.page);
        if (Number.isFinite(explicitPage) && explicitPage >= 1) {
          return Math.floor(explicitPage) > 1;
        }
        const repeat = el.repeat || "first";
        return repeat === "all" || repeat === "afterFirst";
      });
    const firstY = firstPageBlockers.length ? Math.min(...firstPageBlockers.map((el) => el.y || 0)) : null;
    const allY = allPagesBlockers.length ? Math.min(...allPagesBlockers.map((el) => el.y || 0)) : null;
    tablePageSpace = {
      firstAvailable: firstY != null ? Math.max(0, firstY - firstTableY) : null,
      otherAvailable: allY != null ? Math.max(0, allY - otherTableY) : null
    };
  }
  const tableData = pagedTable ? computeTablePages(pagedTable, renderData, template, bodyH, tablePageSpace || {}) : null;
  const pagedTableStartPage = pagedTable ? Math.max(0, Math.floor(Number(pagedTable.page) || 1) - 1) : 0;

  const pageCount = flowData
    ? (flowRepeat === "afterFirst"
      ? flowData.pages.length + 1
      : flowRepeat === "middle"
      ? flowData.pages.length + 2
      : flowRepeat === "first"
      ? 1
      : flowRepeat === "last"
      ? flowData.pages.length + 1
      : flowData.pages.length)
    : tableData
    ? tableData.pages.length + pagedTableStartPage
    : 1;
  const manualPageCount = Math.max(1, Math.floor(Number(template.pageCount) || 1));
  const explicitElementPageMax = elements.reduce((max, el) => {
    const p = Number(el.page);
    if (!Number.isFinite(p) || p < 1) return max;
    return Math.max(max, Math.floor(p));
  }, 1);
  const finalPageCount = Math.max(pageCount, manualPageCount, explicitElementPageMax);

  const pagesHtml = [];
  for (let p = 0; p < finalPageCount; p += 1) {
    const ctx = { pageNumber: p + 1, pageCount: finalPageCount };
    const headerElements = elements
      .filter((el) => el.region === "header" && shouldRenderInPage(el, p, finalPageCount, "header"))
      .map((el) => renderElement(el, renderData, template, ctx))
      .join("");
    const footerElements = elements
      .filter((el) => el.region === "footer" && shouldRenderInPage(el, p, finalPageCount, "footer"))
      .map((el) => renderElement(el, renderData, template, ctx))
      .join("");

    const bodyElements = elements
      .filter((el) => !el.region || el.region === "body")
      .map((el) => {
        if (pagedTable && el.id === pagedTable.id) {
          if (p < pagedTableStartPage) return "";
          const tablePageIndex = p - pagedTableStartPage;
          const rows = tableData.pages[tablePageIndex] || [];
          if (!rows.length && tablePageIndex >= tableData.pages.length) return "";
          const isFirstTablePage = tablePageIndex === 0;
          const tableY = isFirstTablePage ? (el.y || 0) : (el.continuationY != null ? el.continuationY : (el.y || 0));
          const explicitFirstH = el.h && el.h > 0 ? el.h : null;
          const explicitOtherH = el.continuationH && el.continuationH > 0 ? el.continuationH : null;
          const tableH = isFirstTablePage
            ? (explicitFirstH != null
              ? explicitFirstH
              : (tableData.firstAvailable != null ? tableData.firstAvailable : bodyH - (el.y || 0)))
            : (explicitOtherH != null
              ? explicitOtherH
              : (tableData.otherAvailable != null ? tableData.otherAvailable : bodyH - tableY));
          return `<div class="el table" data-id="${el.id}" style="left:${pt(el.x)};top:${pt(
            tableY
          )};width:${pt(el.w)};height:${pt(tableH)};overflow:hidden;">${renderTable(
            el,
            renderData,
            template,
            ctx,
            rows,
            { height: tableH }
          )}</div>`;
        }
        if (el.type === "flowText" && flowData) {
          const defaultText = template.styles && template.styles.defaultText;
          const mergedStyle = mergeStyles(defaultText, el.style);
          const textStyle = styleToCss(mergedStyle, template);
          let flowIndex = p;
          if (flowRepeat === "afterFirst") flowIndex = p - 1;
          if (flowRepeat === "middle") flowIndex = p > 0 && p < finalPageCount - 1 ? p - 1 : -1;
          if (flowRepeat === "first") flowIndex = p === 0 ? 0 : -1;
          if (flowRepeat === "last") flowIndex = p === finalPageCount - 1 ? flowData.pages.length - 1 : -1;

          if (flowData.mode === "browser") {
            const text = flowIndex >= 0 ? flowData.pages[flowIndex] || "" : "";
            if (!text) return "";
            const colStyle = [
              `left:${pt(el.x || 0)}`,
              `top:${pt(el.y || 0)}`,
              `width:${pt(flowData.columnWidth * (flowData.columns || 1) + flowData.gap * Math.max(0, (flowData.columns || 1) - 1))}`,
              `height:${pt(flowData.flowH)}`,
              `column-count:${flowData.columns || 1}`,
              `column-gap:${pt(flowData.gap || 12)}`,
              `column-fill:auto`,
              `overflow:hidden`
            ].join(";");
            return `<div class="el flow-text" data-id="${el.id}" style="${colStyle};${textStyle};white-space:pre-wrap;">${escapeHtml(
              text
            )}</div>`;
          }

          const cols = flowIndex >= 0 ? flowData.pages[flowIndex] || [] : [];
          if (!cols.length) return "";
          const columnEls = cols
            .map((text, idx) => {
              const x = (el.x || 0) + idx * (flowData.columnWidth + flowData.gap);
              const y = el.y || 0;
              const colStyle = [
                `left:${pt(x)}`,
                `top:${pt(y)}`,
                `width:${pt(flowData.columnWidth)}`,
                `height:${pt(flowData.flowH)}`
              ].join(";");
              return `<div class="el flow-text" data-id="${el.id}__c${idx}" style="${colStyle};${textStyle};white-space:pre-wrap;">${escapeHtml(
                text || ""
              )}</div>`;
            })
            .join("");
          return columnEls;
        }
        if (!shouldRenderInPage(el, p, finalPageCount, "body")) return "";
        return renderElement(el, renderData, template, ctx);
      })
      .join("");

    pagesHtml.push(`
    <div class="page">
      <div class="page-region page-header">
        ${headerElements}
      </div>
      <div class="page-region page-body">
        ${bodyElements}
      </div>
      <div class="page-region page-footer">
        ${footerElements}
      </div>
    </div>`);
  }

  const css = `
    ${buildFontCss(template)}
    @page { size: ${pt(page.width)} ${pt(page.height)}; margin: 0; }
    body { margin: 0; }
    .page { position: relative; width: ${pt(page.width)}; height: ${pt(page.height)}; overflow: hidden; break-after: page; page-break-after: always; }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .page-region { position: absolute; left: ${pt(margin.left)}; width: ${pt(bodyW)}; }
    .page-header { top: ${pt(margin.top)}; height: ${pt(headerH)}; }
    .page-body { top: ${pt(margin.top + headerH)}; height: ${pt(bodyH)}; }
    .page-footer { top: ${pt(margin.top + headerH + bodyH)}; height: ${pt(footerH)}; }
    .el { position: absolute; box-sizing: border-box; }
    .tbl { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .tbl th, .tbl td { border: 1pt solid #E0E0E0; padding: 0pt 3pt; vertical-align: middle; box-sizing: border-box; overflow: hidden; }
  `;

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${css}</style>
  </head>
  <body>
    ${pagesHtml.join("\n")}
  </body>
</html>
  `.trim();
}

function printHelp() {
  const msg = `
Usage:
  node scripts/render.js --template examples/template.json --data examples/data.json --out out/render.html

Defaults:
  --template ${path.relative(process.cwd(), DEFAULT_TEMPLATE)}
  --data     ${path.relative(process.cwd(), DEFAULT_DATA)}
  --out      ${path.relative(process.cwd(), DEFAULT_OUT)}
  `.trim();
  console.log(msg);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const templatePath = args.template || DEFAULT_TEMPLATE;
  const dataPath = args.data || DEFAULT_DATA;
  const outPath = args.out || DEFAULT_OUT;

  const template = readJson(templatePath);
  const data = readJson(dataPath);

  const html = renderHtml(template, data);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  renderHtml,
  applyDataContract,
  evaluateDataContract,
  readJson,
  buildFontCss
};
