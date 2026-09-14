import { matchStructuredAttendanceRows, mergePortalAttendance } from "./reconciliation-core.js";

const RECONCILIATION_VERSION = 2;
let running = false;

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recentDates(count = 7) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const result = [];
  for (let offset = Math.max(1, Number(count) || 7); offset >= 0; offset -= 1) {
    const value = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12);
    result.push({
      iso: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`,
      key: `${value.getDate()}_${months[value.getMonth()]}_${String(value.getFullYear()).slice(-2)}`,
      day: value.toLocaleDateString("en-US", { weekday: "long" })
    });
  }
  return result;
}

async function waitForLoaded(tabId, timeoutMs = 22000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === "complete") {
    await pause(650);
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("页面加载超时"));
    }, timeoutMs);
    const listener = (updatedId, info) => {
      if (updatedId !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(resolve, 650);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function runOnPage(url, func, args = [], attempts = 2) {
  const exact = (await chrome.tabs.query({})).find((tab) => tab.url === url);
  const tab = exact || await chrome.tabs.create({ url, active: false });
  const owned = !exact;
  try {
    await waitForLoaded(tab.id);
    let value = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt) await pause(700);
      const response = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
      value = response?.[0]?.result ?? null;
      if (value?.ready !== false) break;
    }
    return { ok: true, value, url: tab.url || url };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), url };
  } finally {
    if (owned && tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function extractAttendanceRows(targetDateKey) {
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const courseRe = /\b[A-Z]{3}\d{4}\b/i;
  const typeRe = /\b(workshop|tutorial|studio|applied(?:\s+class)?|practical|laboratory|lab|seminar)\b\s*0*(\d{1,2})?/i;
  const timeRe = /\b\d{1,2}:\d{2}\s*[ap]m\b/i;
  const visible = (node) => {
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && (node.getClientRects().length > 0 || node.offsetWidth > 0 || node.offsetHeight > 0);
  };
  const sessions = [];
  const seen = new Set();

  const parseCard = (root, completedHint = false, entryHref = "") => {
    if (!root || !visible(root)) return;
    const text = compact(root.innerText || root.textContent);
    if (!text || text.length > 650) return;
    const course = courseRe.exec(text)?.[0]?.toUpperCase();
    const type = typeRe.exec(text);
    const time = timeRe.exec(text)?.[0] || "";
    if (!course || !type || !time) return;
    const number = type[2] ? Number(type[2]) : null;
    const session = `${type[1].replace(/\s+/g, " ")}${number !== null ? ` ${String(number).padStart(2, "0")}` : ""}`;
    const markerText = compact([
      root.getAttribute?.("class"), root.getAttribute?.("title"), root.getAttribute?.("aria-label"),
      ...[...(root.querySelectorAll?.("[class],[data-icon],[title],[aria-label],img,svg,i") || [])].slice(0, 30).map((node) => `${node.getAttribute?.("class") || ""} ${node.getAttribute?.("data-icon") || ""} ${node.getAttribute?.("title") || ""} ${node.getAttribute?.("aria-label") || ""} ${node.getAttribute?.("alt") || ""}`)
    ].join(" "));
    const completed = completedHint || /(?:^|[\s_-])(check|checked|tick|complete|completed|present|success)(?:[\s_-]|$)/i.test(markerText);
    const key = `${targetDateKey}|${course}|${session.toLowerCase()}|${time.toLowerCase()}`;
    const previous = sessions.find((row) => row.key === key);
    const row = { key, course, session, attendanceLabel: text, time, entryUrl: entryHref || "", completed, sourceUrl: location.href };
    if (!previous) sessions.push(row);
    else if (completed || (!previous.entryUrl && entryHref)) Object.assign(previous, row, { completed: previous.completed || completed });
  };

  // Unfinished classes always expose an Entry.aspx link. Parse those first.
  for (const link of document.querySelectorAll("a[href*='Entry.aspx']")) {
    let root = link;
    for (let depth = 0; depth < 5 && root.parentElement; depth += 1) {
      const parent = root.parentElement;
      const text = compact(parent.innerText || parent.textContent);
      if (text.length > 650) break;
      root = parent;
      if (courseRe.test(text) && typeRe.test(text) && timeRe.test(text)) break;
    }
    parseCard(root, false, link.href);
  }

  // Completed rows lose the Entry.aspx link. Find their green/check/success marker and walk
  // up to the smallest visible card that still contains course + class type + time.
  const markers = document.querySelectorAll("[class*='check'],[class*='complete'],[class*='success'],[data-icon*='check'],[title*='complete' i],[aria-label*='complete' i],[aria-label*='check' i],svg,i,img");
  for (const marker of markers) {
    const markerClue = compact(`${marker.getAttribute?.("class") || ""} ${marker.getAttribute?.("data-icon") || ""} ${marker.getAttribute?.("title") || ""} ${marker.getAttribute?.("aria-label") || ""} ${marker.getAttribute?.("alt") || ""}`);
    if (!/check|tick|complete|present|success/i.test(markerClue)) continue;
    let root = marker;
    for (let depth = 0; depth < 7 && root.parentElement; depth += 1) {
      root = root.parentElement;
      const text = compact(root.innerText || root.textContent);
      if (text.length > 650) break;
      if (courseRe.test(text) && typeRe.test(text) && timeRe.test(text)) {
        parseCard(root, true, root.querySelector?.("a[href*='Entry.aspx']")?.href || "");
        break;
      }
    }
  }

  return { ready: document.readyState === "complete", sessions: sessions.map(({ key, ...row }) => row) };
}

async function readAttendancePortal(lookbackDays) {
  const dates = recentDates(lookbackDays);
  const pages = await Promise.all(dates.map(async (date) => {
    const url = `https://attendance.monash.edu.my/student/Units.aspx#${date.key}`;
    const page = await runOnPage(url, extractAttendanceRows, [date.key], 2);
    const rows = page.value?.sessions || [];
    return {
      date,
      page,
      rows: rows.map((row) => ({ ...row, day: date.day, attendanceDate: { iso: date.iso, key: date.key } }))
    };
  }));

  const sessions = [];
  const scans = [];
  for (const { date, page, rows } of pages) {
    sessions.push(...rows);
    scans.push(page.ok ? {
      ok: true,
      url: `https://attendance.monash.edu.my/student/Units.aspx#${date.key}`,
      reconciliation: "attendance-v2",
      textLength: 0,
      linkCount: rows.filter((row) => row.entryUrl).length,
      imageCount: 0,
      ocrLength: 0,
      ocrSelectedCount: 0,
      threadCount: 0,
      codeLikeCount: 0,
      structuredRowCount: rows.length,
      excerpt: rows.map((row) => `${row.completed ? "✓" : "○"} ${row.course} ${row.session} ${row.time}`).join("\n").slice(0, 5000)
    } : { ok: false, url: page.url, error: page.error, reconciliation: "attendance-v2" });
  }
  return { sessions, scans };
}

