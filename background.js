const SCRAPE_DELAY_MS = 800;
const LOGIN_TIMEOUT_MS = 15000;
const PAGE_LOAD_TIMEOUT_MS = 12000;

const DEFAULT_STATE = {
  classes: [],
  activeYear: null,
  yearSnapshots: {},
  yearOrder: [],
  almaOrigin: "",
  excludedClassIds: [],
  ibOverrides: {},
  lastSync: null,
  status: "idle",
  error: "",
  loginRequired: false
};

let activeSync = null;

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await getStorage(["classes", "excludedClassIds", "ibOverrides", "status", "yearSnapshots", "yearOrder"]);
  await chrome.storage.local.set({
    excludedClassIds: existing.excludedClassIds || [],
    ibOverrides: existing.ibOverrides || {},
    status: existing.status || "idle",
    yearSnapshots: existing.yearSnapshots || {},
    yearOrder: existing.yearOrder || []
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("Alma GPA background error:", error);
      sendResponse({
        ok: false,
        error: error?.message || "Unexpected background error"
      });
    });
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATE":
      return { ok: true, state: await buildState() };
    case "START_LOGIN":
      return startLoginFlow();
    case "START_SYNC":
      return startSyncFlow();
    case "START_YEAR_COMPARE":
      return startYearCompareFlow();
    case "OPEN_ALMA":
      return openConfiguredAlmaHome();
    case "SET_EXCLUDED_CLASSES":
      await chrome.storage.local.set({
        excludedClassIds: Array.isArray(message.classIds) ? message.classIds : []
      });
      return { ok: true, state: await buildState() };
    case "SET_IB_OVERRIDE":
      return setIbOverride(message.classId, message.value);
    default:
      return { ok: false, error: "Unknown message type" };
  }
}

async function buildState() {
  const stored = await getStorage(Object.keys(DEFAULT_STATE));
  const state = { ...DEFAULT_STATE, ...stored };
  state.classes = (state.classes || []).map((classGrade) => withDerivedGrades(classGrade, state.ibOverrides));
  state.summary = calculateSummary(state.classes, state.excludedClassIds);
  state.yearSnapshots = deriveYearSnapshots(state.yearSnapshots || {}, state.ibOverrides, state.excludedClassIds);
  state.yearComparison = calculateYearComparison(state.yearSnapshots, state.yearOrder, state.activeYear);
  return state;
}

async function startLoginFlow() {
  await setStatus("authenticating", "");
  const almaOrigin = await getAlmaOrigin();
  const tab = await openOrReuseAlmaTab(`${almaOrigin}/`, almaOrigin);
  const credentials = await getCredentials();

  if (!credentials.username || !credentials.password) {
    await setStatus("needs_credentials", "Add Alma credentials in options first.");
    return { ok: false, error: "Credentials are missing. Open Options and save them first." };
  }

  try {
    await waitForTabLoad(tab.id);
    await sendToTab(tab.id, {
      type: "ALMA_LOGIN",
      credentials
    });
    await waitForAuthenticated(tab.id);
    await setStatus("online", "");
    await chrome.storage.local.set({ loginRequired: false });
    return { ok: true, state: await buildState() };
  } catch (error) {
    await setStatus("login_failed", error?.message || "Login failed.");
    await chrome.storage.local.set({ loginRequired: true });
    return { ok: false, error: error?.message || "Login failed." };
  }
}

async function startSyncFlow() {
  if (activeSync) {
    return activeSync;
  }

  activeSync = runSyncFlow()
    .finally(() => {
      activeSync = null;
    });

  return activeSync;
}

async function startYearCompareFlow() {
  if (activeSync) {
    return activeSync;
  }

  activeSync = runYearCompareFlow()
    .finally(() => {
      activeSync = null;
    });

  return activeSync;
}

