// ── Session bootstrap: redirect to login if not authenticated ──
window.__user = null;
(async function checkSession() {
  try {
    const resp = await fetch("/api/auth/me");
    if (resp.ok) {
      const data = await resp.json();
      window.__user = data.user;
      // Populate user bar
      const userBar = document.getElementById("user-bar");
      const nameDisplay = document.getElementById("user-name-display");
      const roleBadge = document.getElementById("user-role-badge");
      const avatarEl = document.getElementById("user-avatar-initials");
      const logoutBtn = document.getElementById("btn-logout");
      if (userBar && window.__user) {
        nameDisplay.textContent = window.__user.name;
        roleBadge.textContent = window.__user.role;
        roleBadge.className = "user-role-badge role-" + (window.__user.role || "author").toLowerCase();
        // Generate initials
        if (avatarEl) {
          const parts = (window.__user.name || "U").split(" ");
          const initials = parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
          avatarEl.textContent = initials;
        }
        userBar.style.display = "flex";
        if (logoutBtn) {
          logoutBtn.addEventListener("click", async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/editor/login.html";
          });
        }
        // Show settings gear for ADMIN users
        if (window.__user.role === "ADMIN") {
          const settingsBtn = document.getElementById("btn-settings");
          const settingsOverlay = document.getElementById("settings-overlay");
          if (settingsBtn && settingsOverlay) {
            settingsBtn.style.display = "";
            settingsBtn.addEventListener("click", () => {
              settingsOverlay.classList.remove("hidden");
              loadAdminUsers();
            });
            setupAdminInvite();
          }
        }
      }
    } else {
      // Not authenticated — redirect to login (unless on login/invite/register page)
      if (!window.location.pathname.includes("login") && !window.location.pathname.includes("invite") && !window.location.pathname.includes("register")) {
        window.location.href = "/editor/login.html";
        return;
      }
    }
  } catch (_) {
    // DB not available or server error — allow access (local dev without DB)
  }
})();

const canvas = document.getElementById("canvas");
const props = document.getElementById("props");
const addButtons = document.querySelectorAll("[data-add]");
const modeButtons = document.querySelectorAll(".mode-btn[data-mode]");
const workflowStepButtons = document.querySelectorAll(".workflow-step[data-workflow-step]");
const workflowHelp = document.getElementById("workflow-help");
const modeSections = document.querySelectorAll("[data-mode-section]");
const quickProxyButtons = document.querySelectorAll("[data-proxy-click]");
const actionNewBtn = document.getElementById("btn-action-new");
const actionCheckBtn = document.getElementById("btn-action-check");
const actionSaveBtn = document.getElementById("btn-action-save");
const actionPreviewPdfBtn = document.getElementById("btn-action-preview-pdf");
const undoBtn = document.getElementById("btn-undo");
const redoBtn = document.getElementById("btn-redo");
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
const workflowPanel = document.getElementById("workflow-panel");
const workflowBadge = document.getElementById("workflow-status-badge");
const workflowActions = document.getElementById("workflow-actions");
const workflowRejection = document.getElementById("workflow-rejection");
const workflowRejectionReason = document.getElementById("workflow-rejection-reason");
const workflowRejectConfirm = document.getElementById("workflow-reject-confirm");
const workflowLockMsg = document.getElementById("workflow-lock-msg");
const templateState = document.getElementById("template-state");
const dbStatus = document.getElementById("db-status");
const pagePrevBtn = document.getElementById("btn-page-prev");
const pageNextBtn = document.getElementById("btn-page-next");
const pageAddBtn = document.getElementById("btn-page-add");
const pageDeleteBtn = document.getElementById("btn-page-delete");
const pageIndicator = document.getElementById("page-indicator");
const textToolbar = document.getElementById("text-toolbar");
const toolbarStatus = document.getElementById("toolbar-status");
const toolbarFont = document.getElementById("toolbar-font");
const toolbarSize = document.getElementById("toolbar-size");
const toolbarColor = document.getElementById("toolbar-color");
const dataStatus = document.getElementById("data-status");
const snapEnabledInput = document.getElementById("snap-enabled");
const showBoundsInput = document.getElementById("show-bounds");
const alignLeftBtn = document.getElementById("btn-align-left");
const alignCenterBtn = document.getElementById("btn-align-center");
const alignRightBtn = document.getElementById("btn-align-right");
const alignTopBtn = document.getElementById("btn-align-top");
const alignMiddleBtn = document.getElementById("btn-align-middle");
const alignBottomBtn = document.getElementById("btn-align-bottom");
const distributeHBtn = document.getElementById("btn-distribute-h");
const distributeVBtn = document.getElementById("btn-distribute-v");

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
let activeWorkflowStep = "design";
let selectedIds = [];
let snapEnabled = true;
let showComponentBounds = true;
let activeGuides = { x: null, y: null, region: "body" };
let dragPaletteType = null;
let dropPreview = null;

const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;
let lastUndoSnapshot = "";

function pushUndo() {
  if (!template) return;
  const snap = JSON.stringify(template);
  if (snap === lastUndoSnapshot) return;
  undoStack.push(lastUndoSnapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  lastUndoSnapshot = snap;
}

function performUndo() {
  if (!undoStack.length || !template) return;
  const current = JSON.stringify(template);
  redoStack.push(current);
  const prev = undoStack.pop();
  if (!prev) return;
  lastUndoSnapshot = prev;
  try {
    const restored = JSON.parse(prev);
    template.elements = restored.elements || [];
    template.partials = restored.partials || {};
    template.pageCount = restored.pageCount;
    template.page = restored.page;
    template.dataContract = restored.dataContract;
    render();
  } catch (_err) {
    // ignore parse errors
  }
}

function performRedo() {
  if (!redoStack.length || !template) return;
  const current = JSON.stringify(template);
  undoStack.push(current);
  const next = redoStack.pop();
  if (!next) return;
  lastUndoSnapshot = next;
  try {
    const restored = JSON.parse(next);
    template.elements = restored.elements || [];
    template.partials = restored.partials || {};
    template.pageCount = restored.pageCount;
    template.page = restored.page;
    template.dataContract = restored.dataContract;
    render();
  } catch (_err) {
    // ignore parse errors
  }
}

const STARTER_TEMPLATES = [
  { label: "Invoice Starter", path: "/examples/template.json" },
  { label: "Credit Card Statement", path: "/examples/cc-template.json" },
  { label: "Bank Statement", path: "/examples/bank-statement-template.json" },
  { label: "Terms & Conditions", path: "/examples/terms-template.json" },
  { label: "Image + Text Showcase", path: "/examples/showcase-image-text-template.json" },
  { label: "Enterprise Program Update (2-Page)", path: "/examples/enterprise-program-update-template.json" },
  { label: "Enterprise Cover Package", path: "/examples/enterprise-cover-template.json" },
  { label: "Quarterly Report (All Components)", path: "/examples/showcase-all-template.json" },
  { label: "Conference Event Pass (QR Codes)", path: "/examples/event-pass-template.json" }
];

const WORKFLOW_HELP = {
  design: "Drag components onto the page and arrange your layout.",
  data: "Load sample data and connect merge fields.",
  test: "Turn preview on, run checks, and verify pagination/output.",
  publish: "Save versions, set status, and prepare for release."
};

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
  syncCanvasDecorations();
  syncWorkflowFromState();
}

function inferWorkflowStepFromState() {
  if (activeLeftMode === "design") return "design";
  if (activeLeftMode === "data") return previewMode ? "test" : "data";
  return "publish";
}

function setWorkflowStep(step, options = {}) {
  const next = ["design", "data", "test", "publish"].includes(step) ? step : "design";
  activeWorkflowStep = next;
  workflowStepButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.workflowStep === next);
  });
  if (workflowHelp) workflowHelp.textContent = WORKFLOW_HELP[next] || "";

  if (options.applyMode === false) return;
  if (next === "design") {
    setLeftMode("design");
    return;
  }
  if (next === "data") {
    if (previewMode) {
      previewMode = false;
      if (previewBtn) previewBtn.textContent = "Hide Live Data";
    }
    setLeftMode("data");
    render();
    return;
  }
  if (next === "test") {
    if (!previewMode) {
      previewMode = true;
      if (previewBtn) previewBtn.textContent = "Show Live Data";
    }
    setLeftMode("data");
    render();
    return;
  }
  setLeftMode("manage");
}

function syncWorkflowFromState() {
  const inferred = inferWorkflowStepFromState();
  if (inferred === activeWorkflowStep && workflowHelp && workflowHelp.textContent) return;
  setWorkflowStep(inferred, { applyMode: false });
}

function syncCanvasDecorations() {
  const show = showComponentBounds && activeLeftMode === "design";
  canvas.classList.toggle("show-component-bounds", show);
}

function syncQuickActions() {
  quickProxyButtons.forEach((proxyBtn) => {
    const targetId = proxyBtn.dataset.proxyClick;
    const target = targetId ? document.getElementById(targetId) : null;
    proxyBtn.disabled = !target || target.disabled;
  });
}

function syncPrimaryActions() {
  const hasTemplate = Boolean(template);
  if (actionSaveBtn) actionSaveBtn.disabled = !hasTemplate;
  if (actionCheckBtn) actionCheckBtn.disabled = !hasTemplate;
  if (actionPreviewPdfBtn) actionPreviewPdfBtn.disabled = !hasTemplate;
}

function syncArrangeActions() {
  const count = getSelectedElements().length;
  const hasSelection = count > 0;
  [alignLeftBtn, alignCenterBtn, alignRightBtn, alignTopBtn, alignMiddleBtn, alignBottomBtn]
    .filter(Boolean)
    .forEach((btn) => {
      btn.disabled = !hasSelection;
    });
  if (distributeHBtn) distributeHBtn.disabled = count < 3;
  if (distributeVBtn) distributeVBtn.disabled = count < 3;
}

function clearSelection() {
  selectedId = null;
  selectedIds = [];
}

function isSelected(id) {
  return selectedIds.includes(id);
}

function setSingleSelection(id) {
  selectedId = id || null;
  selectedIds = id ? [id] : [];
}

function toggleSelection(id) {
  if (isSelected(id)) {
    selectedIds = selectedIds.filter((item) => item !== id);
    selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
    return;
  }
  selectedIds.push(id);
  selectedId = id;
}

function getSelectedElements() {
  const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
  const list = getElements();
  return ids.map((id) => list.find((el) => el.id === id)).filter(Boolean);
}