function extractMoodleEvidence() {
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const sessionRe = /\b(workshop|tutorial|studio|applied(?:\s+class)?|practical|laboratory|lab|seminar)\b/i;
  const dateRe = /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
  const timeRe = /\b\d{1,2}:\d{2}\s*[ap]\.?m\.?\b/i;
  const codeRe = /\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5}\b/g;
  const rows = [];
  const attendanceLinks = [];
  const sectionLinks = [];
  const seenRows = new Set();
  const seenLinks = new Set();

  const addRow = (cells, raw) => {
    const cleanCells = (cells || []).map(compact).filter(Boolean);
    const text = compact(raw || cleanCells.join(" | "));
    if (!sessionRe.test(text) || !dateRe.test(text) || !timeRe.test(text)) return;
    const codes = [...text.toUpperCase().matchAll(codeRe)].map((match) => match[0]);
    if (!codes.length) return;
    const key = `${cleanCells.join("|")}|${text}`;
    if (seenRows.has(key)) return;
    seenRows.add(key);
    rows.push({ cells: cleanCells, raw: text });
  };

  for (const row of document.querySelectorAll("tr,[role='row']")) {
    const cells = [...row.querySelectorAll(":scope > th,:scope > td,[role='cell'],[role='columnheader']")].map((cell) => cell.innerText || cell.textContent);
    addRow(cells, row.innerText || row.textContent);
  }

  // Moodle themes often render an attendance table as stacked divs rather than a literal
  // <table>. Build a local row from the text stream and stop at the next activity label.
  const lines = String(document.body?.innerText || "").split(/\n+/).map(compact).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (!sessionRe.test(lines[index])) continue;
    let end = Math.min(lines.length, index + 9);
    for (let next = index + 1; next < Math.min(lines.length, index + 9); next += 1) {
      if (sessionRe.test(lines[next])) { end = next; break; }
    }
    const cells = lines.slice(index, end);
    addRow(cells, cells.join(" | "));
  }

  for (const anchor of document.querySelectorAll("a[href]")) {
    let url;
    try { url = new URL(anchor.href, location.href); } catch { continue; }
    if (url.hostname !== "learning.monash.edu") continue;
    let clue = compact(anchor.innerText || anchor.textContent);
    let parent = anchor.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const text = compact(parent.innerText || parent.textContent);
      if (text && text.length < 700) clue = `${clue} ${text}`;
    }
    const href = url.href.split("#")[0];
    if (/\/mod\/[^/]+\/view\.php/i.test(url.pathname) && /attendance/i.test(clue) && !seenLinks.has(`a:${href}`)) {
      seenLinks.add(`a:${href}`);
      attendanceLinks.push(href);
    }
    if ((url.pathname === "/course/view.php" && url.searchParams.has("section")) || /\/course\/section\.php/i.test(url.pathname)) {
      if (/\bweek\s*\d{1,2}\b/i.test(clue) && !seenLinks.has(`s:${href}`)) {
        seenLinks.add(`s:${href}`);
        sectionLinks.push(href);
      }
    }
  }

  return { ready: document.readyState === "complete", rows, attendanceLinks, sectionLinks, title: document.title };
}