async function runSyncFlow() {
  await setStatus("syncing", "");
  const almaOrigin = await getAlmaOrigin();
  const scheduleUrl = `${almaOrigin}/home/schedule`;
  const tab = await openOrReuseAlmaTab(scheduleUrl, almaOrigin);

  try {
    await waitForTabLoad(tab.id);
    let session = await sendToTab(tab.id, { type: "ALMA_SESSION_STATE" });

    if (session.loginRequired) {
      const login = await startLoginFlow();
      if (!login.ok) return login;
      await navigateTab(tab.id, scheduleUrl);
    }

    const snapshot = await scrapeScheduleSnapshot(tab.id);
    const classes = snapshot.classes;

    const now = new Date().toISOString();
    const snapshotKey = snapshot.year?.key || "current-year";
    const stored = await getStorage(["yearSnapshots", "yearOrder"]);
    const yearSnapshots = {
      ...(stored.yearSnapshots || {}),
      [snapshotKey]: {
        ...snapshot,
        syncedAt: now
      }
    };
    const yearOrder = mergeYearOrder(stored.yearOrder || [], [snapshot.year]);

    await chrome.storage.local.set({
      classes,
      activeYear: snapshot.year,
      yearSnapshots,
      yearOrder,
      lastSync: now,
      status: "online",
      error: "",
      loginRequired: false
    });

    chrome.runtime.sendMessage({ type: "SYNC_UPDATED" }).catch(() => {});
    return { ok: true, state: await buildState() };
  } catch (error) {
    const isLoginError = /log in|login|session/i.test(error?.message || "");
    await chrome.storage.local.set({
      status: isLoginError ? "login_required" : "error",
      error: error?.message || "Sync failed.",
      loginRequired: isLoginError
    });
    return { ok: false, error: error?.message || "Sync failed.", state: await buildState() };
  }
}

async function runYearCompareFlow() {
  await setStatus("syncing", "");
  const almaOrigin = await getAlmaOrigin();
  const scheduleUrl = `${almaOrigin}/home/schedule`;
  const tab = await openOrReuseAlmaTab(scheduleUrl, almaOrigin);

  try {
    await waitForTabLoad(tab.id);
    let session = await sendToTab(tab.id, { type: "ALMA_SESSION_STATE" });

    if (session.loginRequired) {
      const login = await startLoginFlow();
      if (!login.ok) return login;
      await navigateTab(tab.id, scheduleUrl);
    }

    const yearsResponse = await sendToTab(tab.id, { type: "ALMA_DISCOVER_SCHOOL_YEARS" });
    const years = (yearsResponse.years || []).slice(0, 5);
    const activeYear = yearsResponse.activeYear || years.find((year) => year.active) || null;
    const targets = years.length ? years : [activeYear || { key: "current-year", label: "Current year" }];
    const snapshots = {};
    const now = new Date().toISOString();

    for (const year of targets) {
      if (year && activeYear && year.key !== activeYear.key) {
        const selected = await sendToTab(tab.id, { type: "ALMA_SELECT_SCHOOL_YEAR", year });
        if (selected.ok) {
          await waitForTabLoad(tab.id).catch(() => delay(1200));
          await navigateTab(tab.id, scheduleUrl);
        }
      } else {
        await navigateTab(tab.id, scheduleUrl);
      }

      const snapshot = await scrapeScheduleSnapshot(tab.id, year);
      const key = snapshot.year?.key || year?.key || "current-year";
      snapshots[key] = {
        ...snapshot,
        syncedAt: now
      };
    }

    if (activeYear?.key) {
      const selected = await sendToTab(tab.id, { type: "ALMA_SELECT_SCHOOL_YEAR", year: activeYear }).catch(() => null);
      if (selected?.ok) {
        await waitForTabLoad(tab.id).catch(() => delay(1200));
      }
      await navigateTab(tab.id, scheduleUrl).catch(() => {});
    }

    const currentKey = activeYear?.key || Object.keys(snapshots)[0];
    const currentSnapshot = snapshots[currentKey] || Object.values(snapshots)[0] || { classes: [], year: activeYear };
    await chrome.storage.local.set({
      classes: currentSnapshot.classes || [],
      activeYear: currentSnapshot.year || activeYear,
      yearSnapshots: snapshots,
      yearOrder: mergeYearOrder([], Object.values(snapshots).map((snapshot) => snapshot.year)),
      lastSync: now,
      status: "online",
      error: "",
      loginRequired: false
    });

    chrome.runtime.sendMessage({ type: "SYNC_UPDATED" }).catch(() => {});
    return { ok: true, state: await buildState() };
  } catch (error) {
    const isLoginError = /log in|login|session/i.test(error?.message || "");
    await chrome.storage.local.set({
      status: isLoginError ? "login_required" : "error",
      error: error?.message || "Year comparison sync failed.",
      loginRequired: isLoginError
    });
    return { ok: false, error: error?.message || "Year comparison sync failed.", state: await buildState() };
  }
}