function clearVisualHelpers() {
  activeGuides = { x: null, y: null, region: "body" };
  dropPreview = null;
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

const WF_BADGE_CLASSES = { DRAFT: "wf-draft", REVIEW: "wf-review", APPROVED: "wf-approved", PUBLISHED: "wf-published", ARCHIVED: "wf-archived" };
const WF_LOCKED_STATUSES = new Set(["APPROVED", "PUBLISHED"]);

function syncDbStatusSelect() {
  syncWorkflowPanel();
}

let currentApprovalData = null;

async function syncWorkflowPanel() {
  if (!workflowPanel) return;
  const status = (activeDbTemplateStatus || "DRAFT").toUpperCase();
  const hasTemplate = Boolean(activeDbTemplateId);

  workflowPanel.classList.toggle("hidden", !hasTemplate);
  if (!hasTemplate) return;

  // Badge
  if (workflowBadge) {
    workflowBadge.textContent = status;
    workflowBadge.className = "wf-badge " + (WF_BADGE_CLASSES[status] || "wf-draft");
  }

  // Lock
  const locked = WF_LOCKED_STATUSES.has(status);
  if (workflowLockMsg) workflowLockMsg.classList.toggle("hidden", !locked);
  if (dbSaveBtn) dbSaveBtn.disabled = locked;

  // Hide all sub-forms
  const submitForm = document.getElementById("workflow-submit-form");
  const approveForm = document.getElementById("workflow-approve-form");
  if (submitForm) submitForm.classList.add("hidden");
  if (approveForm) approveForm.classList.add("hidden");
  if (workflowRejection) workflowRejection.classList.add("hidden");
  if (workflowActions) workflowActions.innerHTML = "";

  // Fetch approval status
  currentApprovalData = null;
  try {
    const resp = await fetch(`/api/templates/${activeDbTemplateId}/approval`);
    if (resp.ok) currentApprovalData = await resp.json();
  } catch (_) {}

  // Render approval stepper
  renderApprovalStepper();

  // Render actions based on status
  const userId = window.__user ? window.__user.id : null;

  if (status === "DRAFT") {
    // Show "Submit for Review" button → opens chain picker
    const btn = document.createElement("button");
    btn.className = "wf-btn wf-btn-primary";
    btn.textContent = "Submit for Review";
    btn.addEventListener("click", () => showSubmitForm());
    workflowActions.appendChild(btn);
  } else if (status === "REVIEW" && currentApprovalData && currentApprovalData.request) {
    // Check if current user is the assigned approver
    const pendingStep = (currentApprovalData.steps || []).find((s) => s.status === "PENDING");
    if (pendingStep && pendingStep.assignee && pendingStep.assignee.id === userId) {
      if (approveForm) approveForm.classList.remove("hidden");
    } else if (pendingStep) {
      const waitMsg = document.createElement("div");
      waitMsg.style.cssText = "font-size:11px;color:#7a6f5f;padding:4px 0;";
      waitMsg.textContent = `Waiting for ${pendingStep.assignee ? pendingStep.assignee.name : "approver"} to review (Step ${pendingStep.levelOrder})`;
      workflowActions.appendChild(waitMsg);
    }
  } else if (status === "PUBLISHED") {
    const btn = document.createElement("button");
    btn.className = "wf-btn";
    btn.textContent = "New Revision";
    btn.addEventListener("click", () => executeWorkflowTransition("DRAFT", null));
    workflowActions.appendChild(btn);
  } else if (status === "ARCHIVED") {
    const btn = document.createElement("button");
    btn.className = "wf-btn";
    btn.textContent = "Reactivate";
    btn.addEventListener("click", () => executeWorkflowTransition("DRAFT", null));
    workflowActions.appendChild(btn);
  }
}

function renderApprovalStepper() {
  const stepper = document.getElementById("approval-stepper");
  if (!stepper) return;
  stepper.innerHTML = "";

  if (!currentApprovalData || !currentApprovalData.request) return;

  const { chainLevels, steps, status } = currentApprovalData;

  chainLevels.forEach((level, idx) => {
    if (idx > 0) {
      const connector = document.createElement("div");
      connector.className = "approval-step-connector";
      stepper.appendChild(connector);
    }

    const step = steps.find((s) => s.levelOrder === level.levelOrder);
    let stepClass = "step-pending";
    let iconText = level.levelOrder;
    if (step) {
      if (step.status === "APPROVED") { stepClass = "step-approved"; iconText = "✓"; }
      else if (step.status === "REJECTED") { stepClass = "step-rejected"; iconText = "✗"; }
      else if (step.status === "PENDING") { stepClass = "step-current"; }
    }

    const el = document.createElement("div");
    el.className = `approval-step ${stepClass}`;

    const icon = document.createElement("div");
    icon.className = "approval-step-icon";
    icon.textContent = iconText;

    const labelDiv = document.createElement("div");
    labelDiv.className = "approval-step-label";
    labelDiv.innerHTML = `<b>${level.label}</b>`;

    const assignee = document.createElement("div");
    assignee.className = "approval-step-assignee";
    if (step && step.assignee) {
      if (step.status === "APPROVED") assignee.textContent = `${step.assignee.name} approved`;
      else if (step.status === "REJECTED") assignee.textContent = `${step.assignee.name} rejected${step.comment ? ": " + step.comment : ""}`;
      else assignee.textContent = `Assigned: ${step.assignee.name}`;
    } else {
      assignee.textContent = level.requiredRole;
    }

    el.appendChild(icon);
    const textWrap = document.createElement("div");
    textWrap.style.flex = "1";
    textWrap.appendChild(labelDiv);
    textWrap.appendChild(assignee);
    el.appendChild(textWrap);
    stepper.appendChild(el);
  });
}

async function showSubmitForm() {
  const submitForm = document.getElementById("workflow-submit-form");
  const chainSelect = document.getElementById("workflow-chain-select");
  if (!submitForm || !chainSelect) return;

  // Load chains for the template's project
  chainSelect.innerHTML = '<option value="">Loading chains...</option>';
  submitForm.classList.remove("hidden");

  try {
    // Get template to find projectId
    const tplResp = await fetch(`/api/templates/${activeDbTemplateId}`);
    if (!tplResp.ok) return;
    const { template: tpl } = await tplResp.json();
    if (!tpl.projectId) {
      chainSelect.innerHTML = '<option value="">Assign template to a project first</option>';
      return;
    }
    const chainsResp = await fetch(`/api/projects/${tpl.projectId}/approval-chains`);
    if (!chainsResp.ok) return;
    const { chains } = await chainsResp.json();
    chainSelect.innerHTML = "";
    if (chains.length === 0) {
      chainSelect.innerHTML = '<option value="">No approval chains configured</option>';
      return;
    }
    chains.filter((c) => c.active).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.levels.length} steps)`;
      chainSelect.appendChild(opt);
    });
  } catch (_) {
    chainSelect.innerHTML = '<option value="">Error loading chains</option>';
  }
}

async function executeWorkflowTransition(toStatus, reason) {
  if (!activeDbTemplateId) return;
  try {
    const resp = await fetch(`/api/templates/${activeDbTemplateId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: toStatus, reason: reason || undefined, actorId: window.__user ? window.__user.id : "editor" })
    });
    const result = await resp.json();
    if (!resp.ok) {
      alert(result.error || "Transition failed");
      return;
    }
    activeDbTemplateStatus = result.template.status || toStatus;
    syncWorkflowPanel();
    updateTemplateStateLabel();
    render();
  } catch (err) {
    alert("Transition failed: " + err.message);
  }
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
    pageCount: 1,
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
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Open a sample template\u2026";
  placeholder.disabled = true;
  placeholder.selected = true;
  starterTemplateSelect.appendChild(placeholder);
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
  if (isTemplateLocked()) {
    setDbStatus("Template is locked. Create a new revision to edit.", true);
    return;
  }
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

function runQuickTemplateCheck(options = {}) {
  if (!template) return false;
  syncDataContractBindings();
  contractDiagnostics = evaluateDataContractLocal(data || {});
  const issues = summarizeContractDiagnostics(contractDiagnostics);
  const missingBindings = findMissingBindings();
  const messages = [];
  if (issues.missingRequired.length) {
    messages.push(`Required data missing: ${issues.missingRequired.join(", ")}`);
  }
  if (issues.errors.length) {
    messages.push(`Transform issues: ${issues.errors.join(" | ")}`);
  }
  if (missingBindings.length) {
    messages.push(`Unresolved merge fields in current sample data: ${missingBindings.join(", ")}`);
  }
  const passed = messages.length === 0;
  setDbStatus(
    passed
      ? "Template check passed: no required data or transform issues."
      : `Template check found ${messages.length} issue${messages.length === 1 ? "" : "s"}.`,
    !passed
  );
  if (options.showAlert !== false) {
    if (passed) {
      alert("Template check passed.\nNo required data, transform, or binding issues found.");
    } else {
      alert(`Template check found issues:\n\n- ${messages.join("\n- ")}`);
    }
  }
  render();
  return passed;
}

