import { matchStructuredAttendanceRows, mergePortalAttendance } from "./reconciliation-core.js";

const RECONCILIATION_VERSION = 1;
let reconciliationRunning = false;

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

async function waitForLoaded(tabId, timeoutMs = 25000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === "complete") {
    await pause(900);
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
      setTimeout(resolve, 900);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function runOnPage(url, func, args = [], { settleMs = 800, attempts = 1 } = {}) {
  const exact = (await chrome.tabs.query({})).find((tab) => tab.url === url);
  const tab = exact || await chrome.tabs.create({ url, active: false });
  const owned = !exact;
  try {
    await waitForLoaded(tab.id);
    let last = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt) await pause(settleMs);
      const response = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
      last = response?.[0]?.result ?? null;
      if (last?.ready !== false) break;
    }
    return { ok: true, value: last, url: tab.url || url };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), url };
  } finally {
    if (owned && tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function extractAttendancePortalRows(targetDateKey) {
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (node) => {
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && (node.getClientRects().length > 0 || node.offsetHeight > 0 || node.offsetWidth > 0);
  };
  const courseRe = /\b[A-Z]{3}\d{4}\b/i;
  const typeRe = /\b(workshop|tutorial|studio|applied(?:\s+class)?|practical|laboratory|lab|seminar)\b\s*0*(\d{1,2})?/i;
  const timeRe = /\b\d{1,2}:\d{2}\s*[ap]m\b/i;
  const sessions = [];
  const seen = new Set();

  for (const node of document.querySelectorAll("li, tr, [role='listitem']")) {
    if (!visible(node)) continue;
    const text = compact(node.innerText || node.textContent);
    const course = courseRe.exec(text)?.[0]?.toUpperCase();
    const type = typeRe.exec(text);
    const time = timeRe.exec(text)?.[0] || "";
    if (!course || !type || !time) continue;

    const entry = node.matches?.("a[href*='Entry.aspx']") ? node : node.querySelector?.("a[href*='Entry.aspx']");
    const markerText = compact([
      node.getAttribute?.("data-icon"),
      node.getAttribute?.("class"),
      ...[...(node.querySelectorAll?.("[data-icon], [class], img") || [])].slice(0, 20).map((child) => `${child.getAttribute?.("data-icon") || ""} ${child.getAttribute?.("class") || ""} ${child.getAttribute?.("alt") || ""} ${child.getAttribute?.("src") || ""}`)
    ].join(" "));
    const hasCompletedMarker = /(?:^|[\s_-])(check|checked|tick|complete|completed|present)(?:[\s_-]|$)/i.test(markerText);
    // On the past-week Attendance list, actionable rows have an Entry.aspx link. A visible
    // session row without that link is the completed/locked rendering (normally accompanied
    // by the green check icon). Keeping it as completed is safer than silently dropping it.
    const completed = hasCompletedMarker || !entry;
    const number = type[2] ? Number(type[2]) : null;
    const session = `${type[1].replace(/\s+/g, " ")}${number !== null ? ` ${String(number).padStart(2, "0")}` : ""}`;
    const entryUrl = entry?.href || "";
    const key = `${targetDateKey}|${course}|${session.toLowerCase()}|${time.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sessions.push({
      course,
      session,
      attendanceLabel: text,
      time,
      entryUrl,
      completed,
      sourceUrl: location.href
    });
  }
  return { ready: document.readyState === "complete", sessions };
}

async function readPortalSessions(lookbackDays) {
  const sessions = [];
  const diagnostics = [];
  for (const date of recentDates(lookbackDays)) {
    const url = `https://attendance.monash.edu.my/student/Units.aspx#${date.key}`;
    const page = await runOnPage(url, extractAttendancePortalRows, [date.key], { settleMs: 650, attempts: 2 });
    if (!page.ok) {
      diagnostics.push({ ok: false, url, error: page.error, reconciliation: "attendance" });
      continue;
    }
    const rows = page.value?.sessions || [];
    diagnostics.push({
      ok: true,
      url,
      reconciliation: "attendance",
      textLength: 0,
      linkCount: rows.filter((row) => row.entryUrl).length,
      imageCount: 0,
      ocrLength: 0,
      ocrSelectedCount: 0,
      threadCount: 0,
      codeLikeCount: 0,
      structuredRowCount: rows.length,
      excerpt: rows.map((row) => `${row.completed ? "✓" : "○"} ${row.course} ${row.session} ${row.time}`).join("\n").slice(0, 5000)
    });
    sessions.push(...rows.map((row) => ({
      ...row,
      day: date.day,
      attendanceDate: { iso: date.iso, key: date.key }
    })));
  }
  const unique = new Map();
  for (const row of sessions) {
    const key = `${row.attendanceDate?.iso}|${row.course}|${row.session}|${row.time}`;
    const previous = unique.get(key);
    if (!previous || row.completed || (!previous.entryUrl && row.entryUrl)) unique.set(key, row);
  }
  return { sessions: [...unique.values()], diagnostics };
}

function extractMoodleNavigation(targetCourse) {
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const course = String(targetCourse || "").toUpperCase();
  const attendanceLinks = [];
  const courseLinks = [];
  const sectionLinks = [];
  const seen = new Set();
  const add = (bucket, href) => {
    if (!href || seen.has(`${bucket === attendanceLinks ? "a" : bucket === courseLinks ? "c" : "s"}:${href}`)) return;
    seen.add(`${bucket === attendanceLinks ? "a" : bucket === courseLinks ? "c" : "s"}:${href}`);
    bucket.push(href);
  };

  for (const anchor of document.querySelectorAll("a[href]")) {
    let url;
    try { url = new URL(anchor.href, location.href); } catch { continue; }
    if (url.hostname !== "learning.monash.edu") continue;
    let context = compact(anchor.innerText || anchor.textContent);
    let parent = anchor.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const text = compact(parent.innerText || parent.textContent);
      if (text && text.length <= 650) {
        context = `${context} ${text}`.trim();
        if (course && text.toUpperCase().includes(course)) break;
      }
    }

    if (/\/mod\/[^/]+\/view\.php/i.test(url.pathname) && /attendance/i.test(context)) add(attendanceLinks, url.href.split("#")[0]);
    if (url.pathname === "/course/view.php" && /^\d+$/.test(url.searchParams.get("id") || "")) {
      const root = `${url.origin}${url.pathname}?id=${url.searchParams.get("id")}`;
      if (course && context.toUpperCase().includes(course)) add(courseLinks, root);
      if (/\bweek\s*\d{1,2}\b/i.test(context) && (url.searchParams.has("section") || /#section-/i.test(anchor.href))) add(sectionLinks, anchor.href.split("#")[0]);
    }
    if (/\/course\/section\.php/i.test(url.pathname) && /\bweek\s*\d{1,2}\b/i.test(context)) add(sectionLinks, url.href.split("#")[0]);
  }
  return { ready: document.readyState === "complete", attendanceLinks, courseLinks, sectionLinks };
}

function extractMoodleTableRows() {
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const sessionRe = /\b(workshop|tutorial|studio|applied(?:\s+class)?|practical|laboratory|lab|seminar)\b/i;
  const dateRe = /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
  const timeRe = /\b\d{1,2}:\d{2}\s*[ap]\.?m\.?\b/i;
  const codeRe = /\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5}\b/g;
  const rows = [];
  const seen = new Set();

  const add = (cells, raw) => {
    const cleanCells = (cells || []).map(compact).filter(Boolean);
    const text = compact(raw || cleanCells.join(" | "));
    if (!sessionRe.test(text) || !dateRe.test(text) || !timeRe.test(text)) return;
    const codes = [...text.toUpperCase().matchAll(codeRe)].map((match) => match[0]).filter((code) => !/^(?:FIT|ECE|ENG|MMA|TRC)\d$/i.test(code));
    if (!codes.length) return;
    const key = `${cleanCells.join("|")}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ cells: cleanCells, raw: text });
  };

  for (const node of document.querySelectorAll("tr, [role='row']")) {
    const cells = [...node.querySelectorAll(":scope > th, :scope > td, [role='cell'], [role='columnheader']")].map((cell) => cell.innerText || cell.textContent);
    add(cells, node.innerText || node.textContent);
  }

  if (!rows.length) {
    const lines = String(document.body?.innerText || "").split(/\n+/).map(compact).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      if (!sessionRe.test(lines[index])) continue;
      let end = Math.min(lines.length, index + 8);
      for (let next = index + 1; next < Math.min(lines.length, index + 8); next += 1) {
        if (sessionRe.test(lines[next])) { end = next; break; }
      }
      const cells = lines.slice(index, end);
      add(cells, cells.join(" | "));
    }
  }

  return { ready: document.readyState === "complete" && rows.length > 0, rows, title: document.title };
}

function unresolvedItems(result, course = "") {
  return (result.items || []).filter((item) => !item.completed && (!item.code || item.confidence !== "high") && (!course || String(item.course || "").toUpperCase() === course));
}

function mergeStructuredMatches(result, course, rows, sourceUrl) {
  const indexes = (result.items || []).map((item, index) => ({ item, index })).filter(({ item }) => !item.completed && String(item.course || "").toUpperCase() === course && (!item.code || item.confidence !== "high"));
  if (!indexes.length) return 0;
  const withSource = (rows || []).map((row) => ({ ...row, sourceUrl }));
  const matched = matchStructuredAttendanceRows(withSource, indexes.map(({ item }) => item));
  let changed = 0;
  matched.forEach((candidate, localIndex) => {
    if (!candidate.code || candidate.confidence !== "high") return;
    const index = indexes[localIndex].index;
    result.items[index] = { ...result.items[index], ...candidate };
    changed += 1;
  });
  return changed;
}

function scanCandidatesForCourse(result, course) {
  const lower = course.toLowerCase();
  return [...new Set((result.scans || [])
    .filter((scan) => scan?.ok && /learning\.monash\.edu/i.test(scan.url || ""))
    .filter((scan) => (scan.courses || []).map((value) => String(value).toLowerCase()).includes(lower))
    .sort((a, b) => (b.codeLikeCount || 0) - (a.codeLikeCount || 0))
    .map((scan) => scan.url)
    .filter(Boolean))];
}

async function discoverCourseRoots(course) {
  const roots = new Set();
  for (const url of ["https://learning.monash.edu/my/courses.php", "https://learning.monash.edu/my/"]) {
    const page = await runOnPage(url, extractMoodleNavigation, [course], { settleMs: 700, attempts: 2 });
    for (const href of page.value?.courseLinks || []) roots.add(href);
  }
  return [...roots];
}

async function resolveCourseFromMoodle(result, course) {
  const pageQueue = scanCandidatesForCourse(result, course);
  const roots = await discoverCourseRoots(course);
  pageQueue.push(...roots);
  const visitedPages = new Set();
  const visitedActivities = new Set();
  let changed = 0;

  while (pageQueue.length && unresolvedItems(result, course).length) {
    const pageUrl = pageQueue.shift();
    if (!pageUrl || visitedPages.has(pageUrl)) continue;
    visitedPages.add(pageUrl);

    if (/\/mod\/[^/]+\/view\.php/i.test(new URL(pageUrl).pathname)) {
      visitedActivities.add(pageUrl);
      const table = await runOnPage(pageUrl, extractMoodleTableRows, [], { settleMs: 850, attempts: 4 });
      const rows = table.value?.rows || [];
      result.scans.push({
        ok: table.ok,
        url: pageUrl,
        courses: [course.toLowerCase()],
        reconciliation: "moodle-table",
        error: table.error,
        textLength: 0,
        linkCount: 0,
        imageCount: 0,
        ocrLength: 0,
        ocrSelectedCount: 0,
        threadCount: 0,
        structuredRowCount: rows.length,
        codeLikeCount: rows.length,
        excerpt: rows.map((row) => row.raw).join("\n").slice(0, 7000)
      });
      changed += mergeStructuredMatches(result, course, rows, pageUrl);
      continue;
    }

    const navigation = await runOnPage(pageUrl, extractMoodleNavigation, [course], { settleMs: 700, attempts: 2 });
    if (!navigation.ok) continue;
    for (const href of navigation.value?.attendanceLinks || []) {
      if (visitedActivities.has(href)) continue;
      pageQueue.unshift(href);
    }
    // Scan course week pages only as a final fallback. Existing scan-log pages stay first,
    // and duplicate URLs are eliminated, so this does not fan out repeatedly.
    for (const href of (navigation.value?.sectionLinks || []).slice(-12).reverse()) {
      if (!visitedPages.has(href)) pageQueue.push(href);
    }
  }
  return changed;
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

  const portal = await readPortalSessions(settings?.lookbackDays || 7);
  result.items = mergePortalAttendance(result.items, portal.sessions);
  result.scans.push(...portal.diagnostics);

  const courses = [...new Set(unresolvedItems(result).map((item) => String(item.course || "").toUpperCase()).filter(Boolean))];
  for (const course of courses) await resolveCourseFromMoodle(result, course);

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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || reconciliationRunning || !changes.latestScan?.newValue) return;
  const latestScan = changes.latestScan.newValue;
  if (latestScan?.mode !== "attendance-discovery") return;
  if (latestScan?.reconciliation?.version === RECONCILIATION_VERSION) return;

  const unresolved = unresolvedItems(latestScan).length;
  // Let the existing Gmail -> Ed -> Moodle fallback finish first. Reconciliation is the
  // deterministic final pass: it reads the Attendance completion state and exact Moodle
  // table cells instead of competing with the normal source scanner.
  if (unresolved && !latestScan?.moodleFallback?.version) return;

  reconciliationRunning = true;
  reconcile(latestScan)
    .then(async (reconciled) => {
      await chrome.storage.local.set({ latestScan: reconciled });
      const found = reconciled.items.filter((item) => item.code && item.confidence === "high").length;
      const completed = reconciled.items.filter((item) => item.completed).length;
      await chrome.notifications.create("attendance-reconciliation", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Attendance 最终核对完成",
        message: `共识别 ${reconciled.items.length} 节课：${completed} 节已签到，${found} 节找到可核对代码。`,
        priority: 1
      }).catch(() => {});
    })
    .catch(async (error) => {
      const failed = {
        ...latestScan,
        reconciliation: {
          version: RECONCILIATION_VERSION,
          status: "failed",
          error: error?.message || String(error),
          completedAt: new Date().toISOString()
        }
      };
      await chrome.storage.local.set({ latestScan: failed }).catch(() => {});
    })
    .finally(() => {
      reconciliationRunning = false;
    });
});
