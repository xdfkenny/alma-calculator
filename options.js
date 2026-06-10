const EXTENSION_AVAILABLE = typeof chrome !== "undefined" && chrome.storage?.local;

const previewStore = {
  almaOrigin: "",
  credentials: {
    username: "",
    password: ""
  },
  classes: [
    {
      classId: "math-sl",
      className: "Mathematics SL",
      criteria: { A: 7, B: 6, C: 7, D: 6 },
      isIB: true,
      maxScore: 7,
      classAverage: 6.5
    },
    {
      classId: "tok",
      className: "Theory of Knowledge",
      criteria: { A: 5, B: 5, C: 4, D: 5 },
      isIB: false,
      maxScore: 8,
      classAverage: 4.75
    }
  ],
  excludedClassIds: ["tok"],
  ibOverrides: {},
  targetGpa: 3.5,
  watchAverage: 5
};

const elements = {};
let classes = [];
let excludedClassIds = [];
let ibOverrides = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  wireEvents();
  loadOptions();
});

function cacheElements() {
  [
    "portalForm",
    "almaOriginInput",
    "clearPortalButton",
    "credentialsForm",
    "usernameInput",
    "passwordInput",
    "togglePasswordButton",
    "clearCredentialsButton",
    "goalsForm",
    "targetGpaInput",
    "watchAverageInput",
    "resetGoalsButton",
    "preferenceList",
    "classCountText",
    "resetPreferencesButton",
    "notice",
    "emptyPreferencesTemplate"
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function wireEvents() {
  elements.portalForm.addEventListener("submit", savePortal);
  elements.clearPortalButton.addEventListener("click", clearPortal);
  elements.credentialsForm.addEventListener("submit", saveCredentials);
  elements.clearCredentialsButton.addEventListener("click", clearCredentials);
  elements.togglePasswordButton.addEventListener("click", togglePasswordVisibility);
  elements.goalsForm.addEventListener("submit", saveStudentGoals);
  elements.resetGoalsButton.addEventListener("click", resetStudentGoals);
  elements.resetPreferencesButton.addEventListener("click", resetPreferences);
}

async function loadOptions() {
  const stored = await getStorage([
    "almaOrigin",
    "credentials",
    "classes",
    "excludedClassIds",
    "ibOverrides",
    "targetGpa",
    "watchAverage"
  ]);
  const credentials = stored.credentials || {};
  classes = stored.classes || [];
  excludedClassIds = stored.excludedClassIds || [];
  ibOverrides = stored.ibOverrides || {};

  elements.almaOriginInput.value = stored.almaOrigin || "";
  elements.usernameInput.value = credentials.username || "";
  elements.passwordInput.value = credentials.password || "";
  elements.targetGpaInput.value = formatNumber(clampNumber(stored.targetGpa, 0, 4, previewStore.targetGpa), 1);
  elements.watchAverageInput.value = formatNumber(clampNumber(stored.watchAverage, 0, 8, previewStore.watchAverage), 1);

  renderPreferences();
}

async function savePortal(event) {
  event.preventDefault();
  const almaOrigin = normalizeAlmaOrigin(elements.almaOriginInput.value);

  if (!almaOrigin) {
    showNotice("Enter a valid https://*.getalma.com URL.", true);
    return;
  }

  elements.almaOriginInput.value = almaOrigin;
  await setStorage({ almaOrigin });
  showNotice("Alma portal saved.");
}

async function clearPortal() {
  await setStorage({ almaOrigin: "" });
  elements.almaOriginInput.value = "";
  showNotice("Alma portal cleared.");
}

async function saveCredentials(event) {
  event.preventDefault();
  const credentials = {
    username: elements.usernameInput.value.trim(),
    password: elements.passwordInput.value
  };

  await setStorage({ credentials });
  showNotice("Credentials saved.");
}

async function clearCredentials() {
  await setStorage({
    credentials: {
      username: "",
      password: ""
    }
  });
  elements.usernameInput.value = "";
  elements.passwordInput.value = "";
  showNotice("Credentials cleared.");
}

function togglePasswordVisibility() {
  const isPassword = elements.passwordInput.type === "password";
  elements.passwordInput.type = isPassword ? "text" : "password";
  elements.togglePasswordButton.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
  elements.togglePasswordButton.title = isPassword ? "Hide password" : "Show password";
}

async function saveStudentGoals(event) {
  event.preventDefault();
  const goals = readStudentGoals();

  elements.targetGpaInput.value = formatNumber(goals.targetGpa, 1);
  elements.watchAverageInput.value = formatNumber(goals.watchAverage, 1);

  const response = await saveGoals(goals);
  if (!response.ok) {
    showNotice(response.error || "Could not save academic goals.", true);
    return;
  }

  showNotice("Academic goals saved.");
}

async function resetStudentGoals() {
  const goals = {
    targetGpa: previewStore.targetGpa,
    watchAverage: previewStore.watchAverage
  };

  elements.targetGpaInput.value = formatNumber(goals.targetGpa, 1);
  elements.watchAverageInput.value = formatNumber(goals.watchAverage, 1);

  const response = await saveGoals(goals);
  if (!response.ok) {
    showNotice(response.error || "Could not reset academic goals.", true);
    return;
  }

  showNotice("Academic goals reset.");
}

async function resetPreferences() {
  excludedClassIds = [];
  ibOverrides = {};
  await setStorage({
    excludedClassIds,
    ibOverrides
  });
  renderPreferences();
  showNotice("Class preferences reset.");
}

async function updateExcluded(classId, isExcluded) {
  const excluded = new Set(excludedClassIds);
  if (isExcluded) {
    excluded.add(classId);
  } else {
    excluded.delete(classId);
  }
  excludedClassIds = Array.from(excluded);
  await setStorage({ excludedClassIds });
  showNotice("Class exclusion updated.");
  renderPreferences();
}

function readStudentGoals() {
  return {
    targetGpa: clampNumber(elements.targetGpaInput.value, 0, 4, previewStore.targetGpa),
    watchAverage: clampNumber(elements.watchAverageInput.value, 0, 8, previewStore.watchAverage)
  };
}

async function saveGoals(goals) {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "SET_STUDENT_GOALS",
        goals
      });
      return response || { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || "Could not reach extension background." };
    }
  }

  await setStorage(goals);
  return { ok: true };
}