function setTemplate(next, options = {}) {
  template = next;
  undoStack.length = 0;
  redoStack.length = 0;
  lastUndoSnapshot = JSON.stringify(next);
  const maxElementPage = (template.elements || []).reduce((max, el) => {
    const p = Number(el.page);
    if (!Number.isFinite(p) || p < 1) return max;
    return Math.max(max, Math.floor(p));
  }, 1);
  if (!template.pageCount || Number(template.pageCount) < 1) {
    template.pageCount = maxElementPage;
  } else {
    template.pageCount = Math.max(maxElementPage, Math.floor(Number(template.pageCount) || 1));
  }
  if (!options.keepDbContext) {
    activeDbTemplateId = null;
    activeDbTemplateStatus = "DRAFT";
    if (dbTemplateSelect) dbTemplateSelect.value = "";
  }
  if (!template.partials) template.partials = {};
  syncDataContractBindings();
  editingPartial = null;
  clearSelection();
  clearVisualHelpers();
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
    previewBtn.textContent = "Hide Live Data";
  }
  const defaultText = (template && template.styles && template.styles.defaultText) || {};
  const mergedStyle = { ...defaultText, ...(el.style || {}) };
  const minLinePt = mergedStyle.lineHeight || ((mergedStyle.size || 11) * 1.2);
  const minContentPt = Math.max(8, Math.ceil(minLinePt + 4));
  const measureContentHeightPt = () => {
    const probe = div.cloneNode(true);
    probe.querySelectorAll(".resize-handle").forEach((node) => node.remove());
    probe.classList.remove("selected", "multi-selected", "editing");
    probe.contentEditable = "false";
    probe.style.position = "absolute";
    probe.style.left = "-100000px";
    probe.style.top = "-100000px";
    probe.style.height = "auto";
    probe.style.minHeight = "0";
    probe.style.maxHeight = "none";
    probe.style.overflow = "visible";
    probe.style.pointerEvents = "none";
    document.body.appendChild(probe);
    const px = Math.ceil(probe.scrollHeight + 2);
    probe.remove();
    return pxToPt(px);
  };
  const autoGrowIfNeeded = () => {
    if (!editingText || editingText.el.id !== el.id) return;
    if (el.type !== "text") return;
    const bounds = getRegionBounds(el.region || "body");
    const maxH = Math.max(6, bounds.h - (el.y || 0));
    const neededPt = Math.ceil(measureContentHeightPt());
    const nextH = clamp(neededPt, minContentPt, maxH);
    el.h = nextH;
    div.style.height = `${ptToPx(nextH)}px`;
  };
  const prevOverflow = div.style.overflow || "";
  div.contentEditable = "true";
  div.classList.add("editing");
  div.style.overflow = "hidden";
  div.focus();
  editingText = { el, div };
  const onInput = () => {
    el.text = el.richText ? div.innerHTML : div.innerText;
    autoGrowIfNeeded();
  };
  div.addEventListener("input", onInput);
  autoGrowIfNeeded();
  showToolbar();
  const onBlur = () => {
    div.removeEventListener("input", onInput);
    div.contentEditable = "false";
    div.classList.remove("editing");
    div.style.overflow = prevOverflow;
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
  if (type === "barcode") return { ...base, w: 180, h: 50, value: "{{barcode.value}}", format: "code128" };
  if (type === "link") return { ...base, w: 140, h: 20, text: "Click here", url: "https://example.com" };
  if (type === "pageBreak") return { ...base, w: 400, h: 4, region: "body" };
  if (type === "chart") return { ...base, w: 250, h: 180, chartType: "bar", dataSource: "{{chartData}}", labelField: "label", valueField: "value", title: "Chart", colors: ["#b33a2b", "#2b6cb3", "#3c8f3a", "#d4a017", "#7b3cb3"] };
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

function isTemplateLocked() {
  return Boolean(activeDbTemplateId && WF_LOCKED_STATUSES.has((activeDbTemplateStatus || "").toUpperCase()));
}

function setPlacing(type) {
  if (type && isTemplateLocked()) return;
  placingType = type;
  addButtons.forEach((btn) => {
    const isActive = btn.dataset.add === type;
    btn.classList.toggle("active", isActive);
  });
  canvas.classList.toggle("placing", Boolean(type));
  if (type) {
    clearSelection();
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

function getRegionOrigin(region) {
  const { margin, headerH, bodyH } = getPageMetrics();
  const left = margin.left;
  if (region === "header") return { left, top: margin.top };
  if (region === "footer") return { left, top: margin.top + headerH + bodyH };
  return { left, top: margin.top + headerH };
}

function getSnapTargets(el, region) {
  const bounds = getRegionBounds(region);
  const targetsX = [0, bounds.w / 2, bounds.w];
  const targetsY = [0, bounds.h / 2, bounds.h];
  getElements()
    .filter((other) => other.id !== el.id)
    .filter((other) => (other.region || "body") === region)
    .forEach((other) => {
      const left = other.x || 0;
      const right = (other.x || 0) + (other.w || 0);
      const midX = left + (other.w || 0) / 2;
      const top = other.y || 0;
      const bottom = (other.y || 0) + (other.h || 0);
      const midY = top + (other.h || 0) / 2;
      targetsX.push(left, midX, right);
      targetsY.push(top, midY, bottom);
    });
  return { targetsX, targetsY };
}

function findSnapOffset(points, targets, tolerance) {
  let winner = null;
  points.forEach((point) => {
    targets.forEach((target) => {
      const delta = target - point.value;
      const distance = Math.abs(delta);
      if (distance > tolerance) return;
      if (!winner || distance < winner.distance) {
        winner = { distance, delta, target, anchor: point.anchor };
      }
    });
  });
  return winner;
}

function snapMovePosition(el, draftX, draftY, region) {
  if (!snapEnabled) return { x: draftX, y: draftY, guides: { x: null, y: null, region } };
  const tolerance = 3;
  const { targetsX, targetsY } = getSnapTargets(el, region);
  const pointsX = [
    { anchor: "left", value: draftX },
    { anchor: "center", value: draftX + (el.w || 0) / 2 },
    { anchor: "right", value: draftX + (el.w || 0) }
  ];
  const pointsY = [
    { anchor: "top", value: draftY },
    { anchor: "middle", value: draftY + (el.h || 0) / 2 },
    { anchor: "bottom", value: draftY + (el.h || 0) }
  ];
  const snapX = findSnapOffset(pointsX, targetsX, tolerance);
  const snapY = findSnapOffset(pointsY, targetsY, tolerance);
  return {
    x: draftX + (snapX ? snapX.delta : 0),
    y: draftY + (snapY ? snapY.delta : 0),
    guides: {
      x: snapX ? snapX.target : null,
      y: snapY ? snapY.target : null,
      region
    }
  };
}

function alignSelection(mode) {
  const selected = getSelectedElements();
  if (!selected.length) return;
  const region = (selected[0].region || "body");
  const bounds = getRegionBounds(region);
  if (selected.some((el) => (el.region || "body") !== region)) {
    alert("Align only works when all selected elements are in the same region.");
    return;
  }
  const anchor = selected[0];
  selected.forEach((el, idx) => {
    if (idx === 0 && selected.length > 1) return;
    if (mode === "left") el.x = anchor.x;
    if (mode === "center") el.x = anchor.x + (anchor.w - el.w) / 2;
    if (mode === "right") el.x = anchor.x + anchor.w - el.w;
    if (mode === "top") el.y = anchor.y;
    if (mode === "middle") el.y = anchor.y + (anchor.h - el.h) / 2;
    if (mode === "bottom") el.y = anchor.y + anchor.h - el.h;

    if (selected.length === 1) {
      if (mode === "left") el.x = 0;
      if (mode === "center") el.x = (bounds.w - el.w) / 2;
      if (mode === "right") el.x = bounds.w - el.w;
      if (mode === "top") el.y = 0;
      if (mode === "middle") el.y = (bounds.h - el.h) / 2;
      if (mode === "bottom") el.y = bounds.h - el.h;
    }
    el.x = clamp(el.x, 0, Math.max(0, bounds.w - el.w));
    el.y = clamp(el.y, 0, Math.max(0, bounds.h - el.h));
  });
  render();
}

function distributeSelection(axis) {
  const selected = getSelectedElements();
  if (selected.length < 3) {
    alert("Select at least 3 elements to distribute.");
    return;
  }
  const region = (selected[0].region || "body");
  if (selected.some((el) => (el.region || "body") !== region)) {
    alert("Distribute only works when all selected elements are in the same region.");
    return;
  }
  const sorted = selected.slice().sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (axis === "x") {
    const totalWidth = sorted.reduce((sum, el) => sum + (el.w || 0), 0);
    const free = (last.x + last.w) - first.x - totalWidth;
    const gap = free / (sorted.length - 1);
    let cursor = first.x;
    sorted.forEach((el, idx) => {
      if (idx === 0 || idx === sorted.length - 1) {
        cursor = el.x + el.w + gap;
        return;
      }
      el.x = cursor;
      cursor += el.w + gap;
    });
  } else {
    const totalHeight = sorted.reduce((sum, el) => sum + (el.h || 0), 0);
    const free = (last.y + last.h) - first.y - totalHeight;
    const gap = free / (sorted.length - 1);
    let cursor = first.y;
    sorted.forEach((el, idx) => {
      if (idx === 0 || idx === sorted.length - 1) {
        cursor = el.y + el.h + gap;
        return;
      }
      el.y = cursor;
      cursor += el.h + gap;
    });
  }
  render();
}

function getDefaultRepeat(el) {
  return (el.region || "body") === "body" ? "first" : "all";
}

function getManualPageCount() {
  if (!template || editingPartial) return 1;
  return Math.max(1, Math.floor(Number(template.pageCount) || 1));
}

function getExplicitElementPageMax() {
  if (!template) return 1;
  const list = getElements();
  const maxPage = list.reduce((max, el) => {
    const p = Number(el.page);
    if (!Number.isFinite(p) || p < 1) return max;
    return Math.max(max, Math.floor(p));
  }, 1);
  return Math.max(1, maxPage);
}

function shouldRenderInPage(el, pageIndex, pageCount) {
  if (editingPartial) return true;
  const explicitPage = Number(el.page);
  if (Number.isFinite(explicitPage) && explicitPage >= 1) {
    return pageIndex === Math.floor(explicitPage) - 1;
  }
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
  if (pageAddBtn) pageAddBtn.disabled = Boolean(editingPartial);
  if (pageDeleteBtn) pageDeleteBtn.disabled = Boolean(editingPartial) || getManualPageCount() <= 1;
}

function setPreviewPage(nextIndex) {
  const clamped = clamp(nextIndex, 0, Math.max(0, previewPageCount - 1));
  if (clamped === previewPageIndex) return;
  previewPageIndex = clamped;
  render();
}

function addManualPage() {
  if (!template || editingPartial) return;
  template.pageCount = getManualPageCount() + 1;
  previewPageIndex = template.pageCount - 1;
  render();
}

function deleteCurrentManualPage() {
  if (!template || editingPartial) return;
  const count = getManualPageCount();
  if (count <= 1) return;
  const removePage = previewPageIndex + 1;
  const list = getElements();
  list.forEach((el) => {
    const p = Number(el.page);
    if (!Number.isFinite(p) || p < 1) return;
    if (p === removePage) {
      el.page = Math.max(1, removePage - 1);
      return;
    }
    if (p > removePage) {
      el.page = p - 1;
    }
  });
  template.pageCount = count - 1;
  previewPageIndex = clamp(previewPageIndex, 0, template.pageCount - 1);
  render();
}

function getPaletteTypeFromDragEvent(ev) {
  if (!ev || !ev.dataTransfer) return dragPaletteType;
  const direct = ev.dataTransfer.getData("application/x-smartdocs-component");
  if (direct) return direct;
  return dragPaletteType;
}

function updateDropPreviewFromEvent(ev) {
  if (!template) return;
  const type = getPaletteTypeFromDragEvent(ev);
  if (!type) return;
  let element;
  if (type.startsWith("include:")) {
    element = createIncludeElement(type.split("include:")[1]);
  } else {
    element = createDefaultElement(type);
  }
  const placement = computePlacement(ev, element);
  if (!placement) {
    if (dropPreview) {
      dropPreview = null;
      render();
    }
    return;
  }
  const nextPreview = {
    type,
    region: placement.region,
    x: placement.x,
    y: placement.y,
    w: element.w,
    h: element.h
  };
  const changed =
    !dropPreview ||
    dropPreview.type !== nextPreview.type ||
    dropPreview.region !== nextPreview.region ||
    Math.abs(dropPreview.x - nextPreview.x) > 0.1 ||
    Math.abs(dropPreview.y - nextPreview.y) > 0.1;
  dropPreview = nextPreview;
  if (changed) render();
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

  if (selectedIds.length > 1 && isSelected(el.id)) {
    div.classList.add("multi-selected");
  }
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
    div.style.overflow = "hidden";
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
    div.style.background = "#fff";
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "center";
    const value = previewMode ? resolveText(el.value || "", resolvedData || {}, ctx.textCtx || null) : (el.value || "");
    if (value) {
      const qrSize = 21;
      const margin = 2;
      const total = qrSize + margin * 2;
      const pxW = ptToPx(el.w);
      const pxH = ptToPx(el.h);
      const cell = Math.min(pxW, pxH) / total;
      const cnv = document.createElement("canvas");
      cnv.width = pxW;
      cnv.height = pxH;
      cnv.style.width = "100%";
      cnv.style.height = "100%";
      const cx = cnv.getContext("2d");
      cx.fillStyle = "#fff";
      cx.fillRect(0, 0, pxW, pxH);
      cx.fillStyle = "#000";
      const offsetX = (pxW - total * cell) / 2;
      const offsetY = (pxH - total * cell) / 2;
      const fp = [[0,0],[0,qrSize-7],[qrSize-7,0]];
      fp.forEach(([fr,fc]) => {
        for (let r = 0; r <= 6; r++) {
          for (let c = 0; c <= 6; c++) {
            const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            const border = r === 0 || r === 6 || c === 0 || c === 6;
            if (inner || border) {
              cx.fillRect(offsetX + (fc + c + margin) * cell, offsetY + (fr + r + margin) * cell, cell, cell);
            }
          }
        }
      });
      for (let i = 8; i < qrSize - 8; i++) {
        if (i % 2 === 0) {
          cx.fillRect(offsetX + (i + margin) * cell, offsetY + (6 + margin) * cell, cell, cell);
          cx.fillRect(offsetX + (6 + margin) * cell, offsetY + (i + margin) * cell, cell, cell);
        }
      }
      const bytes = [];
      for (let i = 0; i < value.length; i++) bytes.push(value.charCodeAt(i) & 0xff);
      let hash = 0;
      for (const b of bytes) hash = ((hash << 5) - hash + b) | 0;
      for (let r = 9; r < qrSize - 8; r++) {
        for (let c = 9; c < qrSize - 8; c++) {
          const seed = hash ^ (r * 31 + c * 17);
          if ((seed & 3) === 0) {
            cx.fillRect(offsetX + (c + margin) * cell, offsetY + (r + margin) * cell, cell, cell);
          }
        }
      }
      div.appendChild(cnv);
    } else {
      div.textContent = "QR";
      div.style.fontSize = "10px";
      div.style.color = "#999";
      div.style.border = "1px solid #ddd";
    }
  } else if (el.type === "line") {
    div.textContent = "";
  } else if (el.type === "box") {
    div.textContent = "";
  } else if (el.type === "barcode") {
    const value = previewMode ? resolveText(el.value || "", resolvedData || {}, ctx.textCtx || null) : (el.value || "");
    div.style.display = "flex";
    div.style.flexDirection = "column";
    div.style.alignItems = "stretch";
    div.style.background = "#fff";
    div.style.overflow = "hidden";
    const barsDiv = document.createElement("div");
    barsDiv.style.flex = "1";
    barsDiv.style.width = "100%";
    barsDiv.style.display = "flex";
    barsDiv.style.alignItems = "stretch";
    const text = value || "BARCODE";
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      for (let bit = 7; bit >= 0; bit--) {
        const on = (code >> bit) & 1;
        const bar = document.createElement("div");
        bar.style.flex = "1";
        bar.style.minWidth = "1px";
        bar.style.background = on ? "#000" : "#fff";
        barsDiv.appendChild(bar);
      }
      if (i < text.length - 1) {
        const spacer = document.createElement("div");
        spacer.style.flex = "0.5";
        spacer.style.minWidth = "1px";
        spacer.style.background = "#fff";
        barsDiv.appendChild(spacer);
      }
    }
    div.appendChild(barsDiv);
    const label = document.createElement("div");
    label.style.flexShrink = "0";
    label.style.height = "12px";
    label.style.fontSize = "8px";
    label.style.fontFamily = "monospace";
    label.style.textAlign = "center";
    label.style.lineHeight = "12px";
    label.style.letterSpacing = "0.5px";
    label.style.color = "#333";
    label.textContent = text;
    div.appendChild(label);
  } else if (el.type === "link") {
    const text = previewMode ? resolveText(el.text || "", resolvedData || {}, ctx.textCtx || null) : (el.text || "");
    div.textContent = text;
    div.style.color = (el.style && el.style.color) || "#1a6daf";
    div.style.textDecoration = "underline";
    div.style.cursor = "pointer";
    div.style.overflow = "hidden";
    div.style.display = "flex";
    div.style.alignItems = "center";
    applyStyle(div, el.style, defaultText);
    if (!el.style || !el.style.color) div.style.color = "#1a6daf";
    div.style.textDecoration = "underline";
  } else if (el.type === "pageBreak") {
    div.style.borderTop = "2px dashed #b33a2b";
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "center";
    div.style.fontSize = "9px";
    div.style.color = "#b33a2b";
    div.style.fontWeight = "600";
    div.style.letterSpacing = "0.05em";
    div.textContent = "PAGE BREAK";
  } else if (el.type === "chart") {
    const chartType = el.chartType || "bar";
    const dataPath = (el.dataSource || "").replace(/\{\{|\}\}/g, "").trim();
    const items = previewMode && dataPath ? (resolvePath(resolvedData || {}, dataPath) || []) : [];
    const labels = items.map((item) => String(resolvePath(item, el.labelField || "label") || ""));
    const values = items.map((item) => Number(resolvePath(item, el.valueField || "value") || 0));
    const colors = el.colors || ["#b33a2b", "#2b6cb3", "#3c8f3a", "#d4a017", "#7b3cb3"];
    div.style.overflow = "hidden";
    div.style.background = "#fff";
    div.style.border = "1px solid #e0e0e0";
    if (!items.length) {
      div.style.display = "flex";
      div.style.alignItems = "center";
      div.style.justifyContent = "center";
      div.style.fontSize = "11px";
      div.style.color = "#999";
      div.textContent = `Chart (${chartType})${el.title ? ": " + el.title : ""}`;
    } else {
      const svgNs = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNs, "svg");
      svg.setAttribute("viewBox", `0 0 ${el.w} ${el.h}`);
      svg.style.width = "100%";
      svg.style.height = "100%";
      const maxVal = Math.max(...values, 1);
      const titleH = el.title ? 16 : 0;
      const padTop = 8 + titleH;
      const padBottom = 20;
      const chartW = el.w - 12;
      const chartH = el.h - padTop - padBottom;
      if (el.title) {
        const titleEl = document.createElementNS(svgNs, "text");
        titleEl.setAttribute("x", el.w / 2);
        titleEl.setAttribute("y", 14);
        titleEl.setAttribute("text-anchor", "middle");
        titleEl.setAttribute("font-size", "10");
        titleEl.setAttribute("font-weight", "600");
        titleEl.setAttribute("fill", "#333");
        titleEl.textContent = el.title;
        svg.appendChild(titleEl);
      }
      if (chartType === "bar") {
        const barGap = 4;
        const barW = Math.max(4, (chartW - barGap * (values.length - 1)) / Math.max(1, values.length));
        values.forEach((v, i) => {
          const barH = (v / maxVal) * chartH;
          const rect = document.createElementNS(svgNs, "rect");
          rect.setAttribute("x", 6 + i * (barW + barGap));
          rect.setAttribute("y", padTop + chartH - barH);
          rect.setAttribute("width", barW);
          rect.setAttribute("height", barH);
          rect.setAttribute("fill", colors[i % colors.length]);
          rect.setAttribute("rx", "2");
          svg.appendChild(rect);
          if (labels[i]) {
            const t = document.createElementNS(svgNs, "text");
            t.setAttribute("x", 6 + i * (barW + barGap) + barW / 2);
            t.setAttribute("y", el.h - 4);
            t.setAttribute("text-anchor", "middle");
            t.setAttribute("font-size", "7");
            t.setAttribute("fill", "#555");
            t.textContent = labels[i].slice(0, 8);
            svg.appendChild(t);
          }
        });
      } else if (chartType === "line") {
        const stepX = values.length > 1 ? chartW / (values.length - 1) : chartW;
        const points = values.map((v, i) => `${6 + i * stepX},${padTop + chartH - (v / maxVal) * chartH}`).join(" ");
        const polyline = document.createElementNS(svgNs, "polyline");
        polyline.setAttribute("points", points);
        polyline.setAttribute("fill", "none");
        polyline.setAttribute("stroke", colors[0]);
        polyline.setAttribute("stroke-width", "2");
        svg.appendChild(polyline);
        values.forEach((v, i) => {
          const circle = document.createElementNS(svgNs, "circle");
          circle.setAttribute("cx", 6 + i * stepX);
          circle.setAttribute("cy", padTop + chartH - (v / maxVal) * chartH);
          circle.setAttribute("r", "3");
          circle.setAttribute("fill", colors[0]);
          svg.appendChild(circle);
        });
      } else if (chartType === "pie" || chartType === "doughnut") {
        const cx = el.w / 2;
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
          let d;
          if (innerR > 0) {
            const ix1 = cx + innerR * Math.cos(angle);
            const iy1 = cy + innerR * Math.sin(angle);
            const ix2 = cx + innerR * Math.cos(angle + sweep);
            const iy2 = cy + innerR * Math.sin(angle + sweep);
            d = `M ${ix1} ${iy1} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1} Z`;
          } else {
            d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
          }
          const path = document.createElementNS(svgNs, "path");
          path.setAttribute("d", d);
          path.setAttribute("fill", colors[i % colors.length]);
          svg.appendChild(path);
          angle += sweep;
        });
      }
      div.appendChild(svg);
    }
  } else if (el.type === "include") {
    div.textContent = `Include: ${el.ref}`;
    div.style.border = "1px dashed #999";
  }

  if (el.id === selectedId) {
    addResizeHandles(div, el.id);
  }

  div.addEventListener("pointerdown", (ev) => {
    if (placingType || isTemplateLocked()) {
      ev.stopPropagation();
      return;
    }
    ev.stopPropagation();
    if (div.classList.contains("editing")) return;
    const beforeSelection = `${selectedId || ""}|${selectedIds.join(",")}`;
    if (ev.shiftKey) {
      toggleSelection(el.id);
      render();
      return;
    }
    const wasSingleSelected = selectedId === el.id && selectedIds.length === 1;
    if (!isSelected(el.id)) {
      setSingleSelection(el.id);
    } else if (selectedIds.length > 1 && selectedId !== el.id) {
      selectedId = el.id;
    }
    const movingIds = isSelected(el.id) ? selectedIds.slice() : [el.id];
    const selectionOrigins = movingIds
      .map((id) => {
        const node = getElementById(id);
        if (!node) return null;
        return { id, x: node.x, y: node.y };
      })
      .filter(Boolean);
    dragState = {
      id: el.id,
      startX: ev.clientX,
      startY: ev.clientY,
      originX: el.x,
      originY: el.y,
      region: el.region || "body",
      selectionOrigins,
      mode: "move",
      moved: false,
      inlineEditCandidate:
        !ev.shiftKey &&
        !div.classList.contains("editing") &&
        wasSingleSelected &&
        (el.type === "text" || el.type === "flowText")
    };
    const afterSelection = `${selectedId || ""}|${selectedIds.join(",")}`;
    if (beforeSelection !== afterSelection) {
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
  pushUndo();
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
  const manualCount = getManualPageCount();
  const explicitElementMax = getExplicitElementPageMax();
  const pageCount = Math.max(1, tablePageCount, flowPageCount, manualCount, explicitElementMax);
  previewPageCount = pageCount;
  previewPageIndex = clamp(previewPageIndex, 0, Math.max(0, pageCount - 1));
  const currentPage = previewPageIndex;
  const textCtx = { pageNumber: currentPage + 1, pageCount };

  elements.forEach((el) => {
    if (!shouldRenderInPage(el, currentPage, pageCount)) return;
    const target = el.region === "header" ? header : el.region === "footer" ? footer : body;
    if (pagedTable && el.id === pagedTable.id && tablePreview) {
      const tableRows = tablePreview.pages[currentPage] || [];
      if (!tableRows.length && currentPage >= tablePreview.pages.length) {
        return;
      }
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

  if (activeGuides && (activeGuides.x != null || activeGuides.y != null)) {
    const region = activeGuides.region || "body";
    const origin = getRegionOrigin(region);
    const bounds = getRegionBounds(region);
    if (activeGuides.x != null) {
      const line = document.createElement("div");
      line.className = "snap-guide vertical";
      line.style.left = `${ptToPx(origin.left + activeGuides.x)}px`;
      line.style.top = `${ptToPx(origin.top)}px`;
      line.style.height = `${ptToPx(bounds.h)}px`;
      pageEl.appendChild(line);
    }
    if (activeGuides.y != null) {
      const line = document.createElement("div");
      line.className = "snap-guide horizontal";
      line.style.left = `${ptToPx(origin.left)}px`;
      line.style.top = `${ptToPx(origin.top + activeGuides.y)}px`;
      line.style.width = `${ptToPx(bounds.w)}px`;
      pageEl.appendChild(line);
    }
  }

  if (dropPreview) {
    const origin = getRegionOrigin(dropPreview.region || "body");
    const outline = document.createElement("div");
    outline.className = "drop-preview";
    outline.style.left = `${ptToPx(origin.left + dropPreview.x)}px`;
    outline.style.top = `${ptToPx(origin.top + dropPreview.y)}px`;
    outline.style.width = `${ptToPx(dropPreview.w)}px`;
    outline.style.height = `${ptToPx(dropPreview.h)}px`;
    pageEl.appendChild(outline);
  }

  canvas.appendChild(pageEl);
  updatePageNav();

  const activeEl = document.activeElement;
  const propsHasFocus = activeEl && props.contains(activeEl) && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT");
  if (!propsHasFocus) {
    renderProps();
  }
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

  if (isTemplateLocked()) {
    const lockBanner = document.createElement("div");
    lockBanner.className = "workflow-lock-msg";
    lockBanner.textContent = "Template is locked (" + (activeDbTemplateStatus || "").toLowerCase() + "). Create a new revision to edit.";
    props.appendChild(lockBanner);
  }

  function addRow(label, inputEl) {
    const row = document.createElement("div");
    row.className = "prop-row";
    const lbl = document.createElement("div");
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(inputEl);
    props.appendChild(row);
  }

  function addSectionHeader(text) {
    const hdr = document.createElement("div");
    hdr.className = "prop-section-header";
    hdr.textContent = text;
    props.appendChild(hdr);
  }

  const typeLabels = { flowText: "Long Text", qr: "QR Code", include: "Reusable Block", barcode: "Barcode", link: "Hyperlink", pageBreak: "Page Break", chart: "Chart" };

  addSectionHeader("Identity");

  const idField = document.createElement("input");
  idField.value = el.id;
  idField.disabled = true;
  addRow("ID", idField);

  const typeField = document.createElement("input");
  typeField.value = typeLabels[el.type] || el.type;
  typeField.disabled = true;
  addRow("Type", typeField);

  if (el.type === "include") {
    const refField = document.createElement("input");
    refField.value = el.ref || "";
    refField.addEventListener("input", () => {
      el.ref = refField.value;
      render();
    });
    addRow("Partial Name", refField);
  }

  addSectionHeader("Placement");

  const regionLabels = { body: "Body", header: "Header", footer: "Footer" };
  const regionField = document.createElement("select");
  ["body", "header", "footer"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = regionLabels[opt] || opt;
    if ((el.region || "body") === opt) o.selected = true;
    regionField.appendChild(o);
  });
  regionField.addEventListener("change", () => {
    el.region = regionField.value;
    render();
  });
  addRow("Page Area", regionField);

  const pageField = document.createElement("input");
  pageField.type = "number";
  pageField.min = "1";
  pageField.step = "1";
  pageField.placeholder = "auto";
  pageField.value = el.page != null ? String(el.page) : "";
  pageField.addEventListener("input", () => {
    const val = String(pageField.value || "").trim();
    if (!val) {
      delete el.page;
      render();
      return;
    }
    const num = Math.max(1, Math.floor(Number(val) || 1));
    el.page = num;
    if (!template.pageCount || template.pageCount < num) {
      template.pageCount = num;
    }
    render();
  });
  addRow("page", pageField);

  const repeatField = document.createElement("select");
  const repeatLabels = { "": "Auto", all: "All Pages", first: "First Only", afterFirst: "Pages 2+", middle: "Middle Pages", last: "Last Only" };
  ["", "all", "first", "afterFirst", "middle", "last"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = repeatLabels[opt] || opt;
    const defaultRepeat = (el.region || "body") === "body" ? "first" : "all";
    if (String(el.repeat || defaultRepeat) === opt) o.selected = true;
    repeatField.appendChild(o);
  });
  repeatField.addEventListener("change", () => {
    el.repeat = repeatField.value || undefined;
    render();
  });
  addRow("Show On Pages", repeatField);

  const visibleIfField = document.createElement("input");
  visibleIfField.value = el.visibleIf || "";
  visibleIfField.placeholder = "exists(customer.name) && len(items) > 0";
  visibleIfField.addEventListener("input", () => {
    el.visibleIf = visibleIfField.value.trim() || undefined;
    render();
  });
  addRow("Show When", visibleIfField);

  addSectionHeader("Position");

  const posLabels = { x: "Left", y: "Top", w: "Width", h: "Height" };
  ["x", "y", "w", "h"].forEach((key) => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = el[key];
    input.addEventListener("input", () => {
      el[key] = Number(input.value);
      render();
    });
    addRow(posLabels[key], input);
  });

  if (el.type === "text" || el.type === "flowText") {
    addSectionHeader("Content");

    const t = document.createElement("textarea");
    t.value = el.text || "";
    t.addEventListener("input", () => {
      el.text = t.value;
      render();
    });
    addRow("Text", t);

    if (el.type === "text") {
      const rich = document.createElement("input");
      rich.type = "checkbox";
      rich.checked = Boolean(el.richText);
      rich.addEventListener("change", () => {
        el.richText = rich.checked;
        render();
      });
      addRow("Enable Formatting", rich);
    }

    if (el.type === "flowText") {
      const cols = document.createElement("input");
      cols.type = "number";
      cols.value = el.columns || 1;
      cols.addEventListener("input", () => {
        el.columns = Math.max(1, Number(cols.value) || 1);
        render();
      });
      addRow("Columns", cols);

      const gap = document.createElement("input");
      gap.type = "number";
      gap.value = el.gap || 12;
      gap.addEventListener("input", () => {
        el.gap = Math.max(0, Number(gap.value) || 0);
        render();
      });
      addRow("Column Gap", gap);
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
    addSectionHeader("Style");

    addRow("Font", fontSelect);

    const size = document.createElement("input");
    size.type = "number";
    size.value = (el.style && el.style.size) || "";
    size.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.size = Number(size.value) || undefined;
      render();
    });
    addRow("Size", size);

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
    addRow("Weight", weight);

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
    addRow("Font Style", fontStyle);

    const color = document.createElement("input");
    color.type = "color";
    color.value = (el.style && el.style.color) || "#111111";
    color.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.color = color.value;
      render();
    });
    addRow("Color", color);

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
    addRow("Align", align);

    const lh = document.createElement("input");
    lh.type = "number";
    lh.value = (el.style && el.style.lineHeight) || "";
    lh.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.lineHeight = Number(lh.value) || undefined;
      render();
    });
    addRow("Line Spacing", lh);

    const presetSelect = document.createElement("select");
    const autoPreset = document.createElement("option");
    autoPreset.value = "";
    autoPreset.textContent = "Choose style...";
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
    addRow("Style Preset", presetSelect);
  }

  if (el.type === "image") {
    addSectionHeader("Content");

    const src = document.createElement("input");
    src.value = el.src || "";
    src.addEventListener("input", () => {
      el.src = src.value;
      render();
    });
    addRow("Image URL", src);

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
    addRow("Upload", upload);
  }

  if (el.type === "qr") {
    addSectionHeader("Content");

    const val = document.createElement("input");
    val.value = el.value || "";
    val.addEventListener("input", () => {
      el.value = val.value;
      render();
    });
    addRow("QR Value", val);
  }

  if (el.type === "table") {
    addSectionHeader("Content");

    const rows = document.createElement("input");
    rows.value = el.rows || "";
    rows.addEventListener("input", () => {
      el.rows = rows.value;
      render();
    });
    addRow("Row Source", rows);

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
    addRow("Next Page Top", continuationY);

    const continuationH = document.createElement("input");
    continuationH.type = "number";
    continuationH.value = el.continuationH != null ? el.continuationH : "";
    continuationH.addEventListener("input", () => {
      el.continuationH = continuationH.value === "" ? undefined : Number(continuationH.value);
      render();
    });
    addRow("Next Page Height", continuationH);

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
    addRow("Empty Row Fill", fillMode);
  }

  if (el.type === "box") {
    addSectionHeader("Style");

    const borderColor = document.createElement("input");
    borderColor.type = "color";
    borderColor.value = (el.style && el.style.borderColor) || "#cccccc";
    borderColor.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.borderColor = borderColor.value;
      if (style.borderWidth == null) style.borderWidth = 1;
      render();
    });
    addRow("Border Color", borderColor);

    const borderWidth = document.createElement("input");
    borderWidth.type = "number";
    borderWidth.value = (el.style && el.style.borderWidth) != null ? el.style.borderWidth : 1;
    borderWidth.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.borderWidth = Number(borderWidth.value) || 0;
      render();
    });
    addRow("Border Width", borderWidth);

    const fill = document.createElement("input");
    fill.type = "color";
    fill.value = (el.style && el.style.fill) || "#f9f9f9";
    fill.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.fill = fill.value;
      render();
    });
    addRow("Fill Color", fill);

    const radius = document.createElement("input");
    radius.type = "number";
    radius.value = (el.style && el.style.borderRadius) || 0;
    radius.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.borderRadius = Number(radius.value) || 0;
      render();
    });
    addRow("Corner Radius", radius);
  }

  if (el.type === "barcode") {
    addSectionHeader("Content");

    const val = document.createElement("input");
    val.value = el.value || "";
    val.addEventListener("input", () => {
      el.value = val.value;
      render();
    });
    addRow("Value", val);

    const format = document.createElement("select");
    const formatLabels = { code128: "Code 128", code39: "Code 39", ean13: "EAN-13", ean8: "EAN-8", upc: "UPC-A", itf14: "ITF-14", codabar: "Codabar" };
    ["code128", "code39", "ean13", "ean8", "upc", "itf14", "codabar"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = formatLabels[opt] || opt;
      if ((el.format || "code128") === opt) o.selected = true;
      format.appendChild(o);
    });
    format.addEventListener("change", () => {
      el.format = format.value;
      render();
    });
    addRow("Format", format);
  }

  if (el.type === "link") {
    addSectionHeader("Content");

    const text = document.createElement("input");
    text.value = el.text || "";
    text.addEventListener("input", () => {
      el.text = text.value;
      render();
    });
    addRow("Label", text);

    const url = document.createElement("input");
    url.value = el.url || "";
    url.placeholder = "https://...";
    url.addEventListener("input", () => {
      el.url = url.value;
      render();
    });
    addRow("URL", url);

    addSectionHeader("Style");

    const color = document.createElement("input");
    color.type = "color";
    color.value = (el.style && el.style.color) || "#1a6daf";
    color.addEventListener("input", () => {
      const style = ensureStyle(el);
      style.color = color.value;
      render();
    });
    addRow("Color", color);
  }

  if (el.type === "chart") {
    addSectionHeader("Content");

    const chartType = document.createElement("select");
    const chartTypeLabels = { bar: "Bar", line: "Line", pie: "Pie", doughnut: "Doughnut" };
    ["bar", "line", "pie", "doughnut"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = chartTypeLabels[opt] || opt;
      if ((el.chartType || "bar") === opt) o.selected = true;
      chartType.appendChild(o);
    });
    chartType.addEventListener("change", () => {
      el.chartType = chartType.value;
      render();
    });
    addRow("Chart Type", chartType);

    const titleInput = document.createElement("input");
    titleInput.value = el.title || "";
    titleInput.addEventListener("input", () => {
      el.title = titleInput.value;
      render();
    });
    addRow("Title", titleInput);

    const ds = document.createElement("input");
    ds.value = el.dataSource || "";
    ds.placeholder = "{{chartData}}";
    ds.addEventListener("input", () => {
      el.dataSource = ds.value;
      render();
    });
    addRow("Data Source", ds);

    const lf = document.createElement("input");
    lf.value = el.labelField || "label";
    lf.addEventListener("input", () => {
      el.labelField = lf.value;
      render();
    });
    addRow("Label Field", lf);

    const vf = document.createElement("input");
    vf.value = el.valueField || "value";
    vf.addEventListener("input", () => {
      el.valueField = vf.value;
      render();
    });
    addRow("Value Field", vf);
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
    banner.textContent = `Editing Block: ${editingPartial}`;
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

  const pageSizeLabels = { width: "Page Width", height: "Page Height" };
  ["width", "height"].forEach((key) => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = page[key];
    input.addEventListener("input", () => {
      page[key] = Number(input.value);
      render();
    });
    addRow(pageSizeLabels[key], input);
  });

  const marginLabels = { top: "Margin Top", right: "Margin Right", bottom: "Margin Bottom", left: "Margin Left" };
  ["top", "right", "bottom", "left"].forEach((key) => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = page.margin[key];
    input.addEventListener("input", () => {
      page.margin[key] = Number(input.value);
      render();
    });
    addRow(marginLabels[key], input);
  });

  const regionLabels = { headerHeight: "Header Height", footerHeight: "Footer Height" };
  ["headerHeight", "footerHeight"].forEach((key) => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = page[key] || 0;
    input.addEventListener("input", () => {
      page[key] = Number(input.value);
      render();
    });
    addRow(regionLabels[key], input);
  });

  const pageCountInput = document.createElement("input");
  pageCountInput.type = "number";
  pageCountInput.min = "1";
  pageCountInput.step = "1";
  pageCountInput.value = String(getManualPageCount());
  pageCountInput.addEventListener("input", () => {
    const next = Math.max(1, Math.floor(Number(pageCountInput.value) || 1));
    template.pageCount = next;
    const list = getElements();
    list.forEach((el) => {
      const p = Number(el.page);
      if (Number.isFinite(p) && p > next) {
        el.page = next;
      }
    });
    previewPageIndex = clamp(previewPageIndex, 0, Math.max(0, next - 1));
    render();
  });
  addRow("Page Count", pageCountInput);

  const contractTitle = document.createElement("div");
  contractTitle.className = "panel-title";
  contractTitle.textContent = "Merge Fields";
  props.appendChild(contractTitle);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.marginBottom = "8px";
  const syncBtn = document.createElement("button");
  syncBtn.textContent = "Detect Data Fields";
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
    empty.textContent = "No merge fields detected yet. Add components with {{field.path}} first.";
    props.appendChild(empty);
  }

  const currentIssues = summarizeContractDiagnostics(contractDiagnostics);
  const issueSummary = document.createElement("div");
  issueSummary.style.fontSize = "12px";
  issueSummary.style.color = currentIssues.missingRequired.length || currentIssues.errors.length ? "#9f2f23" : "#3c6f3a";
  issueSummary.style.marginBottom = "8px";
  issueSummary.textContent = currentIssues.missingRequired.length || currentIssues.errors.length
    ? `Data issues: ${currentIssues.missingRequired.length} required missing, ${currentIssues.errors.length} transform errors`
    : "Data issues: none";
  props.appendChild(issueSummary);

  contract.fields.forEach((field) => {
    const fieldDiag = (contractDiagnostics.fields || []).find((f) => f.path === field.path);
    const card = document.createElement("div");
    card.className = "field-card";

    const cardHeader = document.createElement("div");
    cardHeader.className = "field-card-header";

    const path = document.createElement("div");
    path.className = "field-card-name";
    path.textContent = field.path;
    cardHeader.appendChild(path);

    const badges = document.createElement("div");
    badges.className = "field-card-badges";
    if (field.required) {
      const badge = document.createElement("span");
      badge.className = "field-badge field-badge-required";
      badge.textContent = "Required";
      badges.appendChild(badge);
    }
    if (field.transform && field.transform !== "none") {
      const badge = document.createElement("span");
      badge.className = "field-badge";
      badge.textContent = field.transform;
      badges.appendChild(badge);
    }
    cardHeader.appendChild(badges);
    card.appendChild(cardHeader);

    if (fieldDiag && (fieldDiag.missing || fieldDiag.error)) {
      const diag = document.createElement("div");
      diag.className = "field-card-error";
      const parts = [];
      if (fieldDiag.missing) parts.push("Missing in current data");
      if (fieldDiag.error) parts.push(fieldDiag.error);
      diag.textContent = parts.join(" \u2022 ");
      card.appendChild(diag);
    }

    const basicRow = document.createElement("div");
    basicRow.className = "field-card-row";

    const reqWrap = document.createElement("label");
    reqWrap.className = "field-inline-toggle";
    const req = document.createElement("input");
    req.type = "checkbox";
    req.checked = Boolean(field.required);
    req.addEventListener("change", () => {
      field.required = req.checked;
      render();
    });
    reqWrap.appendChild(req);
    reqWrap.appendChild(document.createTextNode(" Required"));
    basicRow.appendChild(reqWrap);

    const transformWrap = document.createElement("div");
    transformWrap.className = "field-inline-select";
    const transformSelectLabel = document.createElement("span");
    transformSelectLabel.textContent = "Format:";
    const transform = document.createElement("select");
    const transformLabels = { none: "None", trim: "Trim", uppercase: "UPPERCASE", lowercase: "lowercase", titlecase: "Title Case", number: "Number", boolean: "Yes/No", date: "Date", currency: "Currency" };
    ["none", "trim", "uppercase", "lowercase", "titlecase", "number", "boolean", "date", "currency"].forEach(
      (opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = transformLabels[opt] || opt;
        if ((field.transform || "none") === opt) o.selected = true;
        transform.appendChild(o);
      }
    );
    transform.addEventListener("change", () => {
      field.transform = transform.value;
      render();
    });
    transformWrap.appendChild(transformSelectLabel);
    transformWrap.appendChild(transform);
    basicRow.appendChild(transformWrap);
    card.appendChild(basicRow);

    const def = document.createElement("input");
    def.className = "field-card-input";
    def.value = field.defaultValue == null ? "" : String(field.defaultValue);
    def.placeholder = "Default value (if missing)";
    def.addEventListener("input", () => {
      field.defaultValue = def.value;
      render();
    });
    card.appendChild(def);

    const advanced = document.createElement("details");
    advanced.className = "field-card-advanced";
    const advSummary = document.createElement("summary");
    advSummary.textContent = "Advanced";
    advanced.appendChild(advSummary);

    const advBody = document.createElement("div");
    advBody.className = "field-card-advanced-body";

    function advRow(label, inputEl) {
      const row = document.createElement("div");
      row.className = "field-adv-row";
      const lbl = document.createElement("span");
      lbl.textContent = label;
      row.appendChild(lbl);
      row.appendChild(inputEl);
      advBody.appendChild(row);
    }

    const type = document.createElement("select");
    const typeDisplayLabels = { string: "Text", number: "Number", boolean: "Yes/No", array: "List", object: "Object" };
    ["string", "number", "boolean", "array", "object"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = typeDisplayLabels[opt] || opt;
      if ((field.type || "string") === opt) o.selected = true;
      type.appendChild(o);
    });
    type.addEventListener("change", () => {
      field.type = type.value;
      render();
    });
    advRow("Data Type", type);

    const sourceDisplayLabels = { external: "From Input Data", template: "From Template", computed: "Computed" };
    const source = document.createElement("select");
    ["external", "template", "computed"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = sourceDisplayLabels[opt] || opt;
      if ((field.source || "external") === opt) o.selected = true;
      source.appendChild(o);
    });
    source.addEventListener("change", () => {
      field.source = source.value;
      render();
    });
    advRow("Source", source);

    const external = document.createElement("input");
    external.value = field.externalPath || field.path;
    external.placeholder = "Path in source data";
    external.addEventListener("input", () => {
      field.externalPath = external.value.trim() || field.path;
      render();
    });
    advRow("Input Path", external);

    const locale = document.createElement("input");
    locale.value = field.transformLocale || "";
    locale.placeholder = "en-US";
    locale.addEventListener("input", () => {
      field.transformLocale = locale.value.trim() || undefined;
      render();
    });
    advRow("Locale", locale);

    const cur = document.createElement("input");
    cur.value = field.transformCurrency || "";
    cur.placeholder = "USD";
    cur.addEventListener("input", () => {
      field.transformCurrency = cur.value.trim() || undefined;
      render();
    });
    advRow("Currency", cur);

    const dateStyle = document.createElement("select");
    const dateStyleLabels = { "": "Auto", short: "Short (1/1/24)", medium: "Medium (Jan 1, 2024)", long: "Long (January 1, 2024)", full: "Full (Monday, January 1, 2024)" };
    ["", "short", "medium", "long", "full"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = dateStyleLabels[opt] || opt;
      if (String(field.transformDateStyle || "") === opt) o.selected = true;
      dateStyle.appendChild(o);
    });
    dateStyle.addEventListener("change", () => {
      field.transformDateStyle = dateStyle.value || undefined;
      render();
    });
    advRow("Date Format", dateStyle);

    advanced.appendChild(advBody);
    card.appendChild(advanced);
    props.appendChild(card);
  });

  const devSection = document.createElement("details");
  devSection.className = "dev-tools-section";
  const devSummary = document.createElement("summary");
  devSummary.className = "dev-tools-toggle";
  devSummary.textContent = "Developer Tools";
  devSection.appendChild(devSummary);

  const devBody = document.createElement("div");
  devBody.className = "dev-tools-body";

  const testInfo = document.createElement("div");
  testInfo.style.fontSize = "12px";
  testInfo.style.color = "#6f6352";
  testInfo.style.marginBottom = "6px";
  testInfo.textContent = "Paste JSON data to test field mapping and validation.";
  devBody.appendChild(testInfo);

  const payloadInput = document.createElement("textarea");
  payloadInput.className = "dev-tools-textarea";
  payloadInput.value = contractTestPayload || JSON.stringify(data || {}, null, 2);
  devBody.appendChild(payloadInput);

  const testActions = document.createElement("div");
  testActions.style.display = "flex";
  testActions.style.gap = "8px";
  testActions.style.marginTop = "6px";
  testActions.style.marginBottom = "6px";

  const runTestBtn = document.createElement("button");
  runTestBtn.textContent = "Validate Data";
  runTestBtn.addEventListener("click", () => {
    contractTestPayload = payloadInput.value;
    try {
      const parsed = JSON.parse(payloadInput.value || "{}");
      contractTestResult = evaluateDataContractLocal(parsed);
      render();
    } catch (_err) {
      contractTestResult = { parseError: "Invalid JSON" };
      render();
    }
  });
  testActions.appendChild(runTestBtn);

  const usePayloadBtn = document.createElement("button");
  usePayloadBtn.textContent = "Use As Preview Data";
  usePayloadBtn.addEventListener("click", () => {
    try {
      const parsed = JSON.parse(payloadInput.value || "{}");
      data = parsed;
      dataName = "(test data)";
      contractTestPayload = payloadInput.value;
      contractTestResult = evaluateDataContractLocal(parsed);
      render();
    } catch (_err) {
      alert("Invalid JSON");
    }
  });
  testActions.appendChild(usePayloadBtn);
  devBody.appendChild(testActions);

  if (contractTestResult) {
    const resultBox = document.createElement("div");
    resultBox.className = "dev-tools-result";
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
        ? `${issues.missingRequired.length} missing, ${issues.errors.length} errors`
        : "All fields valid";
      resultBox.appendChild(summary);

      if (issues.missingRequired.length) {
        const miss = document.createElement("div");
        miss.style.fontSize = "12px";
        miss.style.marginBottom = "6px";
        miss.textContent = `Missing: ${issues.missingRequired.join(", ")}`;
        resultBox.appendChild(miss);
      }
      if (issues.errors.length) {
        const errs = document.createElement("div");
        errs.style.fontSize = "12px";
        errs.style.marginBottom = "6px";
        errs.textContent = `Errors: ${issues.errors.join(" | ")}`;
        resultBox.appendChild(errs);
      }

      const mappedToggle = document.createElement("details");
      const mappedSummary = document.createElement("summary");
      mappedSummary.style.fontSize = "12px";
      mappedSummary.style.fontWeight = "600";
      mappedSummary.style.cursor = "pointer";
      mappedSummary.textContent = "Resolved data";
      mappedToggle.appendChild(mappedSummary);
      const mapped = document.createElement("pre");
      mapped.style.margin = "4px 0 0";
      mapped.style.maxHeight = "140px";
      mapped.style.overflow = "auto";
      mapped.style.fontSize = "11px";
      mapped.style.whiteSpace = "pre-wrap";
      mapped.textContent = JSON.stringify(contractTestResult.data || {}, null, 2);
      mappedToggle.appendChild(mapped);
      resultBox.appendChild(mappedToggle);
    }
    devBody.appendChild(resultBox);
  }

  devSection.appendChild(devBody);
  props.appendChild(devSection);
}