async function scrapeScheduleSnapshot(tabId, preferredYear = null) {
  const discovery = await sendToTab(tabId, { type: "ALMA_DISCOVER_CLASSES" });
  if (!discovery.ok) {
    throw new Error(discovery.error || "Could not discover classes.");
  }

  const classes = [];
  const discoveredClasses = discovery.classes || [];
  const year = normalizeYear(discovery.activeYear || preferredYear);

  for (const classInfo of discoveredClasses) {
    const gradeResponse = await scrapeClassWithRetry(tabId, {
      ...classInfo,
      yearKey: year.key,
      yearLabel: year.label
    });
    classes.push(normalizeClassGrade({
      ...classInfo,
      yearKey: year.key,
      yearLabel: year.label,
      ...(gradeResponse.grade || {})
    }));
  }

  return {
    year,
    classes,
    summary: calculateSummary(classes.map((classGrade) => withDerivedGrades(classGrade, {})), [])
  };
}

async function scrapeClassWithRetry(tabId, classInfo) {
  const attempts = [SCRAPE_DELAY_MS, 3000];

  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    await delay(attempts[attempt]);
    await navigateTab(tabId, classInfo.url);
    const detailSession = await sendToTab(tabId, { type: "ALMA_SESSION_STATE" });

    if (detailSession.loginRequired) {
      throw new Error("Alma session expired. Please log in again.");
    }

    if (detailSession.rateLimited && attempt < attempts.length - 1) {
      continue;
    }

    const gradeResponse = await sendToTab(tabId, {
      type: "ALMA_EXTRACT_CLASS_GRADES",
      classInfo
    });

    if (!gradeResponse.ok) {
      if (gradeResponse.rateLimited && attempt < attempts.length - 1) {
        continue;
      }
      throw new Error(gradeResponse.error || "Could not extract Alma class grades.");
    }

    return gradeResponse;
  }

  throw new Error("Alma rate limit is still active. Try refreshing again in a moment.");
}

async function setIbOverride(classId, value) {
  const { ibOverrides = {} } = await getStorage(["ibOverrides"]);
  const next = { ...ibOverrides };

  if (!classId) {
    return { ok: false, error: "Missing class id." };
  }

  if (value === "auto" || value === null || value === undefined) {
    delete next[classId];
  } else {
    next[classId] = Boolean(value);
  }

  await chrome.storage.local.set({ ibOverrides: next });
  return { ok: true, state: await buildState() };
}

async function openConfiguredAlmaHome() {
  const almaOrigin = await getAlmaOrigin();
  const tab = await openOrReuseAlmaTab(`${almaOrigin}/`, almaOrigin);
  return { ok: true, tabId: tab.id };
}

async function openOrReuseAlmaTab(url, almaOrigin = "") {
  const origin = almaOrigin || new URL(url).origin;
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const activeAlmaTab = tabs.find((tab) => tab.active) || tabs[0];

  if (activeAlmaTab?.id) {
    await chrome.tabs.update(activeAlmaTab.id, { active: true, url });
    await waitForTabLoad(activeAlmaTab.id);
    return chrome.tabs.get(activeAlmaTab.id);
  }

  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabLoad(tab.id);
  return chrome.tabs.get(tab.id);
}