function unresolved(result, course = "") {
  return (result.items || []).filter((item) => !item.completed && (!item.code || item.confidence !== "high") && (!course || String(item.course || "").toUpperCase() === course));
}

function mergeRows(result, course, rows, sourceUrl) {
  const indexes = (result.items || []).map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.completed && String(item.course || "").toUpperCase() === course && (!item.code || item.confidence !== "high"));
  if (!indexes.length || !rows?.length) return 0;
  const matched = matchStructuredAttendanceRows(rows.map((row) => ({ ...row, sourceUrl })), indexes.map(({ item }) => item));
  let changed = 0;
  matched.forEach((candidate, localIndex) => {
    if (!candidate.code || candidate.confidence !== "high") return;
    const index = indexes[localIndex].index;
    result.items[index] = { ...result.items[index], ...candidate };
    changed += 1;
  });
  return changed;
}

function courseCandidateUrls(result, course) {
  const lower = course.toLowerCase();
  return [...new Map((result.scans || [])
    .filter((scan) => scan?.ok && /learning\.monash\.edu/i.test(scan.url || ""))
    .filter((scan) => (scan.courses || []).map((value) => String(value).toLowerCase()).includes(lower))
    .sort((a, b) => (b.codeLikeCount || 0) - (a.codeLikeCount || 0))
    .map((scan) => [scan.url, scan])).values()]
    .slice(0, 8)
    .map((scan) => scan.url);
}

async function discoverCourseRoot(course) {
  for (const indexUrl of ["https://learning.monash.edu/my/courses.php", "https://learning.monash.edu/my/"]) {
    const page = await runOnPage(indexUrl, function findCourse(targetCourse) {
      const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const wanted = String(targetCourse || "").toUpperCase();
      const matches = [];
      for (const anchor of document.querySelectorAll("a[href*='/course/view.php?id=']")) {
        let text = compact(anchor.innerText || anchor.textContent);
        let parent = anchor.parentElement;
        for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
          const parentText = compact(parent.innerText || parent.textContent);
          if (parentText.length < 700) text = `${text} ${parentText}`;
        }
        if (text.toUpperCase().includes(wanted)) matches.push(anchor.href.replace(/([?&]id=\d+).*$/, "$1"));
      }
      return { ready: document.readyState === "complete", matches: [...new Set(matches)] };
    }, [course], 2);
    if (page.value?.matches?.length) return page.value.matches[0];
  }
  return "";
}

async function resolveMoodleCourse(result, course) {
  const queue = courseCandidateUrls(result, course);
  const root = await discoverCourseRoot(course);
  if (root && !queue.includes(root)) queue.push(root);
  const visited = new Set();
  let pagesRead = 0;

  while (queue.length && unresolved(result, course).length && pagesRead < 12) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    pagesRead += 1;
    const page = await runOnPage(url, extractMoodleEvidence, [], 3);
    const evidence = page.value || { rows: [], attendanceLinks: [], sectionLinks: [] };
    result.scans.push({
      ok: page.ok,
      url,
      courses: [course.toLowerCase()],
      reconciliation: "moodle-v2",
      error: page.error,
      textLength: 0,
      linkCount: (evidence.attendanceLinks || []).length + (evidence.sectionLinks || []).length,
      imageCount: 0,
      ocrLength: 0,
      ocrSelectedCount: 0,
      threadCount: 0,
      structuredRowCount: (evidence.rows || []).length,
      codeLikeCount: (evidence.rows || []).length,
      excerpt: (evidence.rows || []).map((row) => row.raw).join("\n").slice(0, 7000)
    });
    mergeRows(result, course, evidence.rows || [], url);
    if (!unresolved(result, course).length) break;
    for (const href of evidence.attendanceLinks || []) if (!visited.has(href)) queue.unshift(href);
    for (const href of (evidence.sectionLinks || []).slice(-6).reverse()) if (!visited.has(href)) queue.push(href);
  }
}