function onPointerMove(ev) {
  if (!dragState) return;
  const el = getElementById(dragState.id);
  if (!el) return;
  const dx = pxToPt(ev.clientX - dragState.startX);
  const dy = pxToPt(ev.clientY - dragState.startY);
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    dragState.moved = true;
    dragState.inlineEditCandidate = false;
  }

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
    activeGuides = { x: null, y: null, region: el.region || "body" };
  } else {
    let x = dragState.originX + dx;
    let y = dragState.originY + dy;
    x = clamp(x, bounds.x, bounds.w - el.w);
    y = clamp(y, bounds.y, bounds.h - el.h);
    const snapped = snapMovePosition(el, x, y, dragState.region || (el.region || "body"));
    const nextX = clamp(snapped.x, bounds.x, bounds.w - el.w);
    const nextY = clamp(snapped.y, bounds.y, bounds.h - el.h);
    const moveDx = nextX - dragState.originX;
    const moveDy = nextY - dragState.originY;

    if (Array.isArray(dragState.selectionOrigins) && dragState.selectionOrigins.length > 1) {
      dragState.selectionOrigins.forEach((origin) => {
        const node = getElementById(origin.id);
        if (!node) return;
        if ((node.region || "body") !== (dragState.region || "body")) return;
        const nodeBounds = getRegionBounds(node.region || "body");
        node.x = clamp(origin.x + moveDx, nodeBounds.x, nodeBounds.w - node.w);
        node.y = clamp(origin.y + moveDy, nodeBounds.y, nodeBounds.h - node.h);
      });
    } else {
      el.x = nextX;
      el.y = nextY;
    }
    activeGuides = snapped.guides || { x: null, y: null, region: dragState.region || "body" };
  }

  render();
}

