const canvas = document.getElementById("canvas");
const props = document.getElementById("props");
const addButtons = document.querySelectorAll("[data-add]");
const modeButtons = document.querySelectorAll(".mode-btn[data-mode]");
const modeSections = document.querySelectorAll("[data-mode-section]");
const quickProxyButtons = document.querySelectorAll("[data-proxy-click]");
const previewBtn = document.getElementById("btn-preview");
const loadDataBtn = document.getElementById("btn-load-data");
const dataFileInput = document.getElementById("file-data");
const loadTemplateBtn = document.getElementById("btn-load-template");
const templateFileInput = document.getElementById("file-template");
const previewPdfBtn = document.getElementById("btn-preview-pdf");
const newPartialBtn = document.getElementById("btn-new-partial");
const partialsList = document.getElementById("partials-list");
const newTemplateBtn = document.getElementById("btn-new-template");
const loadStarterBtn = document.getElementById("btn-load-starter");
const starterTemplateSelect = document.getElementById("starter-template-select");
const dbTemplateSelect = document.getElementById("db-template-select");
const dbRefreshBtn = document.getElementById("btn-db-refresh");
const dbLoadBtn = document.getElementById("btn-db-load");
const dbSaveBtn = document.getElementById("btn-db-save");
const dbSaveAsBtn = document.getElementById("btn-db-save-as");
const dbRenameBtn = document.getElementById("btn-db-rename");
const dbArchiveBtn = document.getElementById("btn-db-archive");
const dbStatusSelect = document.getElementById("db-status-select");
const templateState = document.getElementById("template-state");
const dbStatus = document.getElementById("db-status");
const pagePrevBtn = document.getElementById("btn-page-prev");
const pageNextBtn = document.getElementById("btn-page-next");
const pageIndicator = document.getElementById("page-indicator");
const textToolbar = document.getElementById("text-toolbar");
const toolbarStatus = document.getElementById("toolbar-status");
const toolbarFont = document.getElementById("toolbar-font");
const toolbarSize = document.getElementById("toolbar-size");
const toolbarColor = document.getElementById("toolbar-color");
const dataStatus = document.getElementById("data-status");

let template = null;
let data = null;
let resolvedData = {};
let previewMode = true;
let selectedId = null;
let dragState = null;
let placingType = null;
let editingPartial = null;
let editingText = null;
let dataName = "(none)";
let activeStarterPath = null;
let contractDiagnostics = { fields: [], missingRequired: [], data: {} };
let contractTestPayload = "";
let contractTestResult = null;
let previewPageIndex = 0;
let previewPageCount = 1;
let dbTemplates = [];
let activeDbTemplateId = null;
let activeDbTemplateStatus = "DRAFT";
let savedTemplateSnapshot = "";
let templateDirty = false;
let activeLeftMode = "design";

const STARTER_TEMPLATES = [
  { label: "Invoice Starter", path: "/examples/template.json" },
  { label: "Credit Card Statement", path: "/examples/cc-template.json" },
  { label: "Bank Statement", path: "/examples/bank-statement-template.json" },
  { label: "Terms & Conditions", path: "/examples/terms-template.json" },
  { label: "Enterprise Cover Package", path: "/examples/enterprise-cover-template.json" }
];

function setLeftMode(mode) {
  const next = ["design", "data", "manage"].includes(mode) ? mode : "design";
  activeLeftMode = next;
  modeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === next);
  });
  modeSections.forEach((section) => {
    const isVisible = section.dataset.modeSection === next;
    section.classList.toggle("is-hidden", !isVisible);
    if (isVisible && section.tagName === "DETAILS" && !section.hasAttribute("open")) {
      section.setAttribute("open", "open");
    }
  });
  try {
    window.localStorage.setItem("smartdocs.leftMode", next);
  } catch (_err) {
    // ignore storage failures
  }
  syncQuickActions();
}

function syncQuickActions() {
  quickProxyButtons.forEach((proxyBtn) => {
    const targetId = proxyBtn.dataset.proxyClick;
    const target = targetId ? document.getElementById(targetId) : null;
    proxyBtn.disabled = !target || target.disabled;
  });
}

const PT_TO_PX = 96 / 72;

function computeTemplateSnapshot() {
  if (!template) return "";
  try {
    return JSON.stringify(template);
  } catch (_err) {
    return "";
  }
}

function syncDbStatusSelect() {
  if (!dbStatusSelect) return;
  const value = (activeDbTemplateStatus || "DRAFT").toUpperCase();
  const hasOption = Array.from(dbStatusSelect.options).some((opt) => opt.value === value);
  dbStatusSelect.disabled = !activeDbTemplateId;
  dbStatusSelect.value = hasOption ? value : "DRAFT";
}

function updateTemplateStateLabel() {
  if (!templateState) return;
  const name = (template && template.name) || "Untitled Template";
  const dirtyLabel = templateDirty ? "unsaved" : "saved";
  const dbLabel = activeDbTemplateId
    ? `db:${activeDbTemplateId.slice(0, 8)} (${String(activeDbTemplateStatus || "DRAFT").toLowerCase()})`
    : "db:not saved";
  templateState.textContent = `${name} | ${dirtyLabel} | ${dbLabel}`;
  templateState.style.color = templateDirty ? "#a1372f" : "#7a6f5f";
}

function setSavedTemplateSnapshot() {
  savedTemplateSnapshot = computeTemplateSnapshot();
  templateDirty = false;
  updateTemplateStateLabel();
}

function updateTemplateDirtyState() {
  if (!template) {
    templateDirty = false;
    updateTemplateStateLabel();
    return;
  }
  const current = computeTemplateSnapshot();
  templateDirty = current !== savedTemplateSnapshot;
  updateTemplateStateLabel();
}

function ptToPx(val) {
  return Number(val || 0) * PT_TO_PX;
}

function pxToPt(val) {
  return Number(val || 0) / PT_TO_PX;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}`;
}

function loadTemplateFromUrl(url) {
  return fetch(url)
    .then((res) => res.json())
    .then((payload) => {
      activeStarterPath = url;
      if (starterTemplateSelect) starterTemplateSelect.value = url;
      setTemplate(payload);
    });
}

function createBlankTemplate(name) {
  const now = Date.now();
  return {
    id: `tmpl_${now}`,
    name: name || "Untitled Template",
    version: "1.0.0",
    unit: "pt",
    page: {
      size: "A4",
      width: 595,
      height: 842,
      margin: { top: 36, right: 36, bottom: 36, left: 36 },
      headerHeight: 0,
      footerHeight: 0
    },
    fonts: [
      { name: "Arial", source: "local", fallback: ["Helvetica", "sans-serif"] },
      { name: "Times New Roman", source: "local", fallback: ["Times", "serif"] }
    ],
    styles: {
      defaultText: { font: "Arial", size: 11, color: "#111111", lineHeight: 14 }
    },
    dataContract: { fields: [] },
    elements: [],
    partials: {},
    variables: {}
  };
}

function populateStarterTemplates() {
  if (!starterTemplateSelect) return;
  starterTemplateSelect.innerHTML = "";
  STARTER_TEMPLATES.forEach((starter) => {
    const opt = document.createElement("option");
    opt.value = starter.path;
    opt.textContent = starter.label;
    starterTemplateSelect.appendChild(opt);
  });
}

function setDbStatus(message, isError = false) {
  if (!dbStatus) return;
  dbStatus.textContent = message || "";
  dbStatus.style.color = isError ? "#a1372f" : "#7a6f5f";
}

function parseApiError(res, payload) {
  if (payload && payload.error) return payload.error;
  return `Request failed (${res.status})`;
}

async function fetchApiJson(url, options = {}) {
  const res = await fetch(url, options);
  let payload = null;
  try {
    payload = await res.json();
  } catch (_err) {
    payload = null;
  }
  if (!res.ok) {
    throw new Error(parseApiError(res, payload));
  }
  return payload || {};
}

function renderDbTemplateSelect() {
  if (!dbTemplateSelect) return;
  dbTemplateSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = dbTemplates.length ? "Select DB template..." : "No DB templates";
  dbTemplateSelect.appendChild(placeholder);
  dbTemplates.forEach((tpl) => {
    const opt = document.createElement("option");
    opt.value = tpl.id;
    const version = tpl.currentVersion && tpl.currentVersion.version ? `v${tpl.currentVersion.version}` : "v-";
    const status = tpl.status ? String(tpl.status).toLowerCase() : "draft";
    opt.textContent = `${tpl.name} (${version}, ${status})`;
    dbTemplateSelect.appendChild(opt);
  });
  if (activeDbTemplateId && dbTemplates.some((tpl) => tpl.id === activeDbTemplateId)) {
    dbTemplateSelect.value = activeDbTemplateId;
  } else if (dbTemplates.length) {
    dbTemplateSelect.value = dbTemplates[0].id;
  } else {
    dbTemplateSelect.value = "";
  }
  syncDbStatusSelect();
  updateTemplateStateLabel();
}

async function refreshDbTemplates(options = {}) {
  const silent = Boolean(options.silent);
  if (!dbTemplateSelect) return;
  try {
    const payload = await fetchApiJson("/api/templates");
    dbTemplates = Array.isArray(payload.templates) ? payload.templates : [];
    if (activeDbTemplateId) {
      const matched = dbTemplates.find((tpl) => tpl.id === activeDbTemplateId);
      if (matched) activeDbTemplateStatus = matched.status || activeDbTemplateStatus;
    }
    renderDbTemplateSelect();
    if (!silent) setDbStatus(`DB templates: ${dbTemplates.length}`);
  } catch (err) {
    dbTemplates = [];
    activeDbTemplateId = null;
    activeDbTemplateStatus = "DRAFT";
    renderDbTemplateSelect();
    setDbStatus(err.message, true);
  }
}

async function loadDbTemplateById(templateId) {
  if (!templateId) {
    setDbStatus("Select a DB template first.", true);
    return;
  }
  try {
    const payload = await fetchApiJson(`/api/templates/${encodeURIComponent(templateId)}`);
    const dbTemplate = payload.template;
    const version = dbTemplate && dbTemplate.currentVersion;
    if (!version || typeof version.contentJson !== "object" || version.contentJson == null) {
      throw new Error("Selected DB template has no current version content.");
    }
    activeStarterPath = null;
    contractTestPayload = "";
    contractTestResult = null;
    activeDbTemplateId = dbTemplate.id;
    activeDbTemplateStatus = dbTemplate.status || "DRAFT";
    setTemplate(version.contentJson, { keepDbContext: true });
    if (dbTemplateSelect) dbTemplateSelect.value = dbTemplate.id;
    syncDbStatusSelect();
    setDbStatus(`Loaded DB template: ${dbTemplate.name} (v${version.version})`);
  } catch (err) {
    setDbStatus(`Load failed: ${err.message}`, true);
  }
}

async function saveTemplateToDbAsNew() {
  if (!template) return;
  const actorId = "editor";
  const currentName = template.name || "Untitled Template";
  const requestedName = prompt("Save as new template name?", `${currentName} Copy`);
  if (requestedName == null) return;
  const nextName = requestedName.trim();
  if (!nextName) {
    setDbStatus("Template name cannot be empty.", true);
    return;
  }
  const snapshot = JSON.parse(JSON.stringify(template));
  snapshot.name = nextName;
  template.name = nextName;
  try {
    const payload = await fetchApiJson("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nextName,
        description: snapshot.description || null,
        contentJson: snapshot,
        actorId
      })
    });
    const created = payload.template;
    activeDbTemplateId = created.id;
    activeDbTemplateStatus = created.status || "DRAFT";
    await refreshDbTemplates({ silent: true });
    if (dbTemplateSelect) dbTemplateSelect.value = activeDbTemplateId;
    setSavedTemplateSnapshot();
    syncDbStatusSelect();
    setDbStatus(`Saved as new DB template: ${created.name}`);
    render();
  } catch (err) {
    setDbStatus(`Save As New failed: ${err.message}`, true);
  }
}

async function patchDbTemplateMetadata(patch, successMessage) {
  if (!activeDbTemplateId) {
    throw new Error("No active DB template loaded.");
  }
  const payload = await fetchApiJson(`/api/templates/${encodeURIComponent(activeDbTemplateId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...patch,
      actorId: "editor"
    })
  });
  const updated = payload.template;
  activeDbTemplateStatus = updated.status || activeDbTemplateStatus;
  await refreshDbTemplates({ silent: true });
  if (dbTemplateSelect) dbTemplateSelect.value = activeDbTemplateId;
  syncDbStatusSelect();
  setDbStatus(successMessage || "Template metadata updated.");
  return updated;
}

