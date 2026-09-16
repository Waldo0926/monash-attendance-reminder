import { buildCodeEvidenceCache, codeConfidenceOf, matchStructuredAttendanceRows, mergePortalAttendance, needsCodeEvidence, projectUpcomingSessions, restoreCodeEvidence } from "./reconciliation-core.js";
import { logDebug, mondayOf } from "./shared.js";

const RECONCILIATION_VERSION = 4;
const EVIDENCE_CACHE_KEY = "attendanceEvidenceCacheV4";
let running = false;

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// chrome.scripting.executeScript() targets a live page: if that page's own JS is stuck
// (a blocked event loop, a synchronous request that never returns, a frozen jQuery Mobile
// transition on the Attendance portal) the call itself never resolves or rejects. Every
// caller below awaits this inside a bounded loop, so one unresponsive tab must not be able
// to stall reconciliation forever - race it against a timeout and treat that as a failure
// the existing retry logic already knows how to handle.
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message || `操作超时 (${ms}ms)`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function dateEntry(value, months) {
  return {
    iso: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`,
    key: `${value.getDate()}_${months[value.getMonth()]}_${String(value.getFullYear()).slice(-2)}`,
    day: value.toLocaleDateString("en-US", { weekday: "long" })
  };
}

function recentDates(count = 7) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const result = [];
  for (let offset = Math.max(1, Number(count) || 7); offset >= 0; offset -= 1) {
    result.push(dateEntry(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12), months));
  }
  // Attendance can list a day's scheduled sessions before that day happens (a pending row,
  // not a signed-in tick), not just once the day has arrived - see the matching comment on
  // shared.js's recentAttendanceDates. Extend through Sunday of the current week so those
  // rows get read too, instead of only ever looking backward from today.
  const sunday = mondayOf(now);
  sunday.setDate(sunday.getDate() + 6);
  for (
    let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    cursor <= sunday;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    result.push(dateEntry(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 12), months));
  }
  return result;
}

async function waitForUsableDocument(tabId, targetUrl, timeoutMs = 12000) {
  const expectedOrigin = new URL(targetUrl).origin;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    let currentOrigin = "";
    try { currentOrigin = new URL(tab.url || "about:blank").origin; } catch {}
    if (currentOrigin === expectedOrigin) {
      try {
        const probe = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId },
            func: () => ({ readyState: document.readyState, hasBody: Boolean(document.body), href: location.href })
          }),
          4000,
          "页面探测超时"
        );
        const state = probe?.[0]?.result;
        if (state?.hasBody && state.readyState !== "loading") {
          await pause(350);
          return true;
        }
      } catch {
        // The navigation may have committed but the document is not scriptable yet.
      }
    }
    await pause(250);
  }
  return false;
}

async function runOnPage(url, func, args = [], attempts = 3) {
  const tabs = await chrome.tabs.query({});
  const exact = tabs.find((tab) => tab.url === url);
  const tab = exact || await chrome.tabs.create({ url, active: false });
  const owned = !exact;
  let lastError = "";
  try {
    // Do not require tab.status === complete. Moodle and Attendance can keep Chromium in
    // "loading" after the useful DOM is already rendered because a resource never settles.
    await waitForUsableDocument(tab.id, url);

    let value = null;
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
      if (attempt) await pause(650 + attempt * 250);
      try {
        const response = await withTimeout(
          chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }),
          9000,
          "页面读取超时"
        );
        value = response?.[0]?.result ?? null;
        if (value && (value.ready !== false || attempt === attempts - 1)) {
          const current = await chrome.tabs.get(tab.id).catch(() => null);
          return { ok: true, value, url: current?.url || url };
        }
      } catch (error) {
        lastError = error?.message || String(error);
      }
    }

    const current = await chrome.tabs.get(tab.id).catch(() => null);
    let currentOrigin = "";
    try { currentOrigin = new URL(current?.url || "about:blank").origin; } catch {}
    if (currentOrigin && currentOrigin !== new URL(url).origin) {
      return { ok: false, error: `页面跳转到 ${current?.url || "登录页"}，请确认已登录`, url };
    }
    return { ok: false, error: lastError || "页面已打开，但没有读取到可用内容", url };
  } finally {
    if (owned && tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function extractAttendanceRows(targetDateKey) {
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const courseRe = /\b[A-Z]{3}\d{4}\b/i;
  const typeRe = /\b(workshop|tutorial|studio|applied(?:\s+class)?|practical|laboratory|lab|seminar)\b\s*0*(\d{1,2})?/i;
  const timeRe = /\b\d{1,2}:\d{2}\s*[ap]m\b/i;
  const completionClue = (value) => {
    const clue = String(value || "").toLowerCase();
    if (/question|help|unknown|pending|incomplete/.test(clue)) return false;
    return /[✓✔☑]|(?:glyphicon|ui-icon|icon|fa|fas|far|fal|fab|bi)[-_ ]*(?:ok|check)(?:[-_ ]|\b)|\bcheck(?:ed|mark)?\b|\btick\b|\bcomplete(?:d)?\b|\bpresent\b|\bsuccess\b/.test(clue);
  };
  const syntheticCompletedHref = (value) => {
    const href = String(value || "");
    if (!href) return false;
    try {
      return new URL(href, location.href).searchParams.get("mah_completed") === "1";
    } catch {
      return /[?&]mah_completed=1(?:&|#|$)/.test(href);
    }
  };
  const visible = (node) => {
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && (node.getClientRects().length > 0 || node.offsetWidth > 0 || node.offsetHeight > 0);
  };
  const sessions = [];

  const add = (root, completedHint = false, entryHref = "") => {
    if (!root || !visible(root)) return;
    const text = compact(root.innerText || root.textContent);
    if (!text || text.length > 750) return;
    const course = courseRe.exec(text)?.[0]?.toUpperCase();
    const type = typeRe.exec(text);
    const time = timeRe.exec(text)?.[0] || "";
    if (!course || !type || !time) return;
    const number = type[2] ? Number(type[2]) : null;
    const session = `${type[1].replace(/\s+/g, " ")}${number !== null ? ` ${String(number).padStart(2, "0")}` : ""}`;
    const nodes = [root, ...[...(root.querySelectorAll?.("[class],[data-icon],[title],[aria-label],img,svg,i,span") || [])].slice(0, 80)];
    const clue = compact(`${nodes.map((node) => `${node.getAttribute?.("class") || ""} ${node.getAttribute?.("data-icon") || ""} ${node.getAttribute?.("title") || ""} ${node.getAttribute?.("aria-label") || ""} ${node.getAttribute?.("alt") || ""} ${node.getAttribute?.("src") || ""}`).join(" ")} ${String(root.outerHTML || "").slice(0, 6000)}`);
    const syntheticCompleted = syntheticCompletedHref(entryHref);
    const realEntryHref = syntheticCompleted ? "" : String(entryHref || "");
    // A synthetic Entry.aspx-looking link is injected only to make a completed row visible
    // to first-pass discovery. It is never a submittable Attendance entry. A genuine
    // Entry.aspx link still means the row is pending, even if unrelated success/check CSS
    // exists elsewhere inside the same container.
    const completed = syntheticCompleted || (!realEntryHref && (completedHint || completionClue(`${text} ${clue}`)));
    const key = `${targetDateKey}|${course}|${session.toLowerCase()}|${time.toLowerCase()}`;
    const row = {
      course,
      session,
      attendanceLabel: text,
      time,
      entryUrl: completed ? "" : realEntryHref,
      completed,
      sourceUrl: location.href
    };
    const index = sessions.findIndex((item) => item.key === key);
    if (index < 0) {
      sessions.push({ key, ...row });
    } else {
      const previous = sessions[index];
      const finalCompleted = previous.completed || completed;
      sessions[index] = {
        key,
        ...previous,
        ...row,
        entryUrl: finalCompleted ? "" : (row.entryUrl || previous.entryUrl || ""),
        completed: finalCompleted
      };
    }
  };

  for (const link of document.querySelectorAll("a[href*='Entry.aspx']")) {
    let root = link;
    for (let depth = 0; depth < 6 && root.parentElement; depth += 1) {
      const parent = root.parentElement;
      const text = compact(parent.innerText || parent.textContent);
      if (text.length > 750) break;
      root = parent;
      if (courseRe.test(text) && typeRe.test(text) && timeRe.test(text)) break;
    }
    add(root, syntheticCompletedHref(link.href), link.href);
  }

  for (const node of document.querySelectorAll("li,tr,[role='listitem'],[class*='ui-li'],[class*='row'],[class*='activity']")) {
    if (!visible(node)) continue;
    const text = compact(node.innerText || node.textContent);
    if (!courseRe.test(text) || !typeRe.test(text) || !timeRe.test(text)) continue;
    const entry = node.querySelector?.("a[href*='Entry.aspx']");
    add(node, syntheticCompletedHref(entry?.href), entry?.href || "");
  }

  const markers = document.querySelectorAll("[class*='glyphicon-ok'],[class*='ui-icon-check'],[class*='icon-ok'],[class*='check'],[class*='complete'],[class*='success'],[data-icon*='check'],[title*='complete' i],[aria-label*='complete' i],[aria-label*='check' i],svg,i,img,span");
  for (const marker of markers) {
    const clue = compact(`${marker.getAttribute?.("class") || ""} ${marker.getAttribute?.("data-icon") || ""} ${marker.getAttribute?.("title") || ""} ${marker.getAttribute?.("aria-label") || ""} ${marker.getAttribute?.("alt") || ""} ${marker.getAttribute?.("src") || ""}`);
    if (!completionClue(clue)) continue;
    let root = marker;
    for (let depth = 0; depth < 8 && root.parentElement; depth += 1) {
      root = root.parentElement;
      const text = compact(root.innerText || root.textContent);
      if (text.length > 750) break;
      if (courseRe.test(text) && typeRe.test(text) && timeRe.test(text)) {
        const entry = root.querySelector?.("a[href*='Entry.aspx']");
        add(root, true, entry?.href || "");
        break;
      }
    }
  }

  return { ready: Boolean(document.body), sessions: sessions.map(({ key, ...row }) => row) };
}

async function readAttendancePortal(lookbackDays) {
  const sessions = [];
  const scans = [];
  // Sequential reads are deliberate: opening eight Attendance tabs at once caused the
  // Malaysia portal to leave some tabs permanently in a loading state.
  for (const date of recentDates(lookbackDays)) {
    const url = `https://attendance.monash.edu.my/student/Units.aspx#${date.key}`;
    const startedAt = Date.now();
    const page = await withTimeout(runOnPage(url, extractAttendanceRows, [date.key], 3), 55000, "该日期查询超时")
      .catch((error) => ({ ok: false, url, error: error.message }));
    await logDebug(`attendance date ${date.key}`, {
      ok: page.ok,
      error: page.error,
      ms: Date.now() - startedAt,
      // course/session/completed for every row this page actually extracted - the only way
      // to tell "the page has no such row" apart from "the row was there but not recognised
      // as completed" without re-reading the live DOM by hand.
      rows: (page.value?.sessions || []).map((row) => ({ course: row.course, session: row.session, time: row.time, completed: row.completed, hadEntryUrl: Boolean(row.entryUrl) }))
    });
    const rows = (page.value?.sessions || []).map((row) => ({
      ...row,
      day: date.day,
      attendanceDate: { iso: date.iso, key: date.key }
    }));
    sessions.push(...rows);
    scans.push(page.ok ? {
      ok: true,
      url,
      reconciliation: "attendance-v4",
      textLength: 0,
      linkCount: rows.filter((row) => row.entryUrl).length,
      imageCount: 0,
      ocrLength: 0,
      ocrSelectedCount: 0,
      threadCount: 0,
      codeLikeCount: 0,
      structuredRowCount: rows.length,
      completedRowCount: rows.filter((row) => row.completed).length,
      excerpt: rows.map((row) => `${row.completed ? "✓" : "○"} ${row.course} ${row.session} ${row.time}`).join("\n").slice(0, 5000)
    } : { ok: false, url, error: page.error, reconciliation: "attendance-v4" });
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
    if (![...text.toUpperCase().matchAll(codeRe)].length) return;
    const key = `${cleanCells.join("|")}|${text}`;
    if (seenRows.has(key)) return;
    seenRows.add(key);
    rows.push({ cells: cleanCells, raw: text });
  };

  for (const row of document.querySelectorAll("tr,[role='row']")) {
    const cells = [...row.querySelectorAll(":scope > th,:scope > td,[role='cell'],[role='columnheader']")].map((cell) => cell.innerText || cell.textContent);
    addRow(cells, row.innerText || row.textContent);
  }

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

  return { ready: Boolean(document.body), rows, attendanceLinks, sectionLinks, title: document.title };
}