async function navigateTab(tabId, url) {
  await chrome.tabs.update(tabId, { url, active: false });
  await waitForTabLoad(tabId);
  await ensureContentReady(tabId);
}

async function waitForTabLoad(tabId, timeout = PAGE_LOAD_TIMEOUT_MS) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    await ensureContentReady(tabId);
    return tab;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for Alma to load."));
    }, timeout);

    function listener(updatedTabId, changeInfo, updatedTab) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        ensureContentReady(tabId)
          .then(() => resolve(updatedTab))
          .catch(reject);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureContentReady(tabId) {
  try {
    await sendToTab(tabId, { type: "ALMA_PING" }, 2500);
  } catch {
    const [{ result: alreadyLoaded } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__almaGpaContentLoaded)
    });

    if (!alreadyLoaded) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
    }
    await sendToTab(tabId, { type: "ALMA_PING" }, 2500);
  }
}

async function waitForAuthenticated(tabId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
    await delay(500);
    const session = await sendToTab(tabId, { type: "ALMA_SESSION_STATE" }).catch(() => null);
    if (session && !session.loginRequired) {
      return true;
    }
  }

  throw new Error("Login did not complete before timeout.");
}

function sendToTab(tabId, message, timeout = PAGE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Alma page did not respond.")), timeout);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response || {});
    });
  });
}

async function getCredentials() {
  const { credentials = {} } = await getStorage(["credentials"]);
  return {
    username: credentials.username || "",
    password: credentials.password || ""
  };
}

async function getAlmaOrigin() {
  const { almaOrigin = "" } = await getStorage(["almaOrigin"]);
  const normalized = normalizeAlmaOrigin(almaOrigin);
  if (!normalized) {
    throw new Error("Add your Alma URL in options first.");
  }
  return normalized;
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
  return chrome.storage.local.get(keys);
}

async function setStatus(status, error) {
  await chrome.storage.local.set({ status, error });
  chrome.runtime.sendMessage({ type: "SYNC_UPDATED" }).catch(() => {});
}

function normalizeClassGrade(classGrade) {
  const criteria = normalizeCriteria(classGrade.criteria);
  const visibleScores = Object.values(criteria).filter(isFiniteNumber);
  const maxScore = classGrade.maxScore === 7 || detectMaxScore(classGrade) === 7 ? 7 : 8;
  const isIB = Boolean(classGrade.isIB || maxScore === 7);
  const classAverage = visibleScores.length
    ? visibleScores.reduce((sum, score) => sum + score, 0) / visibleScores.length
    : null;

  return {
    classId: String(classGrade.classId || classGrade.url || crypto.randomUUID()),
    routeClassId: classGrade.routeClassId || "",
    periodId: classGrade.periodId || "",
    periodLabel: classGrade.periodLabel || "",
    yearKey: classGrade.yearKey || "",
    yearLabel: classGrade.yearLabel || "",
    className: classGrade.className || "Untitled class",
    teacherName: classGrade.teacherName || "",
    url: classGrade.url || "",
    criteria,
    isIB,
    maxScore,
    finalMastery: toNullableNumber(classGrade.finalMastery),
    classAverage
  };
}

function normalizeCriteria(criteria = {}) {
  return ["A", "B", "C", "D"].reduce((result, key) => {
    result[key] = toNullableNumber(criteria[key]);
    return result;
  }, {});
}

function detectMaxScore(classGrade) {
  const text = [
    classGrade.className,
    classGrade.teacherName,
    classGrade.maxScore,
    classGrade.finalMastery,
    ...Object.values(classGrade.criteria || {})
  ].join(" ");

  if (/\bIB\b/i.test(text) || /\b\/\s*7\b/.test(text)) return 7;
  return 8;
}