function onPointerUp() {
  if (!dragState) return;
  const state = dragState;
  dragState = null;
  if (state.inlineEditCandidate && !state.moved && !editingText) {
    const el = getElementById(state.id);
    const div = canvas.querySelector(`.element[data-id="${state.id}"]`);
    if (el && div && (el.type === "text" || el.type === "flowText")) {
      activeGuides = { x: null, y: null, region: "body" };
      enableTextEdit(div, el);
      return;
    }
  }
  if (!state.moved && state.mode !== "resize") {
    activeGuides = { x: null, y: null, region: "body" };
    return;
  }
  activeGuides = { x: null, y: null, region: "body" };
  render();
}

canvas.addEventListener("pointerdown", () => {
  if (placingType) return;
  clearSelection();
  clearVisualHelpers();
  render();
});

canvas.addEventListener("dragover", (ev) => {
  ev.preventDefault();
  updateDropPreviewFromEvent(ev);
});

canvas.addEventListener("dragleave", (ev) => {
  if (ev.currentTarget !== ev.target) return;
  if (dropPreview) {
    dropPreview = null;
    render();
  }
});

canvas.addEventListener("drop", (ev) => {
  ev.preventDefault();
  if (!template) return;
  const type = getPaletteTypeFromDragEvent(ev);
  if (!type) return;
  let el;
  if (type.startsWith("include:")) {
    const ref = type.split("include:")[1];
    el = createIncludeElement(ref);
  } else {
    el = createDefaultElement(type);
  }
  const placement = computePlacement(ev, el);
  if (!placement) return;
  el.region = placement.region;
  el.x = placement.x;
  el.y = placement.y;
  if (previewPageIndex > 0) {
    el.page = previewPageIndex + 1;
  }
  const list = getElements();
  list.push(el);
  setElements(list);
  setSingleSelection(el.id);
  clearPlacing();
  dragPaletteType = null;
  dropPreview = null;
  render();
});