async function saveTemplateToDb() {
  if (!template) return;
  const actorId = "editor";
  try {
    if (!activeDbTemplateId) {
      const payload = await fetchApiJson("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name || "Untitled Template",
          description: template.description || null,
          contentJson: template,
          actorId
        })
      });
      const created = payload.template;
      activeDbTemplateId = created.id;
      activeDbTemplateStatus = created.status || "DRAFT";
      await refreshDbTemplates({ silent: true });
      if (dbTemplateSelect) dbTemplateSelect.value = activeDbTemplateId;
      const createdVersion = created.currentVersion && created.currentVersion.version ? created.currentVersion.version : 1;
      setSavedTemplateSnapshot();
      syncDbStatusSelect();
      setDbStatus(`Saved new DB template: ${created.name} (v${createdVersion})`);
      return;
    }

    try {
      await fetchApiJson(`/api/templates/${encodeURIComponent(activeDbTemplateId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name || "Untitled Template",
          actorId
        })
      });
    } catch (_err) {
      // Metadata sync is best effort; version write still proceeds.
    }

    const payload = await fetchApiJson(`/api/templates/${encodeURIComponent(activeDbTemplateId)}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentJson: template,
        actorId
      })
    });
    const updated = payload.template;
    await refreshDbTemplates({ silent: true });
    if (dbTemplateSelect) dbTemplateSelect.value = activeDbTemplateId;
    const version = updated.currentVersion && updated.currentVersion.version ? updated.currentVersion.version : "?";
    setSavedTemplateSnapshot();
    syncDbStatusSelect();
    setDbStatus(`Saved DB version: ${updated.name} (v${version})`);
  } catch (err) {
    setDbStatus(`Save failed: ${err.message}`, true);
  }
}

function loadData() {
  return fetch("/examples/data.json")
    .then((res) => res.json())
    .then((payload) => {
      data = payload;
      dataName = "examples/data.json";
      contractTestPayload = "";
      contractTestResult = null;
      render();
    })
    .catch(() => {
      data = {};
      contractTestPayload = "";
      contractTestResult = null;
      render();
    });
}

function loadDataFromUrl(url) {
  return fetch(url)
    .then((res) => res.json())
    .then((payload) => {
      data = payload;
      dataName = url;
      contractTestPayload = "";
      contractTestResult = null;
      render();
    })
    .catch(() => {
      data = {};
      dataName = url;
      contractTestPayload = "";
      contractTestResult = null;
      render();
    });
}

