const CHROME_RUNTIME_AVAILABLE = typeof chrome !== "undefined" && chrome.runtime?.sendMessage;

const previewState = {
  classes: [
    {
      classId: "math-sl",
      className: "Mathematics SL",
      teacherName: "Ms. Rivera",
      criteria: { A: 7, B: 6, C: 7, D: 6 },
      isIB: true,
      maxScore: 7,
      yearKey: "2025-26",
      yearLabel: "2025-26",
      classAverage: 6.5,
      gpa: 4
    },
    {
      classId: "tok",
      className: "Theory of Knowledge",
      teacherName: "Mr. Chen",
      criteria: { A: 5, B: 5, C: 4, D: 5 },
      isIB: false,
      maxScore: 8,
      yearKey: "2025-26",
      yearLabel: "2025-26",
      classAverage: 4.75,
      gpa: 3
    }
  ],
  excludedClassIds: ["tok"],
  activeYear: { key: "2025-26", label: "2025-26" },
  yearOrder: [
    { key: "2025-26", label: "2025-26" },
    { key: "2024-25", label: "2024-25" }
  ],
  yearSnapshots: {
    "2025-26": {
      year: { key: "2025-26", label: "2025-26" },
      syncedAt: new Date().toISOString(),
      summary: {
        includedCount: 1,
        totalCount: 2,
        globalAverage: 6.5,
        globalGpa: 4
      }
    },
    "2024-25": {
      year: { key: "2024-25", label: "2024-25" },
      syncedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 120).toISOString(),
      summary: {
        includedCount: 6,
        totalCount: 7,
        globalAverage: 5.9,
        globalGpa: 3.45
      }
    }
  },
  lastSync: new Date().toISOString(),
  status: "online",
  error: "",
  loginRequired: false,
  summary: {
    includedCount: 1,
    totalCount: 2,
    globalAverage: 6.5,
    globalGpa: 4
  },
  yearComparison: {
    averageDelta: 0.6,
    gpaDelta: 0.55,
    rows: [
      {
        key: "2025-26",
        label: "2025-26",
        active: true,
        summary: {
          includedCount: 1,
          totalCount: 2,
          globalAverage: 6.5,
          globalGpa: 4
        }
      },
      {
        key: "2024-25",
        label: "2024-25",
        active: false,
        summary: {
          includedCount: 6,
          totalCount: 7,
          globalAverage: 5.9,
          globalGpa: 3.45
        }
      }
    ]
  }
};

let currentState = {
  classes: [],
  excludedClassIds: [],
  summary: {
    includedCount: 0,
    totalCount: 0,
    globalAverage: null,
    globalGpa: null
  },
  status: "idle",
  error: "",
  lastSync: null
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  wireEvents();
  loadState();
});

function cacheElements() {
  [
    "lastSyncText",
    "statusPill",
    "statusText",
    "messageBanner",
    "gpaStat",
    "avgStat",
    "classStat",
    "includedStat",
    "classCountText",
    "classList",
    "yearDeltaText",
    "yearComparison",
    "syncButton",
    "syncIconButton",
    "syncButtonText",
    "buttonSpinner",
    "loginButton",
    "compareButton",
    "almaButton",
    "optionsButton"
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });

  elements.buttonSpinner = document.querySelector(".button-spinner");
  elements.emptyStateTemplate = document.getElementById("emptyStateTemplate");
}

function wireEvents() {
  elements.syncButton.addEventListener("click", syncGrades);
  elements.syncIconButton.addEventListener("click", syncGrades);
  elements.loginButton.addEventListener("click", startLogin);
  elements.compareButton.addEventListener("click", compareYears);
  elements.almaButton.addEventListener("click", openAlma);
  elements.optionsButton.addEventListener("click", openOptions);

  if (CHROME_RUNTIME_AVAILABLE) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "SYNC_UPDATED") {
        loadState();
      }
    });
  }
}

async function loadState() {
  const response = await sendRuntimeMessage({ type: "GET_STATE" });
  currentState = response.state || previewState;
  render(currentState);
}

async function syncGrades() {
  setBusy(true, "Recalculating");
  showMessage("");

  const response = await sendRuntimeMessage({ type: "START_SYNC" });
  setBusy(false);

  if (!response.ok) {
    showMessage(response.error || "Could not refresh grades.");
  }

  currentState = response.state || currentState;
  render(currentState);
}

async function startLogin() {
  setBusy(true, "Logging in");
  showMessage("");

  const response = await sendRuntimeMessage({ type: "START_LOGIN" });
  setBusy(false);

  if (!response.ok) {
    showMessage(response.error || "Could not log in.");
  }

  currentState = response.state || currentState;
  render(currentState);
}