window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

addButtons.forEach((btn) => {
  btn.draggable = true;
  btn.addEventListener("dragstart", (ev) => {
    if (isTemplateLocked()) { ev.preventDefault(); return; }
    const type = btn.dataset.add;
    dragPaletteType = type;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = "copy";
      ev.dataTransfer.setData("application/x-smartdocs-component", type);
      ev.dataTransfer.setData("text/plain", type);
      const dragChip = document.createElement("div");
      dragChip.textContent = btn.textContent || type;
      dragChip.style.position = "fixed";
      dragChip.style.top = "-1000px";
      dragChip.style.left = "-1000px";
      dragChip.style.padding = "6px 10px";
      dragChip.style.border = "1px solid #b33a2b";
      dragChip.style.background = "#fff5f3";
      dragChip.style.color = "#7f2b20";
      dragChip.style.fontSize = "12px";
      dragChip.style.borderRadius = "6px";
      dragChip.style.pointerEvents = "none";
      document.body.appendChild(dragChip);
      ev.dataTransfer.setDragImage(dragChip, 18, 12);
      requestAnimationFrame(() => dragChip.remove());
    }
  });
  btn.addEventListener("dragend", () => {
    dragPaletteType = null;
    if (dropPreview) {
      dropPreview = null;
      render();
    }
  });
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

workflowStepButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setWorkflowStep(btn.dataset.workflowStep);
  });
});