function saveTemplateDownload() {
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${template.name || "template"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function extractBindings(str) {
  if (typeof str !== "string") return [];
  const matches = str.match(/\{\{\s*([^}]+?)\s*\}\}/g) || [];
  return matches.map((m) => m.replace(/[{}]/g, "").trim()).filter(Boolean);
}

function extractVisibleIfPaths(expr) {
  if (typeof expr !== "string" || !expr.trim()) return [];
  const reserved = new Set(["true", "false", "exists", "len", "page.number", "page.count"]);
  const tokens = expr.match(/[A-Za-z_][A-Za-z0-9_.]*/g) || [];
  return tokens
    .filter((t) => !reserved.has(t))
    .filter((t) => /[A-Za-z]/.test(t))
    .filter((t) => t.includes("."));
}

function flattenElementsForBindings(elements, partials, result = [], seenPartials = new Set()) {
  (elements || []).forEach((el) => {
    if (el.type === "include" && el.ref && partials && partials[el.ref] && !seenPartials.has(el.ref)) {
      seenPartials.add(el.ref);
      flattenElementsForBindings(partials[el.ref].elements || [], partials, result, seenPartials);
      seenPartials.delete(el.ref);
      return;
    }
    result.push(el);
  });
  return result;
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

function applyTransformLocal(value, field) {
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

function evaluateDataContractLocal(inputData) {
  const contract = template && template.dataContract;
  const source = inputData || {};
  if (!contract || !Array.isArray(contract.fields) || !contract.fields.length) {
    return { data: source, fields: [], missingRequired: [] };
  }
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
    const transformed = applyTransformLocal(value, field);
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

function applyDataContractLocal(inputData) {
  return evaluateDataContractLocal(inputData).data;
}

function collectTemplateBindings() {
  if (!template) return [];
  const flat = flattenElementsForBindings(template.elements || [], template.partials || {});
  const keys = new Set();
  flat.forEach((el) => {
    ["text", "src", "rows", "value"].forEach((key) => {
      extractBindings(el[key]).forEach((b) => {
        if (b === "page.number" || b === "page.count") return;
        keys.add(b);
      });
    });
    extractVisibleIfPaths(el.visibleIf).forEach((p) => keys.add(p));
  });
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function ensureDataContract() {
  if (!template) return null;
  if (!template.dataContract || typeof template.dataContract !== "object") {
    template.dataContract = { fields: [] };
  }
  if (!Array.isArray(template.dataContract.fields)) {
    template.dataContract.fields = [];
  }
  return template.dataContract;
}

function syncDataContractBindings() {
  const contract = ensureDataContract();
  if (!contract) return;
  const discovered = collectTemplateBindings();
  const byPath = new Map(contract.fields.map((f) => [f.path, f]));
  discovered.forEach((path) => {
    if (!byPath.has(path)) {
      contract.fields.push({
        path,
        required: false,
        type: "string",
        source: "external",
        transform: "none",
        defaultValue: "",
        externalPath: path
      });
    }
  });
  contract.fields = contract.fields.filter((f) => discovered.includes(f.path));
  contract.fields.sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function summarizeContractDiagnostics(result) {
  if (!result) return { missingRequired: [], errors: [] };
  const missingRequired = result.missingRequired || [];
  const errors = (result.fields || []).filter((f) => f.error).map((f) => `${f.path}: ${f.error}`);
  return { missingRequired, errors };
}

function findMissingBindings() {
  if (!template) return [];
  const missing = new Set();
  const source = resolvedData || {};
  const elements = flattenElementsForBindings(template.elements || [], template.partials || {});
  elements.forEach((el) => {
    ["text", "src", "rows", "value"].forEach((key) => {
      if (!el[key]) return;
        const bindings = extractBindings(el[key]);
        bindings.forEach((b) => {
          if (b === "page.number" || b === "page.count") return;
          const val = resolvePath(source, b);
          if (val == null) missing.add(b);
        });
      });
  });
  return Array.from(missing);
}

function setTemplate(next, options = {}) {
  template = next;
  if (!options.keepDbContext) {
    activeDbTemplateId = null;
    activeDbTemplateStatus = "DRAFT";
    if (dbTemplateSelect) dbTemplateSelect.value = "";
  }
  if (!template.partials) template.partials = {};
  syncDataContractBindings();
  editingPartial = null;
  selectedId = null;
  previewPageIndex = 0;
  previewPageCount = 1;
  if (options.markSaved !== false) {
    setSavedTemplateSnapshot();
  } else {
    updateTemplateDirtyState();
  }
  syncDbStatusSelect();
  if (template.dataSample) {
    loadDataFromUrl(template.dataSample).then(() => {
      renderPartialsList();
    });
    return;
  }
  render();
  renderPartialsList();
}

function getElementById(id) {
  return getElements().find((el) => el.id === id);
}

function getElements() {
  if (!template) return [];
  if (editingPartial) {
    const partial = template.partials[editingPartial];
    return partial ? partial.elements : [];
  }
  return template.elements;
}

function setElements(next) {
  if (editingPartial) {
    template.partials[editingPartial].elements = next;
  } else {
    template.elements = next;
  }
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

function decodeEscapedText(value) {
  return String(value)
    .replace(/\\\\r\\\\n/g, "\n")
    .replace(/\\\\n/g, "\n")
    .replace(/\\\\t/g, "\t")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function resolveText(text, dataObj, ctx = null) {
  if (typeof text !== "string") return "";
  const resolved = text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, p1) => {
    const key = p1.trim();
    if (key === "page.number") return String((ctx && ctx.pageNumber) || 1);
    if (key === "page.count") return String((ctx && ctx.pageCount) || 1);
    const val = resolvePath(dataObj, key);
    return val == null ? "" : String(val);
  });
  return decodeEscapedText(resolved);
}

function ensureFontFaces() {
  const fonts = (template && template.fonts) || [];
  const rules = [];
  fonts.forEach((font) => {
    if (!font || !font.name || !font.source) return;
    if (font.source === "local") return;
    const src = font.source === "url" ? font.url : font.data;
    if (!src) return;
    rules.push(`@font-face{font-family:"${font.name}";src:url("${src}");font-display:swap;}`);
  });
  let styleEl = document.getElementById("font-faces");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "font-faces";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = rules.join("");
}

function enableTextEdit(div, el) {
  if (previewMode && !editingPartial) {
    previewMode = false;
    previewBtn.textContent = "Preview Data: Off";
  }
  div.contentEditable = "true";
  div.classList.add("editing");
  div.focus();
  editingText = { el, div };
  showToolbar();
  const onBlur = () => {
    div.contentEditable = "false";
    div.classList.remove("editing");
    el.text = el.richText ? div.innerHTML : div.innerText;
    editingText = null;
    hideToolbar();
    render();
  };
  div.addEventListener("blur", onBlur, { once: true });
}

function buildTable(el, rows, opts = {}) {
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.tableLayout = "fixed";

  const rowH =
    (el.pagination && el.pagination.rowHeight) ||
    (el.rowStyle && el.rowStyle.lineHeight) ||
    14;
  const sourceRows = Array.isArray(rows) ? rows.slice() : [];
  let displayRows = sourceRows;
  if (el.fillMode === "pad") {
    const targetH = Number.isFinite(opts.height) ? opts.height : (el.h && el.h > 0 ? el.h : 0);
    if (targetH > rowH) {
      const maxRows = Math.max(0, Math.floor((targetH - rowH) / rowH));
      if (displayRows.length < maxRows) {
        displayRows = displayRows.concat(Array.from({ length: maxRows - displayRows.length }, () => ({})));
      }
    }
  }
  const defaultText = (template && template.styles && template.styles.defaultText) || {};
  const rowStyle = { ...defaultText, ...(el.rowStyle || {}) };
  const headerStyle = { ...defaultText, ...(el.headerStyle || {}) };

  const applyCellStyle = (cell, style, align) => {
    if (style.font) cell.style.fontFamily = style.font;
    if (style.size) cell.style.fontSize = `${style.size}pt`;
    if (style.weight) cell.style.fontWeight = style.weight;
    if (style.fontStyle) cell.style.fontStyle = style.fontStyle;
    if (style.color) cell.style.color = style.color;
    if (style.fill) cell.style.backgroundColor = style.fill;
    if (style.lineHeight) cell.style.lineHeight = `${style.lineHeight}pt`;
    cell.style.textAlign = align || style.align || "left";
    cell.style.height = `${rowH}pt`;
    cell.style.boxSizing = "border-box";
    cell.style.verticalAlign = "middle";
    cell.style.overflow = "hidden";
    if (!style.lineHeight) cell.style.lineHeight = `${Math.max(0, rowH - 4)}pt`;
  };

  const formatCellValue = (val, col) => {
    if (val == null) return "";
    if (!col || !col.format) return String(val);
    const currency = (template && template.variables && template.variables.currency) || "USD";
    if (col.format === "currency") {
      const num = Number(val);
      if (Number.isNaN(num)) return String(val);
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(num);
    }
    if (col.format === "number") {
      const num = Number(val);
      if (Number.isNaN(num)) return String(val);
      const precision = Number.isInteger(col.precision) ? col.precision : undefined;
      return new Intl.NumberFormat(
        "en-US",
        precision == null ? undefined : { minimumFractionDigits: precision, maximumFractionDigits: precision }
      ).format(num);
    }
    return String(val);
  };

  if (Array.isArray(el.columns) && el.columns.length) {
    const colgroup = document.createElement("colgroup");
    el.columns.forEach((c) => {
      const col = document.createElement("col");
      if (c.w) col.style.width = `${c.w}pt`;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
  }

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  (el.columns || []).forEach((c, idx) => {
    const th = document.createElement("th");
    th.textContent = c.header || "";
    th.style.border = "1pt solid #e0e0e0";
    th.style.padding = "0pt 3pt";
    applyCellStyle(th, headerStyle, c.align || "left");
    if (!previewMode || editingPartial) {
      th.contentEditable = "true";
      th.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      th.addEventListener("blur", () => {
        c.header = th.innerText.trim();
        render();
      });
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  displayRows.forEach((row) => {
    const tr = document.createElement("tr");
    (el.columns || []).forEach((c) => {
      const td = document.createElement("td");
      td.textContent = formatCellValue(row[c.field], c);
      td.style.border = "1pt solid #e0e0e0";
      td.style.padding = "0pt 3pt";
      applyCellStyle(td, rowStyle, c.align || "left");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function placeholderImage(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#f0f0f0"/><text x="60" y="35" font-size="12" text-anchor="middle" fill="#666">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
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

function evalValue(expr, dataObj) {
  const trimmed = expr.trim();
  const existsMatch = trimmed.match(/^exists\((.+)\)$/);
  if (existsMatch) {
    const val = resolvePath(dataObj, existsMatch[1].trim());
    return val !== undefined && val !== null && val !== "";
  }
  const lenMatch = trimmed.match(/^len\((.+)\)$/);
  if (lenMatch) {
    const val = resolvePath(dataObj, lenMatch[1].trim());
    if (Array.isArray(val) || typeof val === "string") return val.length;
    return 0;
  }
  return resolvePath(dataObj, trimmed);
}

function evalAtom(expr, dataObj) {
  const trimmed = expr.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  const compareMatch = trimmed.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (compareMatch) {
    const leftVal = evalValue(compareMatch[1], dataObj);
    const rightVal = parseLiteral(compareMatch[3]);
    return compareValues(leftVal, compareMatch[2], rightVal);
  }

  const val = evalValue(trimmed, dataObj);
  return Boolean(val);
}

function evalNot(expr, dataObj) {
  const trimmed = expr.trim();
  if (trimmed.startsWith("!")) {
    return !evalNot(trimmed.slice(1), dataObj);
  }
  return evalAtom(trimmed, dataObj);
}

function evalAnd(expr, dataObj) {
  const parts = splitByOperator(expr, "&&");
  if (parts.length > 1) return parts.every((part) => evalNot(part, dataObj));
  return evalNot(expr, dataObj);
}

function evalOr(expr, dataObj) {
  const parts = splitByOperator(expr, "||");
  if (parts.length > 1) return parts.some((part) => evalAnd(part, dataObj));
  return evalAnd(expr, dataObj);
}

function isVisible(visibleIf) {
  if (!visibleIf || !previewMode) return true;
  try {
    return evalOr(visibleIf, resolvedData || data || {});
  } catch (_err) {
    return true;
  }
}

function applyStyle(el, style, defaultStyle) {
  const merged = { ...(defaultStyle || {}), ...(style || {}) };
  if (merged.font) el.style.fontFamily = merged.font;
  if (merged.size) el.style.fontSize = `${merged.size}pt`;
  if (merged.weight) el.style.fontWeight = merged.weight;
  if (merged.fontStyle) el.style.fontStyle = merged.fontStyle;
  if (merged.color) el.style.color = merged.color;
  if (merged.align) el.style.textAlign = merged.align;
  if (merged.lineHeight) el.style.lineHeight = `${merged.lineHeight}pt`;
  if (merged.borderColor && merged.borderWidth != null) {
    el.style.border = `${merged.borderWidth}pt solid ${merged.borderColor}`;
  }
  if (merged.borderRadius != null) el.style.borderRadius = `${merged.borderRadius}pt`;
  if (merged.fill) el.style.backgroundColor = merged.fill;
}

function ensureStyle(el) {
  if (!el.style) el.style = {};
  return el.style;
}

function getStylePresets() {
  const presets = (template && template.styles) || {};
  if (Object.keys(presets).length === 0) {
    return {
      Heading: { size: 16, weight: 600 },
      Body: { size: 11, weight: 400 },
      Caption: { size: 9, weight: 400 }
    };
  }
  return presets;
}

function showToolbar() {
  if (!textToolbar) return;
  if (!editingText) {
    textToolbar.classList.add("hidden");
    return;
  }
  const canInline = Boolean(editingText.el && editingText.el.richText);
  textToolbar.classList.remove("hidden");
  if (toolbarStatus) {
    toolbarStatus.textContent = canInline
      ? `Inline edit: ${editingText.el.id}`
      : "Enable richText to format";
  }
  syncToolbarOptions(canInline);
}

function hideToolbar() {
  if (!textToolbar) return;
  textToolbar.classList.add("hidden");
}

function syncToolbarOptions(canInline) {
  if (!toolbarFont || !editingText) return;
  const disable = !canInline;
  textToolbar.querySelectorAll("button[data-cmd]").forEach((btn) => {
    btn.disabled = disable;
  });
  toolbarFont.disabled = disable;
  toolbarSize.disabled = disable;
  toolbarColor.disabled = disable;
  toolbarFont.innerHTML = "";
  const optAuto = document.createElement("option");
  optAuto.value = "";
  optAuto.textContent = "font";
  toolbarFont.appendChild(optAuto);
  const fonts = (template && template.fonts) || [];
  fonts.forEach((f) => {
    const o = document.createElement("option");
    o.value = f.name;
    o.textContent = f.name;
    toolbarFont.appendChild(o);
  });
  toolbarSize.value = "";
  toolbarColor.value = "#111111";
}

function applyInlineStyle(style) {
  if (!editingText) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const span = document.createElement("span");
  Object.assign(span.style, style);
  span.appendChild(range.extractContents());
  range.insertNode(span);
  sel.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(span);
  sel.addRange(newRange);
  editingText.el.text = editingText.el.richText ? editingText.div.innerHTML : editingText.div.innerText;
}

function createDefaultElement(type) {
  const base = {
    id: uid(type),
    type,
    region: "body",
    x: 20,
    y: 20,
    w: 120,
    h: 24
  };

  if (type === "text") return { ...base, text: "New text" };
  if (type === "flowText") return { ...base, w: 300, h: 300, text: "Flowing text...", columns: 1, gap: 12 };
  if (type === "image") return { ...base, src: "https://via.placeholder.com/120x60", h: 60, fit: "contain" };
  if (type === "table") {
    return {
      ...base,
      w: 300,
      h: 120,
      rows: "{{items}}",
      columns: [
        { header: "Item", field: "name", w: 160 },
        { header: "Qty", field: "qty", w: 40 },
        { header: "Price", field: "price", w: 80 }
      ]
    };
  }
  if (type === "qr") return { ...base, w: 80, h: 80, value: "{{qr.value}}", ecc: "M" };
  if (type === "line") return { ...base, w: 200, h: 1 };
  if (type === "box") return { ...base, w: 200, h: 60 };
  return base;
}

function createIncludeElement(ref) {
  const partial = template.partials[ref];
  let w = 200;
  let h = 60;
  if (partial && partial.elements && partial.elements.length) {
    const xs = partial.elements.map((e) => e.x || 0);
    const ys = partial.elements.map((e) => e.y || 0);
    const x2 = partial.elements.map((e) => (e.x || 0) + (e.w || 0));
    const y2 = partial.elements.map((e) => (e.y || 0) + (e.h || 0));
    w = Math.max(...x2) - Math.min(...xs);
    h = Math.max(...y2) - Math.min(...ys);
    if (!Number.isFinite(w) || w <= 0) w = 200;
    if (!Number.isFinite(h) || h <= 0) h = 60;
  }
  return {
    id: uid("include"),
    type: "include",
    ref,
    region: "body",
    x: 20,
    y: 20,
    w,
    h
  };
}

function setPlacing(type) {
  placingType = type;
  addButtons.forEach((btn) => {
    const isActive = btn.dataset.add === type;
    btn.classList.toggle("active", isActive);
  });
  canvas.classList.toggle("placing", Boolean(type));
  if (type) {
    selectedId = null;
  }
  render();
}

function clearPlacing() {
  placingType = null;
  addButtons.forEach((btn) => btn.classList.remove("active"));
  canvas.classList.remove("placing");
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function getRegionBounds(region) {
  const { margin, headerH, footerH, bodyW, bodyH } = getPageMetrics();
  if (region === "header") return { x: 0, y: 0, w: bodyW, h: headerH };
  if (region === "footer") return { x: 0, y: 0, w: bodyW, h: footerH };
  return { x: 0, y: 0, w: bodyW, h: bodyH };
}

function getDefaultRepeat(el) {
  return (el.region || "body") === "body" ? "first" : "all";
}

function shouldRenderInPage(el, pageIndex, pageCount) {
  if (editingPartial) return true;
  const repeat = el.repeat || getDefaultRepeat(el);
  if (repeat === "all") return true;
  if (repeat === "first") return pageIndex === 0;
  if (repeat === "afterFirst") return pageIndex > 0;
  if (repeat === "middle") return pageIndex > 0 && pageIndex < pageCount - 1;
  if (repeat === "last") return pageIndex === pageCount - 1;
  return pageIndex === 0;
}

function getAutoTableHeight(el, pageIndex = 0, pageCount = 1) {
  const bounds = getRegionBounds(el.region || "body");
  const tableY =
    pageIndex === 0 ? (el.y || 0) : (el.continuationY != null ? el.continuationY : (el.y || 0));
  const baseHeight = Math.max(0, bounds.h - tableY);
  const blockers = getElements()
    .filter((other) => other.id !== el.id)
    .filter((other) => (other.region || "body") === (el.region || "body"))
    .filter((other) => shouldRenderInPage(other, pageIndex, pageCount))
    .filter((other) => (other.y || 0) > tableY);
  if (!blockers.length) return baseHeight;
  const nextY = Math.min(...blockers.map((other) => other.y || 0));
  return Math.max(0, Math.min(baseHeight, nextY - tableY));
}

function computeTablePreviewData(el, pageCountHint = 1) {
  const rowsPath = (el.rows || "").replace(/\{\{|\}\}/g, "").trim();
  const rows = previewMode ? resolvePath(resolvedData || {}, rowsPath) || [] : [];
  const rowH =
    (el.pagination && el.pagination.rowHeight) ||
    (el.rowStyle && el.rowStyle.lineHeight) ||
    14;
  const firstY = el.y || 0;
  const continuationY = el.continuationY != null ? el.continuationY : firstY;
  const bounds = getRegionBounds(el.region || "body");
  const explicitFirstH = el.h && el.h > 0 ? el.h : null;
  const explicitOtherH = el.continuationH && el.continuationH > 0 ? el.continuationH : null;
  const firstAutoH = getAutoTableHeight(el, 0, pageCountHint);
  const otherAutoH = getAutoTableHeight(el, 1, Math.max(2, pageCountHint));
  const firstBase = explicitFirstH != null ? explicitFirstH : Math.max(0, bounds.h - firstY);
  const otherBase = explicitOtherH != null ? explicitOtherH : Math.max(0, bounds.h - continuationY);
  const firstAvailable = Math.max(0, Math.min(firstBase, firstAutoH));
  const otherAvailable = Math.max(0, Math.min(otherBase, otherAutoH));
  const perFirst = Math.max(1, Math.floor((firstAvailable - rowH) / rowH));
  const perOther = Math.max(1, Math.floor((otherAvailable - rowH) / rowH));
  const list = previewMode ? rows : [{}, {}];
  if (!previewMode || !(el.pagination && el.pagination.mode === "auto")) {
    return { pages: [list], firstAvailable, otherAvailable };
  }
  const pages = [];
  let index = 0;
  let pageIndex = 0;
  while (index < list.length) {
    const perPage = pageIndex === 0 ? perFirst : perOther;
    pages.push(list.slice(index, index + perPage));
    index += perPage;
    pageIndex += 1;
  }
  if (!pages.length) pages.push([]);
  return { pages, firstAvailable, otherAvailable };
}

function wrapTextIntoLines(text, maxChars) {
  if (!text) return [];
  const lines = [];
  const paragraphs = String(text).split(/\n\s*\n/);
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

function computeFlowPreviewData(el) {
  const defaultText = template && template.styles && template.styles.defaultText;
  const style = { ...(defaultText || {}), ...(el.style || {}) };
  const fontSize = style.size || 11;
  const lineHeight = style.lineHeight || Math.round(fontSize * 1.2);
  const columns = el.columns || 1;
  const gap = el.gap || 12;
  const bounds = getRegionBounds(el.region || "body");
  const flowW = el.w && el.w > 0 ? el.w : bounds.w - (el.x || 0);
  const flowH = el.h && el.h > 0 ? el.h : bounds.h - (el.y || 0);
  const columnWidth = columns > 1 ? (flowW - gap * (columns - 1)) / columns : flowW;
  const maxChars = columnWidth / (fontSize * 0.55);
  const text = previewMode ? resolveText(el.text || "", resolvedData || {}) : (el.text || "");
  const lines = wrapTextIntoLines(text, maxChars);
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
    pages.push(cols.join("\n"));
  }
  if (!pages.length) pages.push("");
  return { pages };
}

function computeFlowPageCount(flowPreview, repeat) {
  const count = flowPreview && flowPreview.pages ? flowPreview.pages.length : 1;
  if (repeat === "afterFirst") return count + 1;
  if (repeat === "middle") return count + 2;
  if (repeat === "last") return count + 1;
  if (repeat === "first") return 1;
  return count;
}

function resolveFlowTextForPage(flowPreview, repeat, pageIndex, pageCount) {
  if (!flowPreview || !flowPreview.pages || !flowPreview.pages.length) return "";
  let idx = pageIndex;
  if (repeat === "afterFirst") idx = pageIndex - 1;
  else if (repeat === "middle") idx = pageIndex > 0 && pageIndex < pageCount - 1 ? pageIndex - 1 : -1;
  else if (repeat === "first") idx = pageIndex === 0 ? 0 : -1;
  else if (repeat === "last") idx = pageIndex === pageCount - 1 ? flowPreview.pages.length - 1 : -1;
  if (idx < 0 || idx >= flowPreview.pages.length) return "";
  return flowPreview.pages[idx] || "";
}

function getPageMetrics() {
  const page = template.page;
  const margin = page.margin || { top: 0, right: 0, bottom: 0, left: 0 };
  const headerH = page.headerHeight || 0;
  const footerH = page.footerHeight || 0;
  const bodyW = page.width - margin.left - margin.right;
  const bodyH = page.height - margin.top - margin.bottom - headerH - footerH;
  return { page, margin, headerH, footerH, bodyW, bodyH };
}

function computePlacement(ev, el) {
  const rect = canvas.getBoundingClientRect();
  const localX = pxToPt(ev.clientX - rect.left);
  const localY = pxToPt(ev.clientY - rect.top);

  const { page, margin, headerH, footerH, bodyW, bodyH } = getPageMetrics();
  if (localX < 0 || localY < 0 || localX > page.width || localY > page.height) return null;

  const headerTop = margin.top;
  const headerBottom = margin.top + headerH;
  const bodyTop = headerBottom;
  const bodyBottom = bodyTop + bodyH;
  const footerTop = bodyBottom;
  const footerBottom = footerTop + footerH;

  let region = "body";
  let regionTop = bodyTop;
  let regionHeight = bodyH;

  if (headerH > 0 && localY >= headerTop && localY < headerBottom) {
    region = "header";
    regionTop = headerTop;
    regionHeight = headerH;
  } else if (footerH > 0 && localY >= footerTop && localY < footerBottom) {
    region = "footer";
    regionTop = footerTop;
    regionHeight = footerH;
  }

  const x = clamp(localX - margin.left, 0, Math.max(0, bodyW - el.w));
  const y = clamp(localY - regionTop, 0, Math.max(0, regionHeight - el.h));

  return { region, x, y };
}

function updatePageNav() {
  if (pageIndicator) pageIndicator.textContent = `Page ${previewPageIndex + 1} / ${previewPageCount}`;
  if (pagePrevBtn) pagePrevBtn.disabled = previewPageIndex <= 0;
  if (pageNextBtn) pageNextBtn.disabled = previewPageIndex >= previewPageCount - 1;
}

function setPreviewPage(nextIndex) {
  const clamped = clamp(nextIndex, 0, Math.max(0, previewPageCount - 1));
  if (clamped === previewPageIndex) return;
  previewPageIndex = clamped;
  render();
}

function renderElement(el, ctx = {}) {
  if (!isVisible(el.visibleIf)) {
    return document.createElement("div");
  }

  const div = document.createElement("div");
  div.className = `element ${el.type}`;
  div.dataset.id = el.id;
  div.style.left = `${ptToPx(el.x)}px`;
  div.style.top = `${ptToPx(el.y)}px`;
  div.style.width = `${ptToPx(el.w)}px`;
  div.style.height = `${ptToPx(el.h)}px`;

  if (el.id === selectedId) div.classList.add("selected");

  const defaultText = template.styles && template.styles.defaultText;
  applyStyle(div, el.style, el.type === "text" ? defaultText : null);

  if (el.type === "text") {
    const resolved = previewMode
      ? resolveText(el.text || "", resolvedData || {}, ctx.textCtx || null)
      : el.text || "";
    if (el.richText) {
      div.innerHTML = resolved;
      div.style.whiteSpace = "normal";
    } else {
      div.textContent = resolved;
    }
    div.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      enableTextEdit(div, el);
    });
  } else if (el.type === "flowText") {
    const resolved = typeof ctx.flowText === "string"
      ? ctx.flowText
      : (previewMode
        ? resolveText(el.text || "", resolvedData || {}, ctx.textCtx || null)
        : el.text || "");
    const fallback =
      previewMode && !resolved && el.text && el.text.includes("{{")
        ? "[Missing data for flowText]"
        : resolved;
    div.textContent = fallback;
    div.style.whiteSpace = "pre-wrap";
    div.style.overflow = "hidden";
    div.style.columnCount = el.columns || 1;
    div.style.columnGap = `${el.gap || 12}pt`;
    div.style.columnFill = "auto";
    if (!el.h || el.h <= 0) {
      const bounds = getRegionBounds(el.region || "body");
      const h = Math.max(0, bounds.h - (el.y || 0));
      div.style.height = `${ptToPx(h)}px`;
    }
    div.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      enableTextEdit(div, el);
    });
  } else if (el.type === "image") {
    const raw = el.src || "";
    const resolved = previewMode ? resolveText(raw, resolvedData || {}, ctx.textCtx || null) : raw;
    const src = previewMode || !raw.includes("{{") ? resolved : placeholderImage("Image");
    const img = document.createElement("img");
    img.src = src;
    img.alt = el.id;
    img.style.objectFit = el.fit || "contain";
    div.appendChild(img);
  } else if (el.type === "table") {
    const rowsPath = (el.rows || "").replace(/\{\{|\}\}/g, "").trim();
    const rows = previewMode ? resolvePath(resolvedData || {}, rowsPath) || [] : [];
    const displayRows = ctx.tableRows || (previewMode ? rows.slice(0, 3) : [{}, {}]);
    const targetHeight =
      ctx.tableHeight != null ? ctx.tableHeight : ((el.h && el.h > 0) ? el.h : null);
    const table = buildTable(el, displayRows, { height: targetHeight });
    if (ctx.tableHeight != null) {
      div.style.height = `${ptToPx(ctx.tableHeight)}px`;
    } else if (!el.h || el.h <= 0) {
      const autoH = getAutoTableHeight(el);
      div.style.height = `${ptToPx(autoH)}px`;
    }
    div.style.overflow = "hidden";
    div.innerHTML = "";
    div.appendChild(table);
  } else if (el.type === "qr") {
    div.textContent = previewMode ? "" : "QR";
  } else if (el.type === "line") {
    div.textContent = "";
  } else if (el.type === "box") {
    div.textContent = "";
  } else if (el.type === "include") {
    div.textContent = `Include: ${el.ref}`;
    div.style.border = "1px dashed #999";
  }

  if (el.id === selectedId) {
    addResizeHandles(div, el.id);
  }

  div.addEventListener("pointerdown", (ev) => {
    if (placingType) {
      ev.stopPropagation();
      return;
    }
    ev.stopPropagation();
    if (div.classList.contains("editing")) return;
    const wasSelected = selectedId === el.id;
    selectedId = el.id;
    dragState = {
      id: el.id,
      startX: ev.clientX,
      startY: ev.clientY,
      originX: el.x,
      originY: el.y
    };
    if (!wasSelected) {
      render();
    }
  });

  return div;
}

function addResizeHandles(container, id) {
  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  handles.forEach((dir) => {
    const h = document.createElement("div");
    h.className = `resize-handle ${dir}`;
    h.dataset.dir = dir;
    h.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      const el = getElementById(id);
      if (!el) return;
      dragState = {
        id,
        mode: "resize",
        dir,
        startX: ev.clientX,
        startY: ev.clientY,
        originX: el.x,
        originY: el.y,
        originW: el.w,
        originH: el.h
      };
    });
    container.appendChild(h);
  });
}

function render() {
  if (!template) return;
  syncDataContractBindings();
  contractDiagnostics = evaluateDataContractLocal(data || {});
  resolvedData = contractDiagnostics.data || {};
  ensureFontFaces();
  canvas.innerHTML = "";

  const page = template.page;
  const margin = page.margin || { top: 0, right: 0, bottom: 0, left: 0 };
  const headerH = page.headerHeight || 0;
  const footerH = page.footerHeight || 0;
  const bodyW = page.width - margin.left - margin.right;
  const bodyH = page.height - margin.top - margin.bottom - headerH - footerH;

  canvas.style.width = `${ptToPx(page.width)}px`;
  canvas.style.height = `${ptToPx(page.height)}px`;

  const pageEl = document.createElement("div");
  pageEl.className = "page";
  pageEl.style.width = `${ptToPx(page.width)}px`;
  pageEl.style.height = `${ptToPx(page.height)}px`;

  const header = document.createElement("div");
  header.className = "page-header";
  header.style.left = `${ptToPx(margin.left)}px`;
  header.style.top = `${ptToPx(margin.top)}px`;
  header.style.width = `${ptToPx(bodyW)}px`;
  header.style.height = `${ptToPx(headerH)}px`;
  if (headerH > 0) {
    // no label
  }

  const body = document.createElement("div");
  body.className = "page-body";
  body.style.left = `${ptToPx(margin.left)}px`;
  body.style.top = `${ptToPx(margin.top + headerH)}px`;
  body.style.width = `${ptToPx(bodyW)}px`;
  body.style.height = `${ptToPx(bodyH)}px`;
  // no label

  const footer = document.createElement("div");
  footer.className = "page-footer";
  footer.style.left = `${ptToPx(margin.left)}px`;
  footer.style.top = `${ptToPx(margin.top + headerH + bodyH)}px`;
  footer.style.width = `${ptToPx(bodyW)}px`;
  footer.style.height = `${ptToPx(footerH)}px`;
  if (footerH > 0) {
    // no label
  }

  const elements = getElements();
  const pagedTable = elements.find(
    (el) => (el.region || "body") === "body" && el.type === "table" && el.pagination && el.pagination.mode === "auto"
  );
  const tablePreview = pagedTable ? computeTablePreviewData(pagedTable) : null;
  const flowElement = elements.find((el) => (el.region || "body") === "body" && el.type === "flowText");
  const flowPreview = flowElement ? computeFlowPreviewData(flowElement) : null;
  const flowRepeat = flowElement ? (flowElement.repeat || getDefaultRepeat(flowElement)) : "all";
  const tablePageCount = tablePreview ? tablePreview.pages.length : 1;
  const flowPageCount = flowPreview ? computeFlowPageCount(flowPreview, flowRepeat) : 1;
  const pageCount = Math.max(1, tablePageCount, flowPageCount);
  previewPageCount = pageCount;
  previewPageIndex = clamp(previewPageIndex, 0, Math.max(0, pageCount - 1));
  const currentPage = previewPageIndex;
  const textCtx = { pageNumber: currentPage + 1, pageCount };

  elements.forEach((el) => {
    if (!shouldRenderInPage(el, currentPage, pageCount)) return;
    const target = el.region === "header" ? header : el.region === "footer" ? footer : body;
    if (pagedTable && el.id === pagedTable.id && tablePreview) {
      const tableRows = tablePreview.pages[currentPage] || [];
      const tableHeight = currentPage === 0 ? tablePreview.firstAvailable : tablePreview.otherAvailable;
      target.appendChild(
        renderElement(el, {
          tableRows,
          tableHeight,
          textCtx
        })
      );
      return;
    }
    if (flowElement && el.id === flowElement.id && flowPreview) {
      const repeat = el.repeat || getDefaultRepeat(el);
      const flowText = resolveFlowTextForPage(flowPreview, repeat, currentPage, pageCount);
      if (!flowText) return;
      target.appendChild(renderElement(el, { flowText, textCtx }));
      return;
    }
    target.appendChild(renderElement(el, { textCtx }));
  });

  pageEl.appendChild(header);
  pageEl.appendChild(body);
  pageEl.appendChild(footer);
  canvas.appendChild(pageEl);
  updatePageNav();

  renderProps();
  if (dataStatus) {
    const missing = findMissingBindings();
    const missingRequired = (contractDiagnostics && contractDiagnostics.missingRequired) || [];
    const missingText = missing.length
      ? `missing: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}`
      : "missing: none";
    const requiredText = missingRequired.length
      ? `required missing: ${missingRequired.slice(0, 3).join(", ")}${missingRequired.length > 3 ? "..." : ""}`
      : "required missing: none";
    dataStatus.textContent = `Data: ${dataName} (${missingText}; ${requiredText})`;
  }
}

function renderProps() {
  if (placingType && !selectedId) {
    props.textContent = `Click on the canvas to place: ${placingType}`;
    return;
  }
  const el = selectedId ? getElementById(selectedId) : null;
  if (!el) {
    renderPageSettings();
    return;
  }

  props.innerHTML = "";

  function addRow(label, inputEl) {
    const row = document.createElement("div");
    row.className = "prop-row";
    const lbl = document.createElement("div");
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(inputEl);
    props.appendChild(row);
  }

  const idField = document.createElement("input");
  idField.value = el.id;
  idField.disabled = true;
  addRow("id", idField);

  const typeField = document.createElement("input");
  typeField.value = el.type;
  typeField.disabled = true;
  addRow("type", typeField);

  if (el.type === "include") {
    const refField = document.createElement("input");
    refField.value = el.ref || "";
    refField.addEventListener("input", () => {
      el.ref = refField.value;
      render();
    });
    addRow("ref", refField);
  }

  const regionField = document.createElement("select");
  ["body", "header", "footer"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if ((el.region || "body") === opt) o.selected = true;
    regionField.appendChild(o);
  });
  regionField.addEventListener("change", () => {
    el.region = regionField.value;
    render();
  });
  addRow("region", regionField);

  const repeatField = document.createElement("select");
  ["", "all", "first", "afterFirst", "middle", "last"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt || "auto";
    const defaultRepeat = (el.region || "body") === "body" ? "first" : "all";
    if (String(el.repeat || defaultRepeat) === opt) o.selected = true;
    repeatField.appendChild(o);
  });
  repeatField.addEventListener("change", () => {
    el.repeat = repeatField.value || undefined;
    render();
  });
  addRow("repeat", repeatField);

  const visibleIfField = document.createElement("input");
  visibleIfField.value = el.visibleIf || "";
  visibleIfField.placeholder = "exists(customer.name) && len(items) > 0";
  visibleIfField.addEventListener("input", () => {
    el.visibleIf = visibleIfField.value.trim() || undefined;
    render();
  });
  addRow("visibleIf", visibleIfField);

  ["x", "y", "w", "h"].forEach((key) => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = el[key];
    input.addEventListener("input", () => {
      el[key] = Number(input.value);
      render();
    });
    addRow(key, input);
  });

  if (el.type === "text" || el.type === "flowText") {
    const t = document.createElement("textarea");
    t.value = el.text || "";
    t.addEventListener("input", () => {
      el.text = t.value;
      render();
    });
    addRow("text", t);

    if (el.type === "text") {
      const rich = document.createElement("input");
      rich.type = "checkbox";
      rich.checked = Boolean(el.richText);
      rich.addEventListener("change", () => {
        el.richText = rich.checked;
        render();
      });
      addRow("richText", rich);
    }

    if (el.type === "flowText") {
      const cols = document.createElement("input");
      cols.type = "number";
      cols.value = el.columns || 1;
      cols.addEventListener("input", () => {
        el.columns = Math.max(1, Number(cols.value) || 1);
        render();
      });
      addRow("columns", cols);

      const gap = document.createElement("input");
      gap.type = "number";
      gap.value = el.gap || 12;
      gap.addEventListener("input", () => {
        el.gap = Math.max(0, Number(gap.value) || 0);
        render();
      });
      addRow("gap", gap);
    }

    const fontSelect = document.createElement("select");
    const optAuto = document.createElement("option");
    optAuto.value = "";
    optAuto.textContent = "auto";
    fontSelect.appendChild(optAuto);
    const fonts = (template && template.fonts) || [];
    fonts.forEach((f) => {
      const o = document.createElement("option");
      o.value = f.name;
      o.textContent = f.name;
      if ((el.style && el.style.font) === f.name) o.selected = true;
      fontSelect.appendChild(o);
    });
    fontSelect.addEventListener("change", () => {
      const style = ensureStyle(el);
      style.font = fontSelect.value || undefined;
      render();
    });
    addRow("font", fontSelect);

    const size = document.createElement("input");
    size.type = "number";
    size.value = (el.style && el.style.size) || "";
    size.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.size = Number(size.value) || undefined;
      render();
    });
    addRow("fontSize", size);

    const weight = document.createElement("select");
    ["", "400", "500", "600", "700"].forEach((val) => {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = val === "" ? "auto" : val;
      if (String((el.style && el.style.weight) || "") === val) o.selected = true;
      weight.appendChild(o);
    });
    weight.addEventListener("change", () => {
      const style = ensureStyle(el);
      style.weight = weight.value ? Number(weight.value) : undefined;
      render();
    });
    addRow("weight", weight);

    const fontStyle = document.createElement("select");
    ["", "normal", "italic"].forEach((val) => {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = val === "" ? "auto" : val;
      if (String((el.style && el.style.fontStyle) || "") === val) o.selected = true;
      fontStyle.appendChild(o);
    });
    fontStyle.addEventListener("change", () => {
      const style = ensureStyle(el);
      style.fontStyle = fontStyle.value || undefined;
      render();
    });
    addRow("style", fontStyle);

    const color = document.createElement("input");
    color.type = "color";
    color.value = (el.style && el.style.color) || "#111111";
    color.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.color = color.value;
      render();
    });
    addRow("color", color);

    const align = document.createElement("select");
    ["", "left", "center", "right", "justify"].forEach((val) => {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = val === "" ? "auto" : val;
      if (String((el.style && el.style.align) || "") === val) o.selected = true;
      align.appendChild(o);
    });
    align.addEventListener("change", () => {
      const style = ensureStyle(el);
      style.align = align.value || undefined;
      render();
    });
    addRow("align", align);

    const lh = document.createElement("input");
    lh.type = "number";
    lh.value = (el.style && el.style.lineHeight) || "";
    lh.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.lineHeight = Number(lh.value) || undefined;
      render();
    });
    addRow("lineHeight", lh);

    const presetSelect = document.createElement("select");
    const autoPreset = document.createElement("option");
    autoPreset.value = "";
    autoPreset.textContent = "preset";
    presetSelect.appendChild(autoPreset);
    const presets = getStylePresets();
    Object.keys(presets).forEach((name) => {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      presetSelect.appendChild(o);
    });
    presetSelect.addEventListener("change", () => {
      const name = presetSelect.value;
      if (!name) return;
      const style = ensureStyle(el);
      Object.assign(style, presets[name]);
      render();
    });
    addRow("preset", presetSelect);
  }

  if (el.type === "image") {
    const src = document.createElement("input");
    src.value = el.src || "";
    src.addEventListener("input", () => {
      el.src = src.value;
      render();
    });
    addRow("src", src);

    const upload = document.createElement("input");
    upload.type = "file";
    upload.accept = "image/*";
    upload.addEventListener("change", () => {
      const file = upload.files && upload.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        el.src = reader.result;
        render();
      };
      reader.readAsDataURL(file);
    });
    addRow("upload", upload);
  }

  if (el.type === "qr") {
    const val = document.createElement("input");
    val.value = el.value || "";
    val.addEventListener("input", () => {
      el.value = val.value;
      render();
    });
    addRow("value", val);
  }

  if (el.type === "table") {
    const rows = document.createElement("input");
    rows.value = el.rows || "";
    rows.addEventListener("input", () => {
      el.rows = rows.value;
      render();
    });
    addRow("rows", rows);

    const colsEditor = document.createElement("div");
    colsEditor.style.display = "flex";
    colsEditor.style.flexDirection = "column";
    colsEditor.style.gap = "6px";

    function buildColumnRow(col, index) {
      const row = document.createElement("div");
      row.style.border = "1px solid #ddd";
      row.style.padding = "6px";
      row.style.background = "#fff";
      row.style.display = "grid";
      row.style.gridTemplateColumns = "1fr 1fr 56px 72px auto";
      row.style.gap = "4px";
      row.style.alignItems = "center";

      const h = document.createElement("input");
      h.value = col.header || "";
      h.placeholder = "Header";
      h.addEventListener("input", () => {
        col.header = h.value;
        render();
      });

      const f = document.createElement("input");
      f.value = col.field || "";
      f.placeholder = "field.path";
      f.addEventListener("input", () => {
        col.field = f.value;
        render();
      });

      const w = document.createElement("input");
      w.type = "number";
      w.value = col.w || 80;
      w.addEventListener("input", () => {
        col.w = Number(w.value) || 80;
        render();
      });

      const a = document.createElement("select");
      ["left", "center", "right"].forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if ((col.align || "left") === opt) o.selected = true;
        a.appendChild(o);
      });
      a.addEventListener("change", () => {
        col.align = a.value;
        render();
      });

      const del = document.createElement("button");
      del.textContent = "Del";
      del.addEventListener("click", () => {
        el.columns.splice(index, 1);
        render();
      });

      row.appendChild(h);
      row.appendChild(f);
      row.appendChild(w);
      row.appendChild(a);
      row.appendChild(del);
      return row;
    }

    (el.columns || []).forEach((col, index) => {
      colsEditor.appendChild(buildColumnRow(col, index));
    });

    const addCol = document.createElement("button");
    addCol.textContent = "Add Column";
    addCol.addEventListener("click", () => {
      if (!Array.isArray(el.columns)) el.columns = [];
      el.columns.push({ header: "New", field: "field", w: 80, align: "left" });
      render();
    });
    colsEditor.appendChild(addCol);
    addRow("columns", colsEditor);

    const continuationY = document.createElement("input");
    continuationY.type = "number";
    continuationY.value = el.continuationY != null ? el.continuationY : "";
    continuationY.addEventListener("input", () => {
      el.continuationY = continuationY.value === "" ? undefined : Number(continuationY.value);
      render();
    });
    addRow("continuationY", continuationY);

    const continuationH = document.createElement("input");
    continuationH.type = "number";
    continuationH.value = el.continuationH != null ? el.continuationH : "";
    continuationH.addEventListener("input", () => {
      el.continuationH = continuationH.value === "" ? undefined : Number(continuationH.value);
      render();
    });
    addRow("continuationH", continuationH);

    const fillMode = document.createElement("select");
    ["none", "pad"].forEach((mode) => {
      const o = document.createElement("option");
      o.value = mode;
      o.textContent = mode;
      if ((el.fillMode || "none") === mode) o.selected = true;
      fillMode.appendChild(o);
    });
    fillMode.addEventListener("change", () => {
      const next = fillMode.value || "none";
      el.fillMode = next === "none" ? undefined : next;
      render();
    });
    addRow("fillMode", fillMode);
  }

  if (el.type === "box") {
    const borderColor = document.createElement("input");
    borderColor.type = "color";
    borderColor.value = (el.style && el.style.borderColor) || "#cccccc";
    borderColor.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.borderColor = borderColor.value;
      if (style.borderWidth == null) style.borderWidth = 1;
      render();
    });
    addRow("borderColor", borderColor);

    const borderWidth = document.createElement("input");
    borderWidth.type = "number";
    borderWidth.value = (el.style && el.style.borderWidth) != null ? el.style.borderWidth : 1;
    borderWidth.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.borderWidth = Number(borderWidth.value) || 0;
      render();
    });
    addRow("borderWidth", borderWidth);

    const fill = document.createElement("input");
    fill.type = "color";
    fill.value = (el.style && el.style.fill) || "#f9f9f9";
    fill.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.fill = fill.value;
      render();
    });
    addRow("fill", fill);

    const radius = document.createElement("input");
    radius.type = "number";
    radius.value = (el.style && el.style.borderRadius) || 0;
    radius.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.borderRadius = Number(radius.value) || 0;
      render();
    });
    addRow("radius", radius);
  }
}