function unresolved(result, course = "") {
  return (result.items || []).filter((item) => needsCodeEvidence(item) && (!course || String(item.course || "").toUpperCase() === course));
}

function mergeRows(result, course, rows, sourceUrl) {
  const indexes = (result.items || []).map((item, index) => ({ item, index }))
    .filter(({ item }) => String(item.course || "").toUpperCase() === course && needsCodeEvidence(item));
  if (!indexes.length || !rows?.length) return 0;
  const matched = matchStructuredAttendanceRows(rows.map((row) => ({ ...row, sourceUrl })), indexes.map(({ item }) => item));
  let changed = 0;
  matched.forEach((candidate, localIndex) => {
    if (!candidate.code || codeConfidenceOf(candidate) !== "high") return;
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
    .slice(0, 10)
    .map((scan) => scan.url);
}

async function discoverCourseRoot(course) {
  for (const indexUrl of ["https://learning.monash.edu/my/courses.php", "https://learning.monash.edu/my/"]) {
    const page = await withTimeout(runOnPage(indexUrl, function findCourse(targetCourse) {
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
      return { ready: Boolean(document.body), matches: [...new Set(matches)] };
    }, [course], 3), 55000, "该页面查询超时").catch((error) => ({ ok: false, url: indexUrl, error: error.message }));
    if (page.value?.matches?.length) return page.value.matches[0];
  }
  return "";
}

async function resolveMoodleCourse(result, course) {
  const queue = courseCandidateUrls(result, course);
  // The normal scanner already tells us the exact unit/section URLs in almost every case.
  // Read those first. If a completed class was absent from the normal scan, discover the
  // unit root from My units and enrich the completed row with its historical code too.
  if (!queue.length) {
    const root = await discoverCourseRoot(course);
    if (root) queue.push(root);
  }

  const visited = new Set();
  let pagesRead = 0;
  while (queue.length && unresolved(result, course).length && pagesRead < 14) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    pagesRead += 1;
    const page = await withTimeout(runOnPage(url, extractMoodleEvidence, [], 4), 65000, "该页面查询超时")
      .catch((error) => ({ ok: false, url, error: error.message }));
    const evidence = page.value || { rows: [], attendanceLinks: [], sectionLinks: [] };
    result.scans.push({
      ok: page.ok,
      url,
      courses: [course.toLowerCase()],
      reconciliation: "moodle-v4",
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
    for (const href of (evidence.sectionLinks || []).slice(-8).reverse()) if (!visited.has(href)) queue.push(href);
  }
}

async function reconcile(latestScan) {
  const result = {
    ...latestScan,
    items: (latestScan.items || []).map((item) => ({ ...item })),
    scans: [...(latestScan.scans || [])]
  };
  const beforeCodes = result.items.filter((item) => item.code && codeConfidenceOf(item) === "high").length;
  const beforeCompleted = result.items.filter((item) => item.completed).length;
  const stored = await chrome.storage.local.get(["settings", EVIDENCE_CACHE_KEY]);
  const settings = stored.settings;
  const evidenceCache = stored[EVIDENCE_CACHE_KEY] || {};

  const portal = await readAttendancePortal(settings?.lookbackDays || 7);
  result.items = mergePortalAttendance(result.items, portal.sessions);
  result.items = restoreCodeEvidence(result.items, evidenceCache);
  result.scans.push(...portal.scans);

  const courseScores = new Map();
  for (const item of unresolved(result)) {
    const course = String(item.course || "").toUpperCase();
    if (!course) continue;
    const score = Math.max(0, ...(result.scans || [])
      .filter((scan) => (scan.courses || []).map((value) => String(value).toUpperCase()).includes(course))
      .map((scan) => scan.codeLikeCount || 0));
    courseScores.set(course, Math.max(courseScores.get(course) || 0, score));
  }
  const courses = [...courseScores.keys()].sort((a, b) => (courseScores.get(b) || 0) - (courseScores.get(a) || 0));
  for (const course of courses) await resolveMoodleCourse(result, course);

  // Add placeholders for this week's classes that recur weekly but simply haven't happened
  // yet. Do this last, after code/Moodle resolution, so these not-yet-existing rows are never
  // fed into a code search of their own.
  result.items = projectUpcomingSessions(result.items);

  const afterCodes = result.items.filter((item) => item.code && codeConfidenceOf(item) === "high").length;
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

export async function reconcileAndStore(latestScan) {
  if (running) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await pause(250);
      const current = (await chrome.storage.local.get("latestScan")).latestScan;
      if (current?.reconciliation?.version === RECONCILIATION_VERSION) return current;
      if (!running) break;
    }
  }
  running = true;
  try {
    const reconciled = await reconcile(latestScan);
    const stored = await chrome.storage.local.get(EVIDENCE_CACHE_KEY);
    const cache = buildCodeEvidenceCache(reconciled.items, stored[EVIDENCE_CACHE_KEY] || {});
    await chrome.storage.local.set({ latestScan: reconciled, [EVIDENCE_CACHE_KEY]: cache });
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
      await logDebug("RUN_FINAL_RECONCILIATION received", {
        hasLatestScan: Boolean(latestScan),
        mode: latestScan?.mode,
        reason: latestScan?.reason,
        itemCount: latestScan?.items?.length,
        existingReconciliationVersion: latestScan?.reconciliation?.version
      });
      if (!latestScan || latestScan.mode !== "attendance-discovery") {
        // This used to bail without touching storage at all, so the reason was only ever
        // visible in the one UI that happened to be open for this exact call - reopening the
        // popup or the review page afterwards showed a plain "等待最终核对" with no way to
        // tell a real failure from one that simply hadn't run yet. Persist it like every other
        // failure path does.
        const error = !latestScan
          ? "没有可核对的 Attendance 扫描结果：请先点击「重新查找」完成一次扫描。"
          : `没有可核对的 Attendance 扫描结果：本次扫描模式是 "${latestScan.mode || "未设置"}"，不是自动发现模式（请确认设置里"自动识别课程"已打开）。`;
        if (latestScan) {
          await chrome.storage.local.set({
            latestScan: {
              ...latestScan,
              reconciliation: { version: RECONCILIATION_VERSION, status: "failed", error, completedAt: new Date().toISOString() }
            }
          }).catch(() => {});
        }
        sendResponse({ ok: false, error });
        return;
      }
      await logDebug("reconciliation starting");
      const reconciled = latestScan.reconciliation?.version === RECONCILIATION_VERSION
        ? latestScan
        : await reconcileAndStore(latestScan);
      await logDebug("reconciliation finished", reconciled.reconciliation);
      sendResponse({
        ok: true,
        total: reconciled.items?.length || 0,
        completed: reconciled.items?.filter((item) => item.completed).length || 0,
        found: reconciled.items?.filter((item) => item.code && codeConfidenceOf(item) === "high").length || 0,
        reconciliation: reconciled.reconciliation
      });
    } catch (error) {
      await logDebug("reconciliation threw", { message: error?.message || String(error), stack: error?.stack });
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || running || !changes.latestScan?.newValue) return;
  const latestScan = changes.latestScan.newValue;
  if (latestScan?.mode !== "attendance-discovery" || latestScan?.reason === "manual") return;
  if (latestScan?.reconciliation?.version === RECONCILIATION_VERSION) return;
  reconcileAndStore(latestScan).catch(() => {});
});