async function compareYears() {
  setBusy(true, "Comparing");
  showMessage("");

  const response = await sendRuntimeMessage({ type: "START_YEAR_COMPARE" });
  setBusy(false);

  if (!response.ok) {
    showMessage(response.error || "Could not compare school years.");
  }

  currentState = response.state || currentState;
  render(currentState);
}

async function openAlma() {
  await sendRuntimeMessage({ type: "OPEN_ALMA" });
}

function openOptions() {
  if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }

  window.open("options.html", "_blank", "noopener");
}

async function toggleClass(classId, includeClass) {
  const excluded = new Set(currentState.excludedClassIds || []);
  if (includeClass) {
    excluded.delete(classId);
  } else {
    excluded.add(classId);
  }

  const excludedClassIds = Array.from(excluded);
  const response = await sendRuntimeMessage({
    type: "SET_EXCLUDED_CLASSES",
    classIds: excludedClassIds
  });

  if (response.ok) {
    currentState = response.state || {
      ...currentState,
      excludedClassIds,
      summary: calculatePreviewSummary(currentState.classes, excludedClassIds)
    };
  } else {
    showMessage(response.error || "Could not update class exclusions.");
  }

  render(currentState);
}

function render(state) {
  renderStatus(state);
  renderStats(state);
  renderClasses(state);
  renderYearComparison(state);
  updateBusyFromStatus(state.status);
}

function renderStatus(state) {
  const status = state.status || "idle";
  elements.statusPill.className = `status-pill ${status}`;
  elements.statusText.textContent = statusLabel(status);
  elements.lastSyncText.textContent = state.lastSync
    ? `${state.activeYear?.label || "Current year"} synced ${formatRelativeTime(state.lastSync)}`
    : "Soft Cryo Alma dashboard";

  showMessage(state.error || "");
}

function renderYearComparison(state) {
  const comparison = state.yearComparison || {};
  const rows = comparison.rows || [];
  elements.yearComparison.innerHTML = "";
  elements.yearDeltaText.textContent = formatDeltaLabel(comparison.gpaDelta, "GPA");

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "year-empty";
    empty.textContent = "Use Years to compare school-year snapshots.";
    elements.yearComparison.append(empty);
    return;
  }

  rows.slice(0, 3).forEach((row) => {
    const item = document.createElement("article");
    item.className = `year-row ${row.active ? "active" : ""}`;

    const label = document.createElement("span");
    label.className = "year-label";
    label.textContent = row.label || row.key;

    const values = document.createElement("span");
    values.className = "year-values";
    values.textContent = `GPA ${formatNumber(row.summary?.globalGpa, 2)} · AVG ${formatNumber(row.summary?.globalAverage, 1)}`;

    item.append(label, values);
    elements.yearComparison.append(item);
  });
}

function renderStats(state) {
  const summary = state.summary || {};
  elements.gpaStat.textContent = formatNumber(summary.globalGpa, 2);
  elements.avgStat.textContent = formatNumber(summary.globalAverage, 1);
  elements.classStat.textContent = String(summary.totalCount ?? state.classes?.length ?? 0);
  elements.includedStat.textContent = String(summary.includedCount ?? 0);
}

function renderClasses(state) {
  const classList = elements.classList;
  const classes = state.classes || [];
  const excluded = new Set(state.excludedClassIds || []);

  elements.classCountText.textContent = `${classes.length} found`;
  classList.innerHTML = "";

  if (!classes.length) {
    classList.append(elements.emptyStateTemplate.content.cloneNode(true));
    return;
  }

  classes.forEach((classGrade) => {
    const isIncluded = !excluded.has(classGrade.classId);
    const card = document.createElement("article");
    card.className = `class-card ${isIncluded ? "" : "excluded"}`;

    const details = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "class-title";
    title.textContent = classGrade.className || "Untitled class";
    details.append(title);

    if (classGrade.teacherName) {
      const teacher = document.createElement("p");
      teacher.className = "class-teacher";
      teacher.textContent = classGrade.teacherName;
      details.append(teacher);
    }

    const criteria = document.createElement("div");
    criteria.className = "criteria-row";
    ["A", "B", "C", "D"].forEach((criterion) => {
      const pill = document.createElement("span");
      pill.className = "criterion-pill";
      pill.textContent = `${criterion}:${formatCriterion(classGrade.criteria?.[criterion])}`;
      criteria.append(pill);
    });
    details.append(criteria);

    const meta = document.createElement("div");
    meta.className = "class-meta";
    meta.append(textNode("AVG "));
    meta.append(metaValue(formatNumber(classGrade.classAverage, 1)));
    meta.append(textNode(" GPA "));
    meta.append(metaValue(formatNumber(classGrade.gpa, 2)));

    const ibPill = document.createElement("span");
    ibPill.className = "ib-pill";
    ibPill.textContent = classGrade.isIB ? "IB /7" : "Mastery /8";
    meta.append(ibPill);

    if (classGrade.periodLabel) {
      const periodPill = document.createElement("span");
      periodPill.className = "ib-pill";
      periodPill.textContent = classGrade.periodLabel;
      meta.append(periodPill);
    }

    if (!isIncluded) {
      const excludedPill = document.createElement("span");
      excludedPill.className = "excluded-pill";
      excludedPill.textContent = "Excluded";
      meta.append(excludedPill);
    }

    details.append(meta);

    const controls = document.createElement("div");
    controls.className = "class-toggle";

    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    switchLabel.setAttribute("aria-label", `${isIncluded ? "Exclude" : "Include"} ${classGrade.className}`);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = isIncluded;
    input.addEventListener("change", () => toggleClass(classGrade.classId, input.checked));

    const track = document.createElement("span");
    track.className = "switch-track";

    const thumb = document.createElement("span");
    thumb.className = "switch-thumb";
    track.append(thumb);
    switchLabel.append(input, track);

    const gpaChip = document.createElement("span");
    gpaChip.className = "gpa-chip";
    gpaChip.textContent = formatNumber(classGrade.gpa, 1);

    controls.append(switchLabel, gpaChip);
    card.append(details, controls);
    classList.append(card);
  });
}