function renderPageSettings() {
  if (!template) {
    props.textContent = "Select an element.";
    return;
  }
  props.innerHTML = "";

  if (editingPartial) {
    const banner = document.createElement("div");
    banner.className = "panel-title";
    banner.textContent = `Editing Partial: ${editingPartial}`;
    props.appendChild(banner);
  }

  const title = document.createElement("div");
  title.className = "panel-title";
  title.textContent = "Page Settings";
  props.appendChild(title);

  function addRow(label, inputEl) {
    const row = document.createElement("div");
    row.className = "prop-row";
    const lbl = document.createElement("div");
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(inputEl);
    props.appendChild(row);
  }

  const page = template.page;

  ["width", "height"].forEach((key) => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = page[key];
    input.addEventListener("input", () => {
      page[key] = Number(input.value);
      render();
    });
    addRow(`page.${key}`, input);
  });

  ["top", "right", "bottom", "left"].forEach((key) => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = page.margin[key];
    input.addEventListener("input", () => {
      page.margin[key] = Number(input.value);
      render();
    });
    addRow(`margin.${key}`, input);
  });

  ["headerHeight", "footerHeight"].forEach((key) => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = page[key] || 0;
    input.addEventListener("input", () => {
      page[key] = Number(input.value);
      render();
    });
    addRow(key, input);
  });

  const contractTitle = document.createElement("div");
  contractTitle.className = "panel-title";
  contractTitle.textContent = "Data Contract";
  props.appendChild(contractTitle);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.marginBottom = "8px";
  const syncBtn = document.createElement("button");
  syncBtn.textContent = "Sync Bindings";
  syncBtn.addEventListener("click", () => {
    syncDataContractBindings();
    render();
  });
  actions.appendChild(syncBtn);
  props.appendChild(actions);

  const contract = ensureDataContract();
  if (!contract.fields.length) {
    const empty = document.createElement("div");
    empty.style.fontSize = "12px";
    empty.style.color = "#7a6f5f";
    empty.textContent = "No bindings detected. Add components with {{field.path}} first.";
    props.appendChild(empty);
  }

  const currentIssues = summarizeContractDiagnostics(contractDiagnostics);
  const issueSummary = document.createElement("div");
  issueSummary.style.fontSize = "12px";
  issueSummary.style.color = currentIssues.missingRequired.length || currentIssues.errors.length ? "#9f2f23" : "#3c6f3a";
  issueSummary.style.marginBottom = "8px";
  issueSummary.textContent = currentIssues.missingRequired.length || currentIssues.errors.length
    ? `Contract issues: ${currentIssues.missingRequired.length} required missing, ${currentIssues.errors.length} transform errors`
    : "Contract issues: none";
  props.appendChild(issueSummary);

  contract.fields.forEach((field) => {
    const fieldDiag = (contractDiagnostics.fields || []).find((f) => f.path === field.path);
    const card = document.createElement("div");
    card.style.border = "1px solid #ddd";
    card.style.padding = "8px";
    card.style.marginBottom = "8px";
    card.style.background = "#fff";

    const path = document.createElement("div");
    path.style.fontSize = "12px";
    path.style.fontWeight = "600";
    path.style.marginBottom = "6px";
    path.textContent = field.path;
    card.appendChild(path);

    if (fieldDiag && (fieldDiag.missing || fieldDiag.error)) {
      const diag = document.createElement("div");
      diag.style.fontSize = "11px";
      diag.style.color = "#9f2f23";
      diag.style.marginBottom = "6px";
      const parts = [];
      if (fieldDiag.missing) parts.push("Missing required in current data");
      if (fieldDiag.error) parts.push(`Transform error: ${fieldDiag.error}`);
      diag.textContent = parts.join(" | ");
      card.appendChild(diag);
    }

    const row1 = document.createElement("div");
    row1.style.display = "grid";
    row1.style.gridTemplateColumns = "auto 1fr auto 1fr";
    row1.style.gap = "6px";
    row1.style.alignItems = "center";
    row1.style.marginBottom = "6px";

    const reqLabel = document.createElement("span");
    reqLabel.textContent = "required";
    reqLabel.style.fontSize = "12px";
    const req = document.createElement("input");
    req.type = "checkbox";
    req.checked = Boolean(field.required);
    req.addEventListener("change", () => {
      field.required = req.checked;
      render();
    });

    const typeLabel = document.createElement("span");
    typeLabel.textContent = "type";
    typeLabel.style.fontSize = "12px";
    const type = document.createElement("select");
    ["string", "number", "boolean", "array", "object"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if ((field.type || "string") === opt) o.selected = true;
      type.appendChild(o);
    });
    type.addEventListener("change", () => {
      field.type = type.value;
      render();
    });

    row1.appendChild(reqLabel);
    row1.appendChild(req);
    row1.appendChild(typeLabel);
    row1.appendChild(type);
    card.appendChild(row1);

    const row2 = document.createElement("div");
    row2.style.display = "grid";
    row2.style.gridTemplateColumns = "54px 1fr";
    row2.style.gap = "6px";
    row2.style.alignItems = "center";
    row2.style.marginBottom = "6px";
    const sourceLabel = document.createElement("span");
    sourceLabel.textContent = "source";
    sourceLabel.style.fontSize = "12px";
    const source = document.createElement("select");
    ["external", "template", "computed"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if ((field.source || "external") === opt) o.selected = true;
      source.appendChild(o);
    });
    source.addEventListener("change", () => {
      field.source = source.value;
      render();
    });
    row2.appendChild(sourceLabel);
    row2.appendChild(source);
    card.appendChild(row2);

    const row3 = document.createElement("div");
    row3.style.display = "grid";
    row3.style.gridTemplateColumns = "54px 1fr";
    row3.style.gap = "6px";
    row3.style.alignItems = "center";
    row3.style.marginBottom = "6px";
    const externalLabel = document.createElement("span");
    externalLabel.textContent = "external";
    externalLabel.style.fontSize = "12px";
    const external = document.createElement("input");
    external.value = field.externalPath || field.path;
    external.placeholder = "upstream.payload.path";
    external.addEventListener("input", () => {
      field.externalPath = external.value.trim() || field.path;
      render();
    });
    row3.appendChild(externalLabel);
    row3.appendChild(external);
    card.appendChild(row3);

    const row4 = document.createElement("div");
    row4.style.display = "grid";
    row4.style.gridTemplateColumns = "54px 1fr";
    row4.style.gap = "6px";
    row4.style.alignItems = "center";
    row4.style.marginBottom = "6px";
    const defLabel = document.createElement("span");
    defLabel.textContent = "default";
    defLabel.style.fontSize = "12px";
    const def = document.createElement("input");
    def.value = field.defaultValue == null ? "" : String(field.defaultValue);
    def.placeholder = "fallback value";
    def.addEventListener("input", () => {
      field.defaultValue = def.value;
      render();
    });
    row4.appendChild(defLabel);
    row4.appendChild(def);
    card.appendChild(row4);

    const row5 = document.createElement("div");
    row5.style.display = "grid";
    row5.style.gridTemplateColumns = "64px 1fr";
    row5.style.gap = "6px";
    row5.style.alignItems = "center";
    row5.style.marginBottom = "6px";
    const transformLabel = document.createElement("span");
    transformLabel.textContent = "transform";
    transformLabel.style.fontSize = "12px";
    const transform = document.createElement("select");
    ["none", "trim", "uppercase", "lowercase", "titlecase", "number", "boolean", "date", "currency"].forEach(
      (opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if ((field.transform || "none") === opt) o.selected = true;
        transform.appendChild(o);
      }
    );
    transform.addEventListener("change", () => {
      field.transform = transform.value;
      render();
    });
    row5.appendChild(transformLabel);
    row5.appendChild(transform);
    card.appendChild(row5);

    const row6 = document.createElement("div");
    row6.style.display = "grid";
    row6.style.gridTemplateColumns = "64px 1fr 58px 1fr";
    row6.style.gap = "6px";
    row6.style.alignItems = "center";
    row6.style.marginBottom = "6px";
    const localeLabel = document.createElement("span");
    localeLabel.textContent = "locale";
    localeLabel.style.fontSize = "12px";
    const locale = document.createElement("input");
    locale.value = field.transformLocale || "";
    locale.placeholder = "en-US";
    locale.addEventListener("input", () => {
      field.transformLocale = locale.value.trim() || undefined;
      render();
    });
    const curLabel = document.createElement("span");
    curLabel.textContent = "currency";
    curLabel.style.fontSize = "12px";
    const cur = document.createElement("input");
    cur.value = field.transformCurrency || "";
    cur.placeholder = "USD";
    cur.addEventListener("input", () => {
      field.transformCurrency = cur.value.trim() || undefined;
      render();
    });
    row6.appendChild(localeLabel);
    row6.appendChild(locale);
    row6.appendChild(curLabel);
    row6.appendChild(cur);
    card.appendChild(row6);

    const row7 = document.createElement("div");
    row7.style.display = "grid";
    row7.style.gridTemplateColumns = "64px 1fr";
    row7.style.gap = "6px";
    row7.style.alignItems = "center";
    const dateStyleLabel = document.createElement("span");
    dateStyleLabel.textContent = "dateStyle";
    dateStyleLabel.style.fontSize = "12px";
    const dateStyle = document.createElement("select");
    ["", "short", "medium", "long", "full"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt || "auto";
      if (String(field.transformDateStyle || "") === opt) o.selected = true;
      dateStyle.appendChild(o);
    });
    dateStyle.addEventListener("change", () => {
      field.transformDateStyle = dateStyle.value || undefined;
      render();
    });
    row7.appendChild(dateStyleLabel);
    row7.appendChild(dateStyle);
    card.appendChild(row7);

    props.appendChild(card);
  });

  const testTitle = document.createElement("div");
  testTitle.className = "panel-title";
  testTitle.textContent = "Contract Test";
  props.appendChild(testTitle);

  const testInfo = document.createElement("div");
  testInfo.style.fontSize = "12px";
  testInfo.style.color = "#6f6352";
  testInfo.style.marginBottom = "6px";
  testInfo.textContent = "Paste external payload JSON and validate mapping + required fields.";
  props.appendChild(testInfo);

  const payloadInput = document.createElement("textarea");
  payloadInput.style.width = "100%";
  payloadInput.style.height = "120px";
  payloadInput.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
  payloadInput.value = contractTestPayload || JSON.stringify(data || {}, null, 2);
  props.appendChild(payloadInput);

  const testActions = document.createElement("div");
  testActions.style.display = "flex";
  testActions.style.gap = "8px";
  testActions.style.marginTop = "6px";
  testActions.style.marginBottom = "6px";

  const runTestBtn = document.createElement("button");
  runTestBtn.textContent = "Run Contract Test";
  runTestBtn.addEventListener("click", () => {
    contractTestPayload = payloadInput.value;
    try {
      const parsed = JSON.parse(payloadInput.value || "{}");
      contractTestResult = evaluateDataContractLocal(parsed);
      render();
    } catch (_err) {
      contractTestResult = { parseError: "Invalid JSON payload" };
      render();
    }
  });
  testActions.appendChild(runTestBtn);

  const usePayloadBtn = document.createElement("button");
  usePayloadBtn.textContent = "Use As Data";
  usePayloadBtn.addEventListener("click", () => {
    try {
      const parsed = JSON.parse(payloadInput.value || "{}");
      data = parsed;
      dataName = "(contract test payload)";
      contractTestPayload = payloadInput.value;
      contractTestResult = evaluateDataContractLocal(parsed);
      render();
    } catch (_err) {
      alert("Invalid JSON payload");
    }
  });
  testActions.appendChild(usePayloadBtn);
  props.appendChild(testActions);

  if (contractTestResult) {
    const resultBox = document.createElement("div");
    resultBox.style.border = "1px solid #ddd";
    resultBox.style.background = "#fff";
    resultBox.style.padding = "8px";
    resultBox.style.marginBottom = "8px";
    if (contractTestResult.parseError) {
      const err = document.createElement("div");
      err.style.color = "#9f2f23";
      err.style.fontSize = "12px";
      err.textContent = contractTestResult.parseError;
      resultBox.appendChild(err);
    } else {
      const issues = summarizeContractDiagnostics(contractTestResult);
      const summary = document.createElement("div");
      summary.style.fontSize = "12px";
      summary.style.marginBottom = "6px";
      summary.style.color = issues.missingRequired.length || issues.errors.length ? "#9f2f23" : "#3c6f3a";
      summary.textContent = issues.missingRequired.length || issues.errors.length
        ? `Issues: ${issues.missingRequired.length} required missing, ${issues.errors.length} transform errors`
        : "Issues: none";
      resultBox.appendChild(summary);

      if (issues.missingRequired.length) {
        const miss = document.createElement("div");
        miss.style.fontSize = "12px";
        miss.style.marginBottom = "6px";
        miss.textContent = `Missing required: ${issues.missingRequired.join(", ")}`;
        resultBox.appendChild(miss);
      }
      if (issues.errors.length) {
        const errs = document.createElement("div");
        errs.style.fontSize = "12px";
        errs.style.marginBottom = "6px";
        errs.textContent = `Transform errors: ${issues.errors.join(" | ")}`;
        resultBox.appendChild(errs);
      }

      const mappedTitle = document.createElement("div");
      mappedTitle.style.fontSize = "12px";
      mappedTitle.style.fontWeight = "600";
      mappedTitle.style.marginBottom = "4px";
      mappedTitle.textContent = "Mapped payload";
      resultBox.appendChild(mappedTitle);

      const mapped = document.createElement("pre");
      mapped.style.margin = "0";
      mapped.style.maxHeight = "140px";
      mapped.style.overflow = "auto";
      mapped.style.fontSize = "11px";
      mapped.style.whiteSpace = "pre-wrap";
      mapped.textContent = JSON.stringify(contractTestResult.data || {}, null, 2);
      resultBox.appendChild(mapped);
    }
    props.appendChild(resultBox);
  }
}

