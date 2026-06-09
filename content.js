(function initAlmaContentScript() {
  if (window.__almaGpaContentLoaded) return;
  window.__almaGpaContentLoaded = true;

  const CLASS_URL_RE = /\/home\/class\/([^/?#]+)/;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleContentMessage(message)
      .then(sendResponse)
      .catch((error) => {
        console.error("Alma GPA content error:", error);
        sendResponse({
          ok: false,
          error: error?.message || "Unexpected Alma page error"
        });
      });
    return true;
  });

  async function handleContentMessage(message) {
    switch (message?.type) {
      case "ALMA_PING":
        return { ok: true, url: location.href };
      case "ALMA_SESSION_STATE":
        return detectSessionState();
      case "ALMA_LOGIN":
        return performLogin(message.credentials || {});
      case "ALMA_DISCOVER_CLASSES":
        return discoverClasses();
      case "ALMA_EXTRACT_CLASS_GRADES":
        return extractClassGrades(message.classInfo || {});
      case "ALMA_DISCOVER_SCHOOL_YEARS":
        return discoverSchoolYears();
      case "ALMA_SELECT_SCHOOL_YEAR":
        return selectSchoolYear(message.year || {});
      default:
        return { ok: false, error: "Unknown content message type" };
    }
  }

  function detectSessionState() {
    const loginRequired = isLoginPage();
    const rateLimited = isRateLimitedPage();
    return {
      ok: true,
      loginRequired,
      rateLimited,
      url: location.href,
      title: document.title
    };
  }

  async function performLogin(credentials) {
    await waitForDocumentReady();

    if (!isLoginPage()) {
      return { ok: true, loginRequired: false, message: "Already authenticated." };
    }

    const usernameInput = findUsernameInput();
    const passwordInput = findPasswordInput();
    const otpInput = findOtpInput();

    if (!usernameInput || !passwordInput) {
      throw new Error("Could not find Alma login fields.");
    }

    if (otpInput && cleanText(otpInput.value)) {
      return {
        ok: false,
        otpRequired: true,
        error: "Alma is asking for a one-time passcode."
      };
    }

    setNativeValue(usernameInput, credentials.username || "");
    setNativeValue(passwordInput, credentials.password || "");

    const submit = findSubmitControl(usernameInput, passwordInput);
    if (!submit) {
      const form = passwordInput.closest("form") || usernameInput.closest("form");
      if (form) {
        form.requestSubmit ? form.requestSubmit() : form.submit();
      } else {
        throw new Error("Could not find Alma login submit button.");
      }
    } else {
      submit.click();
    }

    return { ok: true, loginRequired: true, message: "Login submitted." };
  }

  function discoverClasses() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const classMap = new Map();

    anchors.forEach((anchor) => {
      const absoluteUrl = new URL(anchor.getAttribute("href"), location.origin);
      const identity = parseClassIdentity(absoluteUrl.href);
      if (!identity) return;

      if (!absoluteUrl.searchParams.has("back")) {
        absoluteUrl.searchParams.set("back", "/home/schedule");
      }
      const contextElement = getMeaningfulContextElement(anchor);
      const context = cleanText(contextElement?.innerText || anchor.innerText || "");
      const className = extractClassNameFromContext(contextElement) ||
        extractClassNameFromAnchor(anchor) ||
        extractLikelyClassName(context) ||
        `Class ${identity.routeClassId}`;
      const teacherName = extractTeacherName(contextElement) || extractTeacherName(context);
      const activeYear = detectActiveSchoolYear();

      classMap.set(identity.classId, {
        ...identity,
        className,
        teacherName,
        url: absoluteUrl.href,
        periodLabel: extractPeriodLabel(anchor) || identity.periodLabel,
        yearLabel: activeYear?.label || "",
        yearKey: activeYear?.key || ""
      });
    });

    return {
      ok: true,
      activeYear: detectActiveSchoolYear(),
      classes: Array.from(classMap.values())
    };
  }

  function extractClassGrades(classInfo) {
    if (isRateLimitedPage()) {
      return {
        ok: false,
        rateLimited: true,
        error: "Alma is rate limiting requests."
      };
    }

    const pageText = cleanText(document.body?.innerText || "");
    const title = extractClassTitle(classInfo);
    const masteryRoot = findMasteryRoot() || document.body;
    const masteryText = cleanText(masteryRoot?.innerText || pageText);
    const criteria = extractCriteria(masteryRoot, masteryText);
    const maxScore = detectMaxScore(masteryText, criteria, title);
    const finalMastery = extractFinalMastery(masteryText);

    return {
      ok: true,
      grade: {
        ...parseClassIdentity(location.href),
        classId: classInfo.classId || parseClassIdentity(location.href)?.classId || extractClassIdFromUrl(location.href),
        className: title,
        teacherName: extractTeacherName(document) || classInfo.teacherName || extractTeacherName(pageText),
        url: location.href,
        periodLabel: extractSelectedPeriodLabel() || classInfo.periodLabel || "",
        yearLabel: detectActiveSchoolYear()?.label || classInfo.yearLabel || "",
        yearKey: detectActiveSchoolYear()?.key || classInfo.yearKey || "",
        criteria,
        isIB: /\bIB\b/i.test(`${title} ${masteryText}`) || maxScore === 7,
        maxScore,
        finalMastery
      }
    };
  }

  async function discoverSchoolYears() {
    await openSchoolYearMenu();

    const activeYear = detectActiveSchoolYear();
    const options = Array.from(document.querySelectorAll("a[href], button, [role='menuitem'], li, option"))
      .map((element, index) => {
        const label = extractYearLabel(cleanText(element.textContent || element.getAttribute("aria-label") || ""));
        if (!label) return null;

        const url = element.matches("a[href]")
          ? new URL(element.getAttribute("href"), location.origin).href
          : "";

        return {
          key: yearKey(label, url || String(index)),
          label,
          url,
          index,
          active: activeYear?.label === label || element.matches(".selected, .active, [aria-selected='true']")
        };
      })
      .filter(Boolean);

    const unique = new Map();
    options.forEach((option) => {
      unique.set(option.key, option);
    });

    if (activeYear?.key && !unique.has(activeYear.key)) {
      unique.set(activeYear.key, { ...activeYear, active: true, url: "" });
    }

    return {
      ok: true,
      activeYear,
      years: Array.from(unique.values()).sort(sortYearsDescending)
    };
  }

  async function selectSchoolYear(year) {
    if (year.url) {
      location.href = year.url;
      return { ok: true, navigating: true };
    }

    await openSchoolYearMenu();
    const target = Array.from(document.querySelectorAll("a[href], button, [role='menuitem'], li"))
      .find((element) => {
        const label = extractYearLabel(cleanText(element.textContent || element.getAttribute("aria-label") || ""));
        return label && (label === year.label || yearKey(label) === year.key);
      });

    if (!target) {
      return { ok: false, error: `Could not find school year ${year.label || year.key}.` };
    }

    const clickable = target.closest?.("a, button, [role='button'], [role='menuitem']") ||
      target.querySelector?.("a, button, [role='button'], [role='menuitem']") ||
      target;
    clickable.click();
    return { ok: true, selected: year };
  }

  function isLoginPage() {
    const text = `${document.title} ${document.body?.innerText || ""}`.toLowerCase();
    const hasPassword = Boolean(findPasswordInput());
    const urlLooksLikeLogin = /login|signin|session|account/i.test(location.href);
    const copyLooksLikeLogin = /\blog in\b|\bsign in\b|username|password/i.test(text);
    const authenticatedMarkers = /schedule|classes|attendance|assignments|dashboard/i.test(text) &&
      location.pathname.includes("/home");

    return hasPassword && (urlLooksLikeLogin || copyLooksLikeLogin) && !authenticatedMarkers;
  }

  function isRateLimitedPage() {
    const text = `${document.title} ${document.body?.innerText || ""}`.toLowerCase();
    return /\b429\b|too many requests|rate limit|try again later/i.test(text);
  }

  function findUsernameInput() {
    const selectors = [
      "input[name='username']",
      "input[name='email']",
      "input[id*='user' i]",
      "input[name*='user' i]",
      "input[autocomplete='username']",
      "input[type='email']",
      "input[type='text']"
    ];
    return firstVisible(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))));
  }

  function findPasswordInput() {
    return firstVisible(Array.from(document.querySelectorAll("input[type='password']")));
  }

  function findOtpInput() {
    return firstVisible(Array.from(document.querySelectorAll("input[name='otp'], input[id*='otp' i], input[autocomplete='one-time-code']")));
  }

  function findSubmitControl(usernameInput, passwordInput) {
    const form = passwordInput.closest("form") || usernameInput.closest("form");
    const candidates = [
      ...(form ? Array.from(form.querySelectorAll("button, input[type='submit'], input[type='button']")) : []),
      ...Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button']"))
    ];

    return firstVisible(candidates.filter((element) => {
      const text = cleanText(element.textContent || element.value || element.getAttribute("aria-label") || "");
      const type = (element.getAttribute("type") || "").toLowerCase();
      return type === "submit" || /log in|login|sign in|submit|entrar|iniciar/i.test(text);
    }));
  }

  function findMasteryRoot() {
    const explicitRoots = Array.from(document.querySelectorAll([
      "[class*='mastery' i]",
      "[id*='mastery' i]",
      "[class*='criterion' i]",
      "[id*='criterion' i]",
      "[data-testid*='mastery' i]",
      "[data-testid*='criterion' i]"
    ].join(",")));

    const explicitRoot = explicitRoots.find((element) => {
      const text = cleanText(element.innerText);
      return /mastery|maestr[ií]a|criterion|criterio|criteria/i.test(text) && /\d/.test(text);
    });
    if (explicitRoot) return explicitRoot;

    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading'], .header, .title"));
    const masteryHeading = headings.find((heading) => {
      return /mastery|maestr[ií]a|criteria|criterio|criterion|criterios/i.test(cleanText(heading.textContent));
    });

    if (masteryHeading) {
      return climbToDenseRegion(masteryHeading);
    }

    const allElements = Array.from(document.querySelectorAll("section, article, main, table, [role='table'], [class*='mastery' i], [id*='mastery' i]"));
    return allElements.find((element) => {
      const text = cleanText(element.innerText);
      return /mastery|maestr[ií]a|criterion|criterio/i.test(text) && /(^|\b)[ABCD](\b|:)/.test(text);
    });
  }

  function extractCriteria(root, fallbackText) {
    const criteria = { A: null, B: null, C: null, D: null };

    extractMasteryLevelColumn(root, criteria);
    extractFromTables(root, criteria);
    extractFromNearbyText(root, criteria);
    extractFromText(fallbackText, criteria);

    return criteria;
  }

  function extractMasteryLevelColumn(root, criteria) {
    const tables = Array.from(root.querySelectorAll("table.gradebook-proficiency, table.gradebook, table"));

    tables.forEach((table) => {
      const headerCells = Array.from(table.querySelectorAll("thead tr:last-child th, thead tr:last-child td"));
      const masteryIndex = headerCells.findIndex((cell) => /mastery\s*level|nivel\s*de\s*maestr/i.test(cleanText(cell.textContent)));
      if (masteryIndex < 0) return;

      const rows = Array.from(table.querySelectorAll("tbody tr"));
      rows.forEach((row) => {
        const rowHeader = cleanText(row.querySelector("th, [scope='row']")?.textContent || "");
        const criterion = detectCriterionLabel(rowHeader);
        if (!criterion || criteria[criterion] !== null) return;

        const cells = Array.from(row.children);
        const masteryCell = cells[masteryIndex] || Array.from(row.querySelectorAll("td")).at(-1);
        const masteryValue = extractCellScore(masteryCell);

        if (masteryValue !== null) {
          criteria[criterion] = masteryValue;
        }
      });
    });
  }

  function extractFromTables(root, criteria) {
    const rows = Array.from(root.querySelectorAll("tr, [role='row']"));
    rows.forEach((row) => {
      if (isMasteryLevelTable(row.closest("table"))) return;
      const cells = Array.from(row.querySelectorAll("th, td, [role='cell'], [role='columnheader']"));
      if (!cells.length) return;
      const rowText = cleanText(row.innerText);
      const criterion = detectCriterionLabel(rowText);
      if (!criterion || criteria[criterion] !== null) return;
      criteria[criterion] = extractBestScore(rowText);
    });

    const grids = Array.from(root.querySelectorAll("[class*='criteria' i], [class*='criterion' i], [class*='mastery' i], [data-testid*='criterion' i], [aria-label*='criterion' i], [aria-label*='mastery' i]"));
    grids.forEach((element) => {
      const text = cleanText(element.innerText);
      const criterion = detectCriterionLabel(text);
      if (!criterion || criteria[criterion] !== null) return;
      criteria[criterion] = extractBestScore(text);
    });
  }

  function extractFromNearbyText(root, criteria) {
    const leafElements = Array.from(root.querySelectorAll("span, div, p, li, strong, em, label, dt, dd"));
    leafElements.forEach((element) => {
      if (isMasteryLevelTable(element.closest("table"))) return;
      const label = detectCriterionLabel(cleanText(element.textContent));
      if (!label || criteria[label] !== null) return;

      const neighborhood = cleanText([
        element.textContent,
        element.nextElementSibling?.textContent,
        element.parentElement?.textContent
      ].join(" "));

      criteria[label] = extractBestScore(neighborhood);
    });
  }

  function extractFromText(text, criteria) {
    ["A", "B", "C", "D"].forEach((criterion) => {
      if (criteria[criterion] !== null) return;
      const patterns = [
        new RegExp(`(?:criterion|criteria|criterio)\\s*${criterion}\\b[^\\d]*(\\d+(?:[.,]\\d+)?)\\s*(?:\\/\\s*(7|8))?`, "i"),
        new RegExp(`\\b${criterion}\\s*[\\-–:]\\s*[^\\d]{0,60}(\\d+(?:[.,]\\d+)?)\\s*(?:\\/\\s*(7|8))?`, "i"),
        new RegExp(`\\b${criterion}\\s*[:\\-–]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:\\/\\s*(7|8))?`, "i")
      ];
      const match = patterns.map((pattern) => text.match(pattern)).find(Boolean);
      criteria[criterion] = match ? toNullableNumber(match[1]) : null;
    });
  }

  function detectCriterionLabel(text) {
    const clean = cleanText(text);
    const match = clean.match(/(?:criterion|criteria|criterio)\s*([ABCD])\b/i) ||
      clean.match(/\b([ABCD])\s*[-–]\s*[A-ZÁÉÍÓÚÑ]/i) ||
      clean.match(/\b([ABCD])\s*[:\-–]\s*(?:\d|score|grade|nota)/i) ||
      clean.match(/^([ABCD])$/i);
    return match ? match[1].toUpperCase() : null;
  }

  function extractBestScore(text) {
    const clean = cleanText(text);
    const fraction = clean.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(7|8)\b/);
    if (fraction) return toNullableNumber(fraction[1]);

    const labels = [
      /(?:grade|score|nota|mark|current|actual|mastery)[^\d]*(\d+(?:[.,]\d+)?)/i,
      /(?:^|\s)(\d+(?:[.,]\d+)?)(?:\s|$)/
    ];

    for (const pattern of labels) {
      const match = clean.match(pattern);
      if (match) {
        const value = toNullableNumber(match[1]);
        if (value !== null && value >= 0 && value <= 8) return value;
      }
    }

    return null;
  }

  function extractCellScore(cell) {
    if (!cell) return null;
    const text = cleanText(cell.textContent);
    if (!text || text === "-") return null;
    const value = toNullableNumber(text);
    return value !== null && value >= 0 && value <= 8 ? value : null;
  }

  function isMasteryLevelTable(table) {
    if (!table) return false;
    if (table.matches("table.gradebook-proficiency")) return true;
    return Array.from(table.querySelectorAll("thead th, thead td"))
      .some((cell) => /mastery\s*level|nivel\s*de\s*maestr/i.test(cleanText(cell.textContent)));
  }

  function detectMaxScore(text, criteria, title) {
    const combined = `${title} ${text}`;
    if (/\bIB\b/i.test(combined) || /\/\s*7\b/.test(combined)) return 7;
    if (/\/\s*8\b/.test(combined)) return 8;

    const scores = Object.values(criteria).filter((value) => typeof value === "number");
    if (scores.some((value) => value > 7)) return 8;
    return 8;
  }

  function extractFinalMastery(text) {
    const patterns = [
      /(?:final|overall|current|promedio|average|mastery)[^\d]*(\d+(?:[.,]\d+)?)(?:\s*\/\s*(?:7|8))?/i,
      /(?:maestr[ií]a|progreso|actual)[^\d]*(\d+(?:[.,]\d+)?)(?:\s*\/\s*(?:7|8))?/i,
      /(?:grade|nota)\s*final[^\d]*(\d+(?:[.,]\d+)?)/i
    ];
    const match = patterns.map((pattern) => text.match(pattern)).find(Boolean);
    return match ? toNullableNumber(match[1]) : null;
  }

  function extractClassTitle(classInfo) {
    const almaHeaderTitle = extractClassNameFromContext(document);
    if (almaHeaderTitle) return almaHeaderTitle;

    const heading = Array.from(document.querySelectorAll("h1, h2, h3, [role='heading']"))
      .map((element) => cleanText(element.textContent))
      .find(isUsableClassName);

    return heading || classInfo.className || "Untitled class";
  }

  function extractPeriodLabel(anchor) {
    const text = cleanText(anchor?.textContent);
    if (/^(S\d|Q\d|T\d|P\d)$/i.test(text)) return text.toUpperCase();
    const match = String(anchor?.href || "").match(/[?&]period=([^&#]+)/);
    return match ? "Period" : "";
  }

  function extractSelectedPeriodLabel() {
    const selected = cleanText(document.querySelector(".sc-tabmenu .pure-menu-selected a, .sc-tabmenu [aria-selected='true']")?.textContent);
    if (selected) return selected;
    const identity = parseClassIdentity(location.href);
    return identity?.periodLabel || "";
  }

  function extractClassNameFromContext(contextElement) {
    if (!contextElement?.querySelector) return "";

    const selectors = [
      ".class-header h3",
      ".class-header h2",
      ".class-header h1",
      "header.class-header h3",
      "header.class-header h2",
      "header.class-header h1",
      "[class*='class-header' i] h3",
      "[class*='class-header' i] h2",
      "[class*='class-header' i] h1"
    ];

    for (const selector of selectors) {
      const title = cleanText(contextElement.querySelector(selector)?.textContent);
      if (isUsableClassName(title)) return title;
    }

    return "";
  }

  function extractClassNameFromAnchor(anchor) {
    const text = cleanText(anchor?.textContent);
    return isUsableClassName(text) ? text : "";
  }

  function extractLikelyClassName(text) {
    const lines = String(text).split(/\n+/).map(cleanText).filter(Boolean);
    return lines.find(isUsableClassName) || "";
  }

  function isUsableClassName(text) {
    const clean = cleanText(text);
    return clean.length > 2 &&
      !/^(S\d|Q\d|T\d|P\d|semester \d|announcements?|students?|send message|message|roster)$/i.test(clean) &&
      !/mastery|maestr[ií]a|dashboard|teacher|profesor|room|period|schedule|view|open|criteria|criterio/i.test(clean) &&
      !/^\d/.test(clean);
  }

  function extractTeacherName(source) {
    if (source?.querySelector) {
      const teacher = cleanText(source.querySelector(".class-header .teacher .fn, .teacher .fn, .class-meta .teacher .fn")?.textContent);
      if (teacher) return teacher;
    }

    const clean = cleanText(source?.innerText || source);
    const match = clean.match(/(?:teacher|professor|profesor(?:a)?|instructor)\s*:?\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ.' -]{2,80})/i);
    if (match) return cleanText(match[1]).replace(/\s{2,}.*/, "");
    return "";
  }

  function getMeaningfulContextElement(anchor) {
    return anchor.closest("header.class-header, [class*='class-header' i], tr, li, article, section, [role='row'], [class*='class' i], [class*='course' i], [class*='schedule' i]") ||
      anchor.parentElement;
  }

  function parseClassIdentity(url) {
    const parsed = new URL(String(url), location.origin);
    const match = parsed.pathname.match(CLASS_URL_RE);
    if (!match) return null;

    const routeClassId = match[1];
    const periodId = parsed.searchParams.get("period") || "";
    return {
      classId: periodId ? `${routeClassId}:${periodId}` : routeClassId,
      routeClassId,
      periodId,
      periodLabel: periodId ? "Period" : ""
    };
  }

  function climbToDenseRegion(element) {
    let current = element;
    for (let i = 0; i < 4 && current?.parentElement; i += 1) {
      current = current.parentElement;
      const text = cleanText(current.innerText);
      if (text.length > 80 && /[ABCD]/.test(text) && /\d/.test(text)) {
        return current;
      }
    }
    return element.parentElement || element;
  }

  function extractClassIdFromUrl(url) {
    const match = String(url).match(CLASS_URL_RE);
    return match ? match[1] : String(url);
  }

  async function openSchoolYearMenu() {
    const trigger = findSchoolYearSwitcher();
    if (trigger) {
      trigger.click();
      await delay(350);
    }
  }

  function findSchoolYearSwitcher() {
    const selectors = [
      "[aria-label*='Switch school years' i]",
      "[aria-label*='school year' i]",
      "a.pure-menu-link[href='#'] .fa-exchange-alt",
      "a.pure-menu-link[href='#'] .fas.fa-exchange-alt",
      ".fa-exchange-alt",
      ".fas.fa-exchange-alt"
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const trigger = node?.closest?.("a, button, [role='button']") || node;
      if (trigger && firstVisible([trigger])) return trigger;
    }

    return Array.from(document.querySelectorAll("a, button, [role='button']"))
      .find((element) => /school year|año escolar|academic year/i.test(cleanText(element.textContent || element.getAttribute("aria-label") || "")));
  }

  function detectActiveSchoolYear() {
    const candidates = [
      ".school-year .selected",
      ".schoolyear .selected",
      "[class*='school-year' i] .selected",
      "[class*='schoolyear' i] .selected",
      "[aria-label*='school year' i]",
      "[aria-label*='Switch school years' i]"
    ];

    for (const selector of candidates) {
      const label = extractYearLabel(cleanText(document.querySelector(selector)?.textContent || document.querySelector(selector)?.getAttribute?.("aria-label") || ""));
      if (label) return { key: yearKey(label), label };
    }

    const bodyMatch = cleanText(document.body?.innerText || "").match(/\b(20\d{2}\s*[-–/]\s*(?:20)?\d{2})\b/);
    if (bodyMatch) {
      const label = normalizeYearLabel(bodyMatch[1]);
      return { key: yearKey(label), label };
    }

    const fallback = new Date().getMonth() >= 6
      ? `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(-2)}`
      : `${new Date().getFullYear() - 1}-${String(new Date().getFullYear()).slice(-2)}`;
    return { key: yearKey(fallback), label: fallback };
  }

  function extractYearLabel(text) {
    const match = cleanText(text).match(/\b(20\d{2})\s*[-–/]\s*((?:20)?\d{2})\b/);
    return match ? normalizeYearLabel(`${match[1]}-${match[2]}`) : "";
  }

  function normalizeYearLabel(label) {
    const match = cleanText(label).match(/\b(20\d{2})\s*[-–/]\s*((?:20)?\d{2})\b/);
    if (!match) return cleanText(label);
    const end = match[2].length === 2 ? match[2] : match[2].slice(-2);
    return `${match[1]}-${end}`;
  }

  function yearKey(label, fallback = "") {
    const normalized = normalizeYearLabel(label || fallback);
    return normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "current-year";
  }

  function sortYearsDescending(a, b) {
    return parseInt((b.label || "").slice(0, 4), 10) - parseInt((a.label || "").slice(0, 4), 10);
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim();
  }

  function toNullableNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const match = String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const numeric = Number(match[0]);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function firstVisible(elements) {
    return elements.find((element) => {
      if (!element || element.disabled) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none";
    });
  }

  function setNativeValue(input, value) {
    input.focus();
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set ? descriptor.set.call(input, value) : input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function waitForDocumentReady() {
    if (document.readyState !== "loading") return Promise.resolve();
    return new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