function showMessage(message) {
  const trimmed = String(message || "").trim();
  elements.messageBanner.textContent = trimmed;
  elements.messageBanner.classList.toggle("hidden", !trimmed);
}

function setBusy(isBusy, label = "Recalculating") {
  elements.syncButton.disabled = isBusy;
  elements.syncIconButton.disabled = isBusy;
  elements.loginButton.disabled = isBusy;
  elements.compareButton.disabled = isBusy;
  elements.buttonSpinner.classList.toggle("hidden", !isBusy);
  elements.syncButtonText.textContent = isBusy ? label : "Recalculate";
  elements.syncIconButton.classList.toggle("syncing", isBusy);
}

function updateBusyFromStatus(status) {
  const isBusy = status === "syncing" || status === "authenticating";
  setBusy(isBusy, status === "authenticating" ? "Logging in" : "Recalculating");
}

function statusLabel(status) {
  const labels = {
    idle: "Idle",
    online: "Online",
    syncing: "Syncing",
    authenticating: "Logging in",
    error: "Error",
    login_required: "Re-auth needed",
    login_failed: "Login failed",
    needs_credentials: "Needs setup"
  };
  return labels[status] || status.replace(/_/g, " ");
}

function formatDeltaLabel(deltaValue, label) {
  if (typeof deltaValue !== "number" || !Number.isFinite(deltaValue)) return "No comparison";
  const sign = deltaValue > 0 ? "+" : "";
  return `${label} ${sign}${deltaValue.toFixed(2)}`;
}

function formatCriterion(value) {
  return value === null || value === undefined ? "--" : formatNumber(value, 1);
}

function formatNumber(value, digits) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "--";
}

function formatRelativeTime(dateString) {
  const timestamp = new Date(dateString).getTime();
  if (!Number.isFinite(timestamp)) return "recently";

  const diffMs = Date.now() - timestamp;
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours === 1) return "1 hr ago";
  if (hours < 24) return `${hours} hrs ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(dateString));
}

function metaValue(value) {
  const element = document.createElement("span");
  element.className = "mono-value";
  element.textContent = value;
  return element;
}

function textNode(text) {
  return document.createTextNode(text);
}

async function sendRuntimeMessage(message) {
  if (!CHROME_RUNTIME_AVAILABLE) {
    return handlePreviewMessage(message);
  }

  return chrome.runtime.sendMessage(message);
}

async function handlePreviewMessage(message) {
  await delay(220);

  switch (message.type) {
    case "GET_STATE":
      return { ok: true, state: previewState };
    case "SET_EXCLUDED_CLASSES":
      previewState.excludedClassIds = message.classIds || [];
      previewState.summary = calculatePreviewSummary(previewState.classes, previewState.excludedClassIds);
      return { ok: true, state: previewState };
    case "START_LOGIN":
    case "START_SYNC":
    case "START_YEAR_COMPARE":
      previewState.status = "online";
      previewState.lastSync = new Date().toISOString();
      return { ok: true, state: previewState };
    default:
      return { ok: true, state: previewState };
  }
}

function calculatePreviewSummary(classes, excludedClassIds = []) {
  const excluded = new Set(excludedClassIds);
  const included = classes.filter((classGrade) => !excluded.has(classGrade.classId));
  const averages = included.map((classGrade) => classGrade.classAverage).filter(isFiniteNumber);
  const gpas = included.map((classGrade) => classGrade.gpa).filter(isFiniteNumber);

  return {
    totalCount: classes.length,
    includedCount: included.length,
    globalAverage: average(averages),
    globalGpa: average(gpas)
  };
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