function onPointerMove(ev) {
  if (!dragState) return;
  const el = getElementById(dragState.id);
  if (!el) return;
  const dx = pxToPt(ev.clientX - dragState.startX);
  const dy = pxToPt(ev.clientY - dragState.startY);

  const minSize = 6;
  const bounds = getRegionBounds(el.region || "body");

  if (dragState.mode === "resize") {
    let x = dragState.originX;
    let y = dragState.originY;
    let w = dragState.originW;
    let h = dragState.originH;
    const dir = dragState.dir;

    if (dir.includes("e")) w = dragState.originW + dx;
    if (dir.includes("s")) h = dragState.originH + dy;
    if (dir.includes("w")) {
      w = dragState.originW - dx;
      x = dragState.originX + dx;
    }
    if (dir.includes("n")) {
      h = dragState.originH - dy;
      y = dragState.originY + dy;
    }

    w = clamp(w, minSize, bounds.w - x);
    h = clamp(h, minSize, bounds.h - y);
    x = clamp(x, bounds.x, bounds.w - w);
    y = clamp(y, bounds.y, bounds.h - h);

    el.x = x;
    el.y = y;
    el.w = w;
    el.h = h;
  } else {
    let x = dragState.originX + dx;
    let y = dragState.originY + dy;
    x = clamp(x, bounds.x, bounds.w - el.w);
    y = clamp(y, bounds.y, bounds.h - el.h);
    el.x = x;
    el.y = y;
  }

  render();
}