modeSections.forEach((section) => {
  if (section.tagName !== "DETAILS") return;
  section.addEventListener("toggle", () => {
    if (!section.open) return;
    modeSections.forEach((other) => {
      if (other !== section && other.tagName === "DETAILS" && other.dataset.modeSection === section.dataset.modeSection && other.open) {
        other.removeAttribute("open");
      }
    });
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

if (actionNewBtn) {
  actionNewBtn.addEventListener("click", () => {
    if (newTemplateBtn) newTemplateBtn.click();
    setWorkflowStep("design");
  });
}

if (actionSaveBtn) {
  actionSaveBtn.addEventListener("click", () => {
    if (dbSaveBtn) dbSaveBtn.click();
    setWorkflowStep("publish", { applyMode: false });
  });
}

if (actionCheckBtn) {
  actionCheckBtn.addEventListener("click", () => {
    setWorkflowStep("test");
    runQuickTemplateCheck();
  });
}

if (actionPreviewPdfBtn) {
  actionPreviewPdfBtn.addEventListener("click", () => {
    setWorkflowStep("test");
    if (previewPdfBtn) previewPdfBtn.click();
  });
}

if (undoBtn) {
  undoBtn.addEventListener("click", () => { performUndo(); });
}
if (redoBtn) {
  redoBtn.addEventListener("click", () => { performRedo(); });
}

if (snapEnabledInput) {
  snapEnabledInput.checked = snapEnabled;
  snapEnabledInput.addEventListener("change", () => {
    snapEnabled = snapEnabledInput.checked;
    if (!snapEnabled) {
      activeGuides = { x: null, y: null, region: "body" };
      render();
    }
  });
}

if (showBoundsInput) {
  try {
    showComponentBounds = window.localStorage.getItem("smartdocs.showComponentBounds") !== "off";
  } catch (_err) {
    showComponentBounds = true;
  }
  showBoundsInput.checked = showComponentBounds;
  showBoundsInput.addEventListener("change", () => {
    showComponentBounds = showBoundsInput.checked;
    try {
      window.localStorage.setItem("smartdocs.showComponentBounds", showComponentBounds ? "on" : "off");
    } catch (_err) {
      // ignore storage failures
    }
    syncCanvasDecorations();
  });
}

if (alignLeftBtn) alignLeftBtn.addEventListener("click", () => alignSelection("left"));
if (alignCenterBtn) alignCenterBtn.addEventListener("click", () => alignSelection("center"));
if (alignRightBtn) alignRightBtn.addEventListener("click", () => alignSelection("right"));
if (alignTopBtn) alignTopBtn.addEventListener("click", () => alignSelection("top"));
if (alignMiddleBtn) alignMiddleBtn.addEventListener("click", () => alignSelection("middle"));
if (alignBottomBtn) alignBottomBtn.addEventListener("click", () => alignSelection("bottom"));
if (distributeHBtn) distributeHBtn.addEventListener("click", () => distributeSelection("x"));
if (distributeVBtn) distributeVBtn.addEventListener("click", () => distributeSelection("y"));

document.getElementById("btn-export").addEventListener("click", saveTemplateDownload);
document.getElementById("btn-reload").addEventListener("click", () => {
  const path = activeStarterPath || (starterTemplateSelect && starterTemplateSelect.value);
  if (!path) return;
  loadTemplateFromUrl(path);
});
previewBtn.addEventListener("click", () => {
  previewMode = !previewMode;
  previewBtn.textContent = previewMode ? "Hide Live Data" : "Show Live Data";
  render();
  syncWorkflowFromState();
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
    setWorkflowStep("design");
  });
}

if (starterTemplateSelect) {
  starterTemplateSelect.addEventListener("change", () => {
    if (!starterTemplateSelect.value) return;
    loadTemplateFromUrl(starterTemplateSelect.value);
    setWorkflowStep("design");
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
    await executeWorkflowTransition("ARCHIVED", null);
  });
}

// Submit for review confirm
const workflowSubmitConfirm = document.getElementById("workflow-submit-confirm");
if (workflowSubmitConfirm) {
  workflowSubmitConfirm.addEventListener("click", async () => {
    const chainSelect = document.getElementById("workflow-chain-select");
    const chainId = chainSelect ? chainSelect.value : "";
    if (!chainId) { alert("Select an approval chain."); return; }
    workflowSubmitConfirm.disabled = true;
    workflowSubmitConfirm.textContent = "Submitting...";
    try {
      const resp = await fetch(`/api/templates/${activeDbTemplateId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Submit failed.");
      activeDbTemplateStatus = "REVIEW";
      syncWorkflowPanel();
      updateTemplateStateLabel();
      render();
    } catch (err) {
      alert(err.message);
    }
    workflowSubmitConfirm.disabled = false;
    workflowSubmitConfirm.textContent = "Submit for Review";
  });
}

// Approve confirm
const workflowApproveConfirm = document.getElementById("workflow-approve-confirm");
if (workflowApproveConfirm) {
  workflowApproveConfirm.addEventListener("click", async () => {
    const comment = document.getElementById("workflow-approve-comment").value.trim();
    workflowApproveConfirm.disabled = true;
    try {
      const resp = await fetch(`/api/templates/${activeDbTemplateId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: comment || undefined })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Approve failed.");
      activeDbTemplateStatus = data.template ? data.template.status : activeDbTemplateStatus;
      document.getElementById("workflow-approve-comment").value = "";
      syncWorkflowPanel();
      updateTemplateStateLabel();
      render();
      loadPendingReviews();
    } catch (err) {
      alert(err.message);
    }
    workflowApproveConfirm.disabled = false;
  });
}

// Show rejection form
const workflowRejectShow = document.getElementById("workflow-reject-show");
if (workflowRejectShow) {
  workflowRejectShow.addEventListener("click", () => {
    if (workflowRejection) workflowRejection.classList.remove("hidden");
    if (workflowRejectionReason) workflowRejectionReason.focus();
  });
}

// Rejection confirm
if (workflowRejectConfirm) {
  workflowRejectConfirm.addEventListener("click", async () => {
    const reason = workflowRejectionReason ? workflowRejectionReason.value.trim() : "";
    if (!reason) { alert("Please provide a reason for rejection."); return; }
    workflowRejectConfirm.disabled = true;
    try {
      const resp = await fetch(`/api/templates/${activeDbTemplateId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Reject failed.");
      activeDbTemplateStatus = "DRAFT";
      if (workflowRejection) workflowRejection.classList.add("hidden");
      if (workflowRejectionReason) workflowRejectionReason.value = "";
      syncWorkflowPanel();
      updateTemplateStateLabel();
      render();
      loadPendingReviews();
    } catch (err) {
      alert(err.message);
    }
    workflowRejectConfirm.disabled = false;
  });
}

// Pending reviews
async function loadPendingReviews() {
  const btn = document.getElementById("btn-pending-reviews");
  const badge = document.getElementById("pending-reviews-count");
  if (!btn) return;
  try {
    const resp = await fetch("/api/approvals/pending");
    if (!resp.ok) return;
    const { pending } = await resp.json();
    if (pending.length > 0) {
      btn.style.display = "";
      if (badge) {
        badge.textContent = pending.length;
        badge.style.display = "";
      }
    } else {
      btn.style.display = "none";
    }

    btn.onclick = () => {
      if (pending.length === 0) { alert("No pending reviews."); return; }
      const list = pending.map((p) => `• ${p.templateName} (${p.chainName}, Step ${p.levelOrder})`).join("\n");
      alert("Pending Reviews:\n\n" + list);
    };
  } catch (_) {}
}

// Load pending on startup
setTimeout(loadPendingReviews, 2000);

if (pagePrevBtn) {
  pagePrevBtn.addEventListener("click", () => setPreviewPage(previewPageIndex - 1));
}

if (pageNextBtn) {
  pageNextBtn.addEventListener("click", () => setPreviewPage(previewPageIndex + 1));
}

if (pageAddBtn) {
  pageAddBtn.addEventListener("click", () => addManualPage());
}

if (pageDeleteBtn) {
  pageDeleteBtn.addEventListener("click", () => deleteCurrentManualPage());
}

populateStarterTemplates();
renderDbTemplateSelect();
setTemplate(createBlankTemplate("Untitled Template"));
previewBtn.textContent = previewMode ? "Hide Live Data" : "Show Live Data";
refreshDbTemplates({ silent: true });
syncDbStatusSelect();
try {
  setLeftMode(window.localStorage.getItem("smartdocs.leftMode") || "design");
} catch (_err) {
  setLeftMode("design");
}
syncCanvasDecorations();

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
  if (previewPageIndex > 0) {
    el.page = previewPageIndex + 1;
  }
  const list = getElements();
  list.push(el);
  setElements(list);
  setSingleSelection(el.id);
  clearPlacing();
  dropPreview = null;
  render();
});

window.addEventListener("keydown", (ev) => {
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && ev.key === "z" && !ev.shiftKey) {
    ev.preventDefault();
    performUndo();
    return;
  }
  if (mod && ev.key === "z" && ev.shiftKey) {
    ev.preventDefault();
    performRedo();
    return;
  }
  if (mod && ev.key === "y") {
    ev.preventDefault();
    performRedo();
    return;
  }
  if (ev.key === "Escape" && placingType) {
    clearPlacing();
    dropPreview = null;
    render();
  }
  if (ev.key === "Delete" || ev.key === "Backspace") {
    if (editingText) return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.closest && active.closest('[contenteditable="true"]'))) {
      return;
    }
    const selectedSet = new Set(selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []));
    if (!selectedSet.size) return;
    if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    const list = getElements();
    const next = list.filter((el) => !selectedSet.has(el.id));
    if (next.length !== list.length) {
      setElements(next);
      clearSelection();
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
        previewBtn.textContent = "Hide Live Data";
      }
      clearSelection();
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
    previewBtn.textContent = "Hide Live Data";
  }
  clearSelection();
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
  syncPrimaryActions();
  syncArrangeActions();
};

// Demo mode: check /api/health and show banner if active
fetch("/api/health").then(r => r.json()).then(info => {
  if (info.demoMode) {
    const banner = document.createElement("div");
    banner.id = "demo-banner";
    banner.innerHTML = '<strong>Demo Mode</strong> — Design and preview templates freely. Database saves are disabled. <a href="https://github.com/snehalsurti12/smartdocs" target="_blank">Run your own instance</a>';
    document.body.prepend(banner);
    document.body.classList.add("has-demo-banner");
    // Set CSS variable to actual banner height so app layout adjusts dynamically
    requestAnimationFrame(() => {
      document.documentElement.style.setProperty("--banner-h", banner.offsetHeight + "px");
    });
  }
}).catch(() => {});

// ── Admin Panel Functions ──

const ROLE_COLORS = {
  ADMIN: { bg: "#ede9fe", color: "#5b21b6" },
  PUBLISHER: { bg: "#dcfce7", color: "#166534" },
  REVIEWER: { bg: "#dbeafe", color: "#1e40af" },
  AUTHOR: { bg: "#e8e5de", color: "#5c5647" },
};

async function loadAdminUsers() {
  const list = document.getElementById("admin-users-list");
  if (!list) return;
  try {
    const resp = await fetch("/api/users");
    if (!resp.ok) return;
    const data = await resp.json();
    list.innerHTML = "";
    (data.users || []).forEach((u) => {
      const parts = (u.name || "U").split(" ");
      const initials = parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
      const rc = ROLE_COLORS[u.role] || ROLE_COLORS.AUTHOR;
      const row = document.createElement("div");
      row.className = "admin-user-row";
      if (!u.active) row.style.opacity = "0.5";
      row.innerHTML = `
        <div class="admin-user-avatar" style="background:${rc.color}">${initials}</div>
        <div class="admin-user-info">
          <span class="admin-user-name">${u.name}${!u.active ? " (inactive)" : ""}</span>
          <span class="admin-user-email">${u.email}</span>
        </div>
        <span class="admin-user-role" style="background:${rc.bg};color:${rc.color}">${u.role}</span>
      `;
      list.appendChild(row);
    });
  } catch (_) {}
}

function setupAdminInvite() {
  const btn = document.getElementById("btn-admin-invite");
  const emailInput = document.getElementById("admin-invite-email");
  const roleSelect = document.getElementById("admin-invite-role");
  const resultDiv = document.getElementById("admin-invite-result");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const email = (emailInput.value || "").trim();
    const role = roleSelect.value;
    if (!email) { showAdminResult(resultDiv, "Email is required.", false); return; }

    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const resp = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Invite failed.");
      emailInput.value = "";
      showAdminResult(resultDiv, `Invite sent! Link: ${data.inviteUrl}`, true);
      loadAdminUsers();
    } catch (err) {
      showAdminResult(resultDiv, err.message, false);
    }
    btn.disabled = false;
    btn.textContent = "Send Invite";
  });
}

function showAdminResult(el, msg, success) {
  if (!el) return;
  el.textContent = msg;
  el.className = "admin-result " + (success ? "success" : "error");
  setTimeout(() => { el.className = "admin-result"; el.textContent = ""; }, 8000);
}

// ── Settings Tab Switching ──
document.querySelectorAll(".settings-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".settings-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".settings-tab-content").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    const panel = document.querySelector(`[data-settings-panel="${tab.dataset.settingsTab}"]`);
    if (panel) panel.classList.add("active");
    // Load data for the tab
    if (tab.dataset.settingsTab === "projects") loadAdminProjects();
    if (tab.dataset.settingsTab === "approval") loadApprovalTab();
  });
});

// ── Projects Tab ──
let adminProjectsCache = [];
let selectedProjectId = null;

async function loadAdminProjects() {
  const list = document.getElementById("admin-projects-list");
  if (!list) return;
  try {
    const resp = await fetch("/api/projects");
    if (!resp.ok) return;
    const data = await resp.json();
    adminProjectsCache = data.projects || [];
    list.innerHTML = "";
    adminProjectsCache.forEach((p) => {
      const row = document.createElement("div");
      row.className = "admin-user-row";
      row.style.cursor = "pointer";
      row.innerHTML = `
        <div class="admin-user-info">
          <span class="admin-user-name">${p.name}</span>
          <span class="admin-user-email">${p.members ? p.members.length : 0} members · ${p._count ? p._count.templates : 0} templates</span>
        </div>
      `;
      row.addEventListener("click", () => showProjectDetail(p.id));
      list.appendChild(row);
    });
  } catch (_) {}
}

async function showProjectDetail(projectId) {
  selectedProjectId = projectId;
  const detailPanel = document.getElementById("project-detail-panel");
  if (!detailPanel) return;
  try {
    const resp = await fetch(`/api/projects/${projectId}`);
    if (!resp.ok) return;
    const { project } = await resp.json();
    document.getElementById("project-detail-title").textContent = project.name;
    detailPanel.style.display = "";

    // Show members with role change and remove
    const membersList = document.getElementById("project-members-list");
    membersList.innerHTML = "";
    (project.members || []).forEach((m) => {
      const u = m.user;
      const row = document.createElement("div");
      row.className = "admin-user-row";

      const infoDiv = document.createElement("div");
      infoDiv.className = "admin-user-info";
      infoDiv.innerHTML = `<span class="admin-user-name">${u.name}</span><span class="admin-user-email">${u.email}</span>`;

      const roleSelect = document.createElement("select");
      roleSelect.className = "admin-member-role-select";
      ["AUTHOR", "REVIEWER", "PUBLISHER", "ADMIN"].forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        if (r === u.role) opt.selected = true;
        roleSelect.appendChild(opt);
      });
      roleSelect.addEventListener("change", async () => {
        try {
          const resp = await fetch(`/api/users/${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: roleSelect.value })
          });
          if (!resp.ok) { const d = await resp.json(); throw new Error(d.error); }
          showProjectDetail(projectId);
          loadAdminUsers();
        } catch (err) { alert("Role update failed: " + err.message); roleSelect.value = u.role; }
      });

      const removeBtn = document.createElement("button");
      removeBtn.className = "chain-step-remove";
      removeBtn.title = "Remove from project";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", async () => {
        if (!confirm(`Remove ${u.name} from this project?`)) return;
        try {
          const resp = await fetch(`/api/projects/${projectId}/members/${u.id}`, { method: "DELETE" });
          if (!resp.ok) { const d = await resp.json(); throw new Error(d.error); }
          showProjectDetail(projectId);
        } catch (err) { alert("Remove failed: " + err.message); }
      });

      row.appendChild(infoDiv);
      row.appendChild(roleSelect);
      row.appendChild(removeBtn);
      membersList.appendChild(row);
    });

    // Populate add-member dropdown with users not already in project
    const memberIds = new Set((project.members || []).map((m) => m.user.id));
    const addSelect = document.getElementById("project-add-member-select");
    if (addSelect) {
      addSelect.innerHTML = '<option value="">Select user...</option>';
      try {
        const usersResp = await fetch("/api/users");
        if (usersResp.ok) {
          const { users } = await usersResp.json();
          users.filter((u) => !memberIds.has(u.id) && u.active).forEach((u) => {
            const opt = document.createElement("option");
            opt.value = u.id;
            opt.textContent = `${u.name} (${u.role})`;
            addSelect.appendChild(opt);
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// Create project
const createProjectBtn = document.getElementById("btn-admin-create-project");
if (createProjectBtn) {
  createProjectBtn.addEventListener("click", async () => {
    const name = document.getElementById("admin-project-name").value.trim();
    if (!name) { showAdminResult(document.getElementById("admin-project-result"), "Name is required.", false); return; }
    createProjectBtn.disabled = true;
    try {
      const resp = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: document.getElementById("admin-project-desc").value.trim() })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      document.getElementById("admin-project-name").value = "";
      document.getElementById("admin-project-desc").value = "";
      showAdminResult(document.getElementById("admin-project-result"), "Project created!", true);
      loadAdminProjects();
    } catch (err) {
      showAdminResult(document.getElementById("admin-project-result"), err.message, false);
    }
    createProjectBtn.disabled = false;
  });
}

// Add member to project
const addMemberBtn = document.getElementById("btn-project-add-member");
if (addMemberBtn) {
  addMemberBtn.addEventListener("click", async () => {
    const userId = document.getElementById("project-add-member-select").value;
    if (!userId || !selectedProjectId) return;
    try {
      const resp = await fetch(`/api/projects/${selectedProjectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId })
      });
      if (!resp.ok) { const d = await resp.json(); throw new Error(d.error); }
      showProjectDetail(selectedProjectId);
    } catch (err) { alert(err.message); }
  });
}

// ── Approval Tab ──
let chainSteps = [];

async function loadApprovalTab() {
  // Populate project dropdown
  const select = document.getElementById("approval-project-select");
  if (!select) return;
  try {
    const resp = await fetch("/api/projects");
    if (!resp.ok) return;
    const { projects } = await resp.json();
    select.innerHTML = '<option value="">Select a project...</option>';
    projects.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
  } catch (_) {}
  // Reset chain builder
  chainSteps = [];
  renderChainStepsBuilder();
}

const approvalProjectSelect = document.getElementById("approval-project-select");
if (approvalProjectSelect) {
  approvalProjectSelect.addEventListener("change", async () => {
    const projectId = approvalProjectSelect.value;
    if (!projectId) return;
    await loadChainProjectMembers(projectId);
    loadApprovalChains(projectId);
    renderChainStepsBuilder();
  });
}

async function loadApprovalChains(projectId) {
  const container = document.getElementById("approval-chains-list");
  if (!container) return;
  try {
    const resp = await fetch(`/api/projects/${projectId}/approval-chains`);
    if (!resp.ok) return;
    const { chains } = await resp.json();
    container.innerHTML = "";
    if (chains.length === 0) {
      container.innerHTML = '<p style="font-size:12px;color:#999;">No approval chains configured yet.</p>';
      return;
    }
    chains.filter((c) => c.active).forEach((chain) => {
      const card = document.createElement("div");
      card.className = "chain-card";

      // Title row with edit button
      const titleRow = document.createElement("div");
      titleRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
      const title = document.createElement("div");
      title.className = "chain-card-title";
      title.style.marginBottom = "0";
      title.textContent = chain.name;
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.style.cssText = "font-size:11px;font-weight:600;padding:3px 10px;border:1px solid #e6dfd2;border-radius:4px;background:#fff;color:#b33a2b;cursor:pointer;";
      editBtn.addEventListener("click", () => editApprovalChain(chain));
      titleRow.appendChild(title);
      titleRow.appendChild(editBtn);
      card.appendChild(titleRow);

      // Steps display with approver names
      const stepsDiv = document.createElement("div");
      stepsDiv.className = "chain-card-steps";
      chain.levels.forEach((lvl, idx) => {
        if (idx > 0) {
          const arrow = document.createElement("div");
          arrow.className = "chain-step-arrow";
          arrow.textContent = "↓";
          stepsDiv.appendChild(arrow);
        }
        const step = document.createElement("div");
        step.className = "chain-card-step";
        const approverName = lvl.defaultUserId ? (chainProjectMembers.find((u) => u.id === lvl.defaultUserId) || {}).name || "Assigned" : "Assigned at submit";
        step.innerHTML = `
          <span class="chain-card-step-num">${lvl.levelOrder}</span>
          <span><b>${lvl.label}</b> — ${lvl.requiredRole} — <em>${approverName}</em></span>
        `;
        stepsDiv.appendChild(step);
      });
      card.appendChild(stepsDiv);
      container.appendChild(card);
    });
  } catch (_) {}
}

function editApprovalChain(chain) {
  // Load steps into the builder
  const nameInput = document.getElementById("admin-chain-name");
  if (nameInput) nameInput.value = chain.name;

  chainSteps = (chain.levels || []).map((lvl) => ({
    label: lvl.label,
    requiredRole: lvl.requiredRole,
    defaultUserId: lvl.defaultUserId || null,
  }));

  renderChainStepsBuilder();

  // Open the new chain form
  const form = document.getElementById("new-chain-form");
  if (form) form.open = true;

  // Scroll to the form
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Chain step builder
let chainProjectMembers = []; // cached members for the selected project

async function loadChainProjectMembers(projectId) {
  chainProjectMembers = [];
  if (!projectId) return;
  try {
    const resp = await fetch(`/api/projects/${projectId}`);
    if (resp.ok) {
      const { project } = await resp.json();
      chainProjectMembers = (project.members || []).map((m) => m.user);
    }
  } catch (_) {}
}

function renderChainStepsBuilder() {
  const container = document.getElementById("chain-steps-builder");
  if (!container) return;
  container.innerHTML = "";
  chainSteps.forEach((step, i) => {
    if (i > 0) {
      const arrow = document.createElement("div");
      arrow.className = "chain-step-arrow";
      arrow.textContent = "↓";
      container.appendChild(arrow);
    }
    const row = document.createElement("div");
    row.className = "chain-step-row";
    row.style.gridTemplateColumns = "1fr";
    row.innerHTML = `<span class="chain-step-num">Step ${i + 1}</span>`;

    // Label input
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "Label (e.g. Legal Review)";
    labelInput.value = step.label || "";
    labelInput.addEventListener("input", () => { chainSteps[i].label = labelInput.value; });

    // Role select
    const roleRow = document.createElement("div");
    roleRow.style.cssText = "display:flex;gap:6px;margin-top:4px;";
    const roleLabel = document.createElement("span");
    roleLabel.style.cssText = "font-size:10px;color:#7a6f5f;align-self:center;min-width:60px;";
    roleLabel.textContent = "Min. Role:";
    const roleSelect = document.createElement("select");
    roleSelect.style.cssText = "flex:1;font-size:11px;padding:4px 6px;border:1px solid #e6dfd2;border-radius:4px;";
    ["REVIEWER", "PUBLISHER", "ADMIN"].forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r; opt.textContent = r;
      if (r === (step.requiredRole || "REVIEWER")) opt.selected = true;
      roleSelect.appendChild(opt);
    });
    roleSelect.addEventListener("change", () => { chainSteps[i].requiredRole = roleSelect.value; });
    roleRow.appendChild(roleLabel);
    roleRow.appendChild(roleSelect);

    // Default approver select
    const approverRow = document.createElement("div");
    approverRow.style.cssText = "display:flex;gap:6px;margin-top:4px;";
    const approverLabel = document.createElement("span");
    approverLabel.style.cssText = "font-size:10px;color:#7a6f5f;align-self:center;min-width:60px;";
    approverLabel.textContent = "Approver:";
    const approverSelect = document.createElement("select");
    approverSelect.style.cssText = "flex:1;font-size:11px;padding:4px 6px;border:1px solid #e6dfd2;border-radius:4px;";
    const noneOpt = document.createElement("option");
    noneOpt.value = ""; noneOpt.textContent = "— Assigned at submit time —";
    approverSelect.appendChild(noneOpt);
    chainProjectMembers.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = `${u.name} (${u.role})`;
      if (u.id === step.defaultUserId) opt.selected = true;
      approverSelect.appendChild(opt);
    });
    approverSelect.addEventListener("change", () => { chainSteps[i].defaultUserId = approverSelect.value || null; });
    approverRow.appendChild(approverLabel);
    approverRow.appendChild(approverSelect);

    // Remove button
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chain-step-remove";
    removeBtn.style.cssText = "position:absolute;top:4px;right:4px;";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => { chainSteps.splice(i, 1); renderChainStepsBuilder(); });

    row.appendChild(labelInput);
    row.appendChild(roleRow);
    row.appendChild(approverRow);
    row.appendChild(removeBtn);
    container.appendChild(row);
  });
}

const addStepBtn = document.getElementById("btn-add-chain-step");
if (addStepBtn) {
  addStepBtn.addEventListener("click", () => {
    chainSteps.push({ label: "", requiredRole: "REVIEWER" });
    renderChainStepsBuilder();
  });
}

const saveChainBtn = document.getElementById("btn-save-chain");
if (saveChainBtn) {
  saveChainBtn.addEventListener("click", async () => {
    const projectId = document.getElementById("approval-project-select").value;
    const name = document.getElementById("admin-chain-name").value.trim();
    if (!projectId) { showAdminResult(document.getElementById("admin-chain-result"), "Select a project first.", false); return; }
    if (!name) { showAdminResult(document.getElementById("admin-chain-result"), "Chain name is required.", false); return; }
    if (chainSteps.length === 0) { showAdminResult(document.getElementById("admin-chain-result"), "Add at least one step.", false); return; }
    saveChainBtn.disabled = true;
    try {
      const resp = await fetch(`/api/projects/${projectId}/approval-chains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, levels: chainSteps })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      document.getElementById("admin-chain-name").value = "";
      chainSteps = [];
      renderChainStepsBuilder();
      showAdminResult(document.getElementById("admin-chain-result"), "Approval chain saved!", true);
      loadApprovalChains(projectId);
    } catch (err) {
      showAdminResult(document.getElementById("admin-chain-result"), err.message, false);
    }
    saveChainBtn.disabled = false;
  });
}