function withDerivedGrades(classGrade, ibOverrides = {}) {
  const normalized = normalizeClassGrade(classGrade);
  if (Object.prototype.hasOwnProperty.call(ibOverrides, normalized.classId)) {
    normalized.isIB = Boolean(ibOverrides[normalized.classId]);
    normalized.maxScore = normalized.isIB ? 7 : 8;
  }
  normalized.gpa = normalized.classAverage === null
    ? null
    : masteryToGpa(normalized.classAverage, normalized.maxScore);
  return normalized;
}

function calculateSummary(classes, excludedClassIds = []) {
  const excluded = new Set(excludedClassIds);
  const included = classes.filter((classGrade) => {
    return !excluded.has(classGrade.classId) && classGrade.classAverage !== null;
  });

  if (!included.length) {
    return {
      includedCount: 0,
      totalCount: classes.length,
      globalAverage: null,
      globalGpa: null
    };
  }

  const globalAverage = average(included.map((classGrade) => classGrade.classAverage));
  const globalGpa = average(included.map((classGrade) => classGrade.gpa).filter(isFiniteNumber));

  return {
    includedCount: included.length,
    totalCount: classes.length,
    globalAverage,
    globalGpa
  };
}

function deriveYearSnapshots(yearSnapshots, ibOverrides, excludedClassIds) {
  return Object.fromEntries(Object.entries(yearSnapshots).map(([key, snapshot]) => {
    const classes = (snapshot.classes || []).map((classGrade) => withDerivedGrades(classGrade, ibOverrides));
    return [
      key,
      {
        ...snapshot,
        classes,
        summary: calculateSummary(classes, excludedClassIds)
      }
    ];
  }));
}

function calculateYearComparison(yearSnapshots, yearOrder = [], activeYear = null) {
  const orderedKeys = yearOrder
    .map((year) => year?.key)
    .filter((key) => key && yearSnapshots[key]);

  Object.keys(yearSnapshots).forEach((key) => {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  });

  const rows = orderedKeys.map((key) => {
    const snapshot = yearSnapshots[key];
    return {
      key,
      label: snapshot.year?.label || key,
      syncedAt: snapshot.syncedAt || "",
      summary: snapshot.summary || calculateSummary(snapshot.classes || []),
      active: activeYear?.key === key
    };
  });

  const currentIndex = rows.findIndex((row) => row.active);
  const current = currentIndex >= 0 ? rows[currentIndex] : rows[0] || null;
  const previous = currentIndex >= 0 ? rows[currentIndex + 1] : rows[1] || null;

  return {
    rows,
    current,
    previous,
    averageDelta: delta(current?.summary?.globalAverage, previous?.summary?.globalAverage),
    gpaDelta: delta(current?.summary?.globalGpa, previous?.summary?.globalGpa)
  };
}

function mergeYearOrder(existing, years) {
  const byKey = new Map();
  [...existing, ...years].filter(Boolean).forEach((year) => {
    const normalized = normalizeYear(year);
    byKey.set(normalized.key, normalized);
  });

  return Array.from(byKey.values()).sort((a, b) => {
    return parseInt((b.label || "").slice(0, 4), 10) - parseInt((a.label || "").slice(0, 4), 10);
  });
}

function normalizeYear(year) {
  if (year?.key && year?.label) return year;
  const label = year?.label || inferCurrentSchoolYear();
  return {
    key: year?.key || label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "current-year",
    label
  };
}

function inferCurrentSchoolYear() {
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function delta(current, previous) {
  return isFiniteNumber(current) && isFiniteNumber(previous) ? current - previous : null;
}

function masteryToGpa(score, maxScore) {
  if (!isFiniteNumber(score) || !isFiniteNumber(maxScore) || maxScore <= 0) return null;
  const ratio = score / maxScore;
  if (ratio >= 0.875) return 4.0;
  if (ratio >= 0.75) return 3.5;
  if (ratio >= 0.625) return 3.0;
  if (ratio >= 0.5) return 2.5;
  if (ratio >= 0.375) return 2.0;
  if (ratio >= 0.25) return 1.5;
  if (ratio >= 0.125) return 1.0;
  return 0.0;
}

function average(values) {
  const numeric = values.filter(isFiniteNumber);
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