function onPointerUp() {
  dragState = null;
}

canvas.addEventListener("pointerdown", () => {
  if (placingType) return;
  selectedId = null;
  render();
});

window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

addButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (activeLeftMode !== "design") setLeftMode("design");
    const type = btn.dataset.add;
    if (placingType === type) {
      clearPlacing();
      render();
      return;
    }
    setPlacing(type);
  });
});

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setLeftMode(btn.dataset.mode);
  });
});

quickProxyButtons.forEach((proxyBtn) => {
  proxyBtn.addEventListener("click", () => {
    const targetId = proxyBtn.dataset.proxyClick;
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target || target.disabled) return;
    target.click();
    syncQuickActions();
  });
});

document.getElementById("btn-export").addEventListener("click", saveTemplateDownload);
document.getElementById("btn-reload").addEventListener("click", () => {
  const path = activeStarterPath || (starterTemplateSelect && starterTemplateSelect.value);
  if (!path) return;
  loadTemplateFromUrl(path);
});
previewBtn.addEventListener("click", () => {
  previewMode = !previewMode;
  previewBtn.textContent = `Preview Data: ${previewMode ? "On" : "Off"}`;
  render();
});
loadDataBtn.addEventListener("click", () => dataFileInput.click());
dataFileInput.addEventListener("change", () => {
  const file = dataFileInput.files && dataFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      data = JSON.parse(reader.result);
      dataName = file.name;
      contractTestPayload = "";
      contractTestResult = null;
      render();
    } catch (e) {
      // ignore invalid JSON
    }
  };
  reader.readAsText(file);
});