async function updateIbOverride(classId, value) {
  if (value === "auto") {
    delete ibOverrides[classId];
  } else {
    ibOverrides[classId] = value === "ib";
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    await chrome.runtime.sendMessage({
      type: "SET_IB_OVERRIDE",
      classId,
      value: value === "auto" ? "auto" : value === "ib"
    });
  } else {
    await setStorage({ ibOverrides });
  }

  showNotice("IB override updated.");
  renderPreferences();
}

function renderPreferences() {
  elements.classCountText.textContent = `${classes.length} ${classes.length === 1 ? "class" : "classes"}`;
  elements.preferenceList.innerHTML = "";

  if (!classes.length) {
    elements.preferenceList.append(elements.emptyPreferencesTemplate.content.cloneNode(true));
    return;
  }

  const excluded = new Set(excludedClassIds);

  classes.forEach((classGrade) => {
    const card = document.createElement("article");
    card.className = "preference-card";

    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "preference-title";
    title.textContent = classGrade.className || "Untitled class";
    content.append(title);

    const meta = document.createElement("div");
    meta.className = "preference-meta";
    meta.append(createPill(`AVG ${formatNumber(classGrade.classAverage, 1)}`));
    meta.append(createPill((classGrade.isIB ? "Detected IB" : "Detected /8")));
    if (classGrade.yearLabel) meta.append(createPill(classGrade.yearLabel));
    if (classGrade.periodLabel) meta.append(createPill(classGrade.periodLabel));
    if (excluded.has(classGrade.classId)) meta.append(createPill("Excluded"));
    content.append(meta);

    const controls = document.createElement("div");
    controls.className = "settings-form";

    const excludeLabel = document.createElement("label");
    excludeLabel.className = "field";
    const excludeText = document.createElement("span");
    excludeText.textContent = "Global average";
    const excludeSelect = document.createElement("select");
    excludeSelect.value = excluded.has(classGrade.classId) ? "exclude" : "include";
    excludeSelect.addEventListener("change", () => {
      updateExcluded(classGrade.classId, excludeSelect.value === "exclude");
    });
    excludeSelect.append(
      createOption("include", "Included"),
      createOption("exclude", "Excluded")
    );
    excludeLabel.append(excludeText, excludeSelect);

    const ibLabel = document.createElement("label");
    ibLabel.className = "field";
    const ibText = document.createElement("span");
    ibText.textContent = "Scale";
    const ibSelect = document.createElement("select");
    ibSelect.value = Object.prototype.hasOwnProperty.call(ibOverrides, classGrade.classId)
      ? (ibOverrides[classGrade.classId] ? "ib" : "standard")
      : "auto";
    ibSelect.addEventListener("change", () => updateIbOverride(classGrade.classId, ibSelect.value));
    ibSelect.append(
      createOption("auto", "Auto detect"),
      createOption("ib", "IB /7"),
      createOption("standard", "Mastery /8")
    );
    ibLabel.append(ibText, ibSelect);

    controls.append(excludeLabel, ibLabel);
    card.append(content, controls);
    elements.preferenceList.append(card);
  });
}

function createPill(text) {
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = text;
  return pill;
}

function createOption(value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

function showNotice(message, isError = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("error", isError);
  elements.notice.classList.remove("hidden");
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => {
    elements.notice.classList.add("hidden");
  }, 3200);
}

function formatNumber(value, digits) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "--";
}

function clampNumber(value, min, max, fallback) {
  const numeric = toNullableNumber(value);
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeAlmaOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !(hostname === "getalma.com" || hostname.endsWith(".getalma.com"))) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

function getStorage(keys) {
  if (!EXTENSION_AVAILABLE) {
    return Promise.resolve(Object.fromEntries(keys.map((key) => [key, previewStore[key]])));
  }
  return chrome.storage.local.get(keys);
}

async function setStorage(values) {
  if (!EXTENSION_AVAILABLE) {
    Object.assign(previewStore, values);
    return;
  }
  await chrome.storage.local.set(values);
}