async function reconcile(latestScan) {
  const result = {
    ...latestScan,
    items: (latestScan.items || []).map((item) => ({ ...item })),
    scans: [...(latestScan.scans || [])]
  };
  const beforeCodes = result.items.filter((item) => item.code && item.confidence === "high").length;
  const beforeCompleted = result.items.filter((item) => item.completed).length;
  const { settings } = await chrome.storage.local.get("settings");

  const portal = await readAttendancePortal(settings?.lookbackDays || 7);
  result.items = mergePortalAttendance(result.items, portal.sessions);
  result.scans.push(...portal.scans);

  const courseScores = new Map();
  for (const item of unresolved(result)) {
    const course = String(item.course || "").toUpperCase();
    if (!course) continue;
    const score = Math.max(0, ...(result.scans || []).filter((scan) => (scan.courses || []).map((value) => String(value).toUpperCase()).includes(course)).map((scan) => scan.codeLikeCount || 0));
    courseScores.set(course, Math.max(courseScores.get(course) || 0, score));
  }
  const courses = [...courseScores.keys()].sort((a, b) => (courseScores.get(b) || 0) - (courseScores.get(a) || 0));
  for (const course of courses) await resolveMoodleCourse(result, course);

  const afterCodes = result.items.filter((item) => item.code && item.confidence === "high").length;
  const afterCompleted = result.items.filter((item) => item.completed).length;
  result.reconciliation = {
    version: RECONCILIATION_VERSION,
    status: "complete",
    codesAdded: Math.max(0, afterCodes - beforeCodes),
    completedAdded: Math.max(0, afterCompleted - beforeCompleted),
    completedAt: new Date().toISOString()
  };
  return result;
}

async function reconcileAndStore(latestScan) {
  if (running) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await pause(250);
      const current = (await chrome.storage.local.get("latestScan")).latestScan;
      if (current?.reconciliation?.version === RECONCILIATION_VERSION) return current;
      if (!running) break;
    }
  }
  running = true;
  try {
    const reconciled = await reconcile(latestScan);
    await chrome.storage.local.set({ latestScan: reconciled });
    return reconciled;
  } finally {
    running = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "RUN_FINAL_RECONCILIATION") return;
  (async () => {
    try {
      const { latestScan } = await chrome.storage.local.get("latestScan");
      if (!latestScan || latestScan.mode !== "attendance-discovery") {
        sendResponse({ ok: false, error: "没有可核对的 Attendance 扫描结果" });
        return;
      }
      const reconciled = latestScan.reconciliation?.version === RECONCILIATION_VERSION
        ? latestScan
        : await reconcileAndStore(latestScan);
      sendResponse({
        ok: true,
        total: reconciled.items?.length || 0,
        completed: reconciled.items?.filter((item) => item.completed).length || 0,
        found: reconciled.items?.filter((item) => item.code && item.confidence === "high").length || 0,
        reconciliation: reconciled.reconciliation
      });
    } catch (error) {
      const { latestScan } = await chrome.storage.local.get("latestScan");
      await chrome.storage.local.set({
        latestScan: {
          ...latestScan,
          reconciliation: { version: RECONCILIATION_VERSION, status: "failed", error: error?.message || String(error), completedAt: new Date().toISOString() }
        }
      }).catch(() => {});
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

// Scheduled scans have no review page waiting on them, so reconcile them here as a backup.
// Manual scans are explicitly awaited by review.js via RUN_FINAL_RECONCILIATION.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || running || !changes.latestScan?.newValue) return;
  const latestScan = changes.latestScan.newValue;
  if (latestScan?.mode !== "attendance-discovery" || latestScan?.reason === "manual") return;
  if (latestScan?.reconciliation?.version === RECONCILIATION_VERSION) return;
  reconcileAndStore(latestScan).catch(() => {});
});