loadTemplateBtn.addEventListener("click", () => templateFileInput.click());
templateFileInput.addEventListener("change", () => {
  const file = templateFileInput.files && templateFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const next = JSON.parse(reader.result);
      activeStarterPath = null;
      contractTestPayload = "";
      contractTestResult = null;
      setTemplate(next);
    } catch (e) {
      // ignore invalid JSON
    }
  };
  reader.readAsText(file);
});

if (newTemplateBtn) {
  newTemplateBtn.addEventListener("click", () => {
    const name = prompt("Template name?", "Untitled Template");
    data = {};
    dataName = "(none)";
    contractTestPayload = "";
    contractTestResult = null;
    activeStarterPath = null;
    setTemplate(createBlankTemplate(name || "Untitled Template"));
  });
}

if (loadStarterBtn) {
  loadStarterBtn.addEventListener("click", () => {
    if (!starterTemplateSelect || !starterTemplateSelect.value) return;
    loadTemplateFromUrl(starterTemplateSelect.value);
  });
}

if (dbRefreshBtn) {
  dbRefreshBtn.addEventListener("click", () => {
    refreshDbTemplates();
  });
}

if (dbLoadBtn) {
  dbLoadBtn.addEventListener("click", () => {
    if (!dbTemplateSelect || !dbTemplateSelect.value) {
      setDbStatus("Select a DB template first.", true);
      return;
    }
    loadDbTemplateById(dbTemplateSelect.value);
  });
}

if (dbSaveBtn) {
  dbSaveBtn.addEventListener("click", () => {
    saveTemplateToDb();
  });
}

if (dbSaveAsBtn) {
  dbSaveAsBtn.addEventListener("click", () => {
    saveTemplateToDbAsNew();
  });
}

if (dbRenameBtn) {
  dbRenameBtn.addEventListener("click", async () => {
    if (!activeDbTemplateId) {
      setDbStatus("Load a DB template before renaming.", true);
      return;
    }
    const currentName = template && template.name ? template.name : "Untitled Template";
    const requestedName = prompt("Rename DB template to:", currentName);
    if (requestedName == null) return;
    const nextName = requestedName.trim();
    if (!nextName) {
      setDbStatus("Template name cannot be empty.", true);
      return;
    }
    try {
      const updated = await patchDbTemplateMetadata({ name: nextName }, `Renamed template to: ${nextName}`);
      template.name = updated.name;
      render();
    } catch (err) {
      setDbStatus(`Rename failed: ${err.message}`, true);
    }
  });
}

if (dbArchiveBtn) {
  dbArchiveBtn.addEventListener("click", async () => {
    if (!activeDbTemplateId) {
      setDbStatus("Load a DB template before archiving.", true);
      return;
    }
    if (!confirm("Archive this DB template?")) return;
    try {
      await patchDbTemplateMetadata({ status: "ARCHIVED" }, "Template archived.");
    } catch (err) {
      setDbStatus(`Archive failed: ${err.message}`, true);
    }
  });
}

if (dbStatusSelect) {
  dbStatusSelect.addEventListener("change", async () => {
    if (!activeDbTemplateId) {
      dbStatusSelect.value = "DRAFT";
      return;
    }
    const nextStatus = String(dbStatusSelect.value || "DRAFT").toUpperCase();
    try {
      await patchDbTemplateMetadata({ status: nextStatus }, `Status updated: ${nextStatus.toLowerCase()}`);
    } catch (err) {
      setDbStatus(`Status update failed: ${err.message}`, true);
      syncDbStatusSelect();
    }
  });
}

if (pagePrevBtn) {
  pagePrevBtn.addEventListener("click", () => setPreviewPage(previewPageIndex - 1));
}

if (pageNextBtn) {
  pageNextBtn.addEventListener("click", () => setPreviewPage(previewPageIndex + 1));
}

populateStarterTemplates();
renderDbTemplateSelect();
setTemplate(createBlankTemplate("Untitled Template"));
previewBtn.textContent = `Preview Data: ${previewMode ? "On" : "Off"}`;
refreshDbTemplates({ silent: true });
syncDbStatusSelect();
try {
  setLeftMode(window.localStorage.getItem("smartdocs.leftMode") || "design");
} catch (_err) {
  setLeftMode("design");
}

previewPdfBtn.addEventListener("click", async () => {
  const evaluation = evaluateDataContractLocal(data || {});
  if (evaluation.missingRequired && evaluation.missingRequired.length) {
    alert(`Cannot render PDF. Missing required fields: ${evaluation.missingRequired.join(", ")}`);
    return;
  }
  previewPdfBtn.disabled = true;
  previewPdfBtn.textContent = "Rendering...";
  try {
    const res = await fetch("/api/render-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, data })
    });
    if (!res.ok) {
      let msg = "PDF render failed";
      try {
        const payload = await res.json();
        if (payload && payload.missingRequired && payload.missingRequired.length) {
          msg = `Missing required fields: ${payload.missingRequired.join(", ")}`;
        } else if (payload && payload.error) {
          msg = payload.error;
        }
      } catch (_err) {
        // ignore parse error
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  } catch (e) {
    // eslint-disable-next-line no-alert
    alert(e && e.message ? e.message : "PDF render failed");
  } finally {
    previewPdfBtn.disabled = false;
    previewPdfBtn.textContent = "Preview PDF";
  }
});

if (textToolbar) {
  textToolbar.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
  });
  textToolbar.querySelectorAll("button[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!editingText) return;
      const cmd = btn.dataset.cmd;
      document.execCommand(cmd, false);
      editingText.el.text = editingText.el.richText ? editingText.div.innerHTML : editingText.div.innerText;
    });
  });
}

if (toolbarFont) {
  toolbarFont.addEventListener("change", () => {
    if (!editingText || !editingText.el.richText) return;
    const font = toolbarFont.value;
    if (!font) return;
    applyInlineStyle({ fontFamily: font });
  });
}

if (toolbarSize) {
  toolbarSize.addEventListener("change", () => {
    if (!editingText || !editingText.el.richText) return;
    const size = Number(toolbarSize.value);
    if (!size) return;
    applyInlineStyle({ fontSize: `${size}pt` });
  });
}

if (toolbarColor) {
  toolbarColor.addEventListener("change", () => {
    if (!editingText || !editingText.el.richText) return;
    const color = toolbarColor.value;
    applyInlineStyle({ color });
  });
}

canvas.addEventListener("click", (ev) => {
  if (!placingType || !template) return;
  let el;
  if (placingType.startsWith("include:")) {
    const ref = placingType.split("include:")[1];
    el = createIncludeElement(ref);
  } else {
    el = createDefaultElement(placingType);
  }
  const placement = computePlacement(ev, el);
  if (!placement) return;
  el.region = placement.region;
  el.x = placement.x;
  el.y = placement.y;
  const list = getElements();
  list.push(el);
  setElements(list);
  selectedId = el.id;
  clearPlacing();
  render();
});

window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && placingType) {
    clearPlacing();
    render();
  }
  if (ev.key === "Delete" || ev.key === "Backspace") {
    if (editingText) return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.closest && active.closest('[contenteditable="true"]'))) {
      return;
    }
    if (!selectedId) return;
    if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    const list = getElements();
    const next = list.filter((el) => el.id !== selectedId);
    if (next.length !== list.length) {
      setElements(next);
      selectedId = null;
      render();
    }
  }
});

function renderPartialsList() {
  if (!template) return;
  partialsList.innerHTML = "";
  const names = Object.keys(template.partials || {});
  if (!names.length) {
    const empty = document.createElement("div");
    empty.textContent = "No partials yet.";
    empty.style.fontSize = "12px";
    partialsList.appendChild(empty);
    return;
  }

  names.forEach((name) => {
    const row = document.createElement("div");
    row.className = "partial-item";

    const label = document.createElement("div");
    label.className = "partial-name";
    label.textContent = name;
    row.appendChild(label);

    const editBtn = document.createElement("button");
    editBtn.textContent = editingPartial === name ? "Back" : "Edit";
    editBtn.addEventListener("click", () => {
      editingPartial = editingPartial === name ? null : name;
      if (editingPartial && previewMode) {
        previewMode = false;
        previewBtn.textContent = "Preview Data: Off";
      }
      selectedId = null;
      render();
      renderPartialsList();
    });
    row.appendChild(editBtn);

    const insertBtn = document.createElement("button");
    insertBtn.textContent = "Insert";
    insertBtn.addEventListener("click", () => {
      setPlacing(`include:${name}`);
    });
    row.appendChild(insertBtn);

    partialsList.appendChild(row);
  });
}

newPartialBtn.addEventListener("click", () => {
  if (!template) return;
  const name = prompt("Partial name?");
  if (!name) return;
  if (template.partials[name]) {
    alert("Partial already exists.");
    return;
  }
  template.partials[name] = { elements: [] };
  editingPartial = name;
  if (previewMode) {
    previewMode = false;
    previewBtn.textContent = "Preview Data: Off";
  }
  selectedId = null;
  render();
  renderPartialsList();
});

const originalRender = render;
render = function renderWithPartials() {
  originalRender();
  renderPartialsList();
  updateTemplateDirtyState();
  syncDbStatusSelect();
  syncQuickActions();
};
