import {
  courseCodesInText,
  detectWeekOneMonday,
  inferWeekNumbersFromText,
  matchCodesToAttendance,
  moodleWeekLinks,
  pickWeekNumbers,
  teachingWeek
} from "./shared.js";

const FALLBACK_VERSION = 1;
let fallbackRunning = false;

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function confidenceRank(value) {
  return value === "high" ? 2 : value === "review" ? 1 : 0;
}

async function waitForLoaded(tabId, timeoutMs = 22000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === "complete") {
    await pause(900);
    return;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Moodle 页面加载超时"));
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

async function readPage(url, { maxMs = 14000, waitFor = "", minMs = 1000 } = {}) {
  const existing = (await chrome.tabs.query({})).find((tab) => tab.url === url);
  const tab = existing || await chrome.tabs.create({ url, active: false });
  const owned = !existing;
  try {
    await waitForLoaded(tab.id);
    let page;
    try {
      page = await chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", maxMs, waitFor, minMs });
    } catch (error) {
      if (!/receiving end|could not establish connection/i.test(String(error?.message || error))) throw error;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await pause(150);
      page = await chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", maxMs, waitFor, minMs });
    }
    if (page?.loginRequired) throw new Error("Moodle 需要重新登录");
    return {
      ok: true,
      url: page?.url || url,
      title: page?.title || "",
      text: page?.text || "",
      links: page?.links || [],
      images: page?.images || []
    };
  } catch (error) {
    return { ok: false, url, title: "", text: "", links: [], images: [], error: error?.message || String(error) };
  } finally {
    if (owned && tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function scanSummary(page, courses = []) {
  const text = page?.text || "";
  return {
    ok: Boolean(page?.ok),
    url: page?.url || "",
    courses: courses.map((course) => String(course).toLowerCase()),
    error: page?.error,
    textLength: text.length,
    linkCount: (page?.links || []).length,
    imageCount: (page?.images || []).length,
    ocrLength: 0,
    ocrSelectedCount: 0,
    ocrDetails: [],
    threadCount: 0,
    codeLikeCount: (text.match(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5}\b/g) || []).length,
    excerpt: text.slice(0, 7000)
  };
}

function unresolvedCourses(result) {
  return [...new Set((result.items || [])
    .filter((item) => !item.code || item.confidence !== "high")
    .map((item) => String(item.course || "").toUpperCase())
    .filter(Boolean))];
}

function courseFullyResolved(result, course) {
  const rows = (result.items || []).filter((item) => String(item.course || "").toUpperCase() === course);
  return rows.length > 0 && rows.every((item) => item.code && item.confidence === "high");
}

function identifyCourse(page, candidates) {
  const fromTitle = courseCodesInText(page?.title || "", candidates);
  if (fromTitle.length === 1) return String(fromTitle[0]).toUpperCase();
  const fromBody = courseCodesInText((page?.text || "").slice(0, 16000), candidates);
  return fromBody.length === 1 ? String(fromBody[0]).toUpperCase() : "";
}

function moodleCourseCandidates(links) {
  const seen = new Set();
  const result = [];
  for (const link of links || []) {
    try {
      const url = new URL(link.href);
      if (url.hostname !== "learning.monash.edu" || url.pathname !== "/course/view.php") continue;
      const id = url.searchParams.get("id");
      if (!/^\d+$/.test(id || "")) continue;
      const href = `${url.origin}${url.pathname}?id=${id}`;
      if (seen.has(href)) continue;
      seen.add(href);
      result.push({ href, clue: `${link.label || ""} ${link.context || ""}`.trim() });
    } catch {
      // Ignore malformed links from page chrome.
    }
  }
  return result;
}

function attendanceActivityCandidates(page) {
  const seen = new Map();
  for (const link of page?.links || []) {
    try {
      const url = new URL(link.href, page.url);
      if (url.hostname !== "learning.monash.edu" || !/\/mod\/[^/]+\/view\.php/i.test(url.pathname)) continue;
      const clue = `${link.label || ""} ${link.context || ""}`.replace(/\s+/g, " ").trim();
      if (!/attendance/i.test(clue)) continue;
      let score = 10;
      if (/attendance\s+codes?|attendance\s+code/i.test(clue)) score += 100;
      if (/international\s+student/i.test(clue)) score += 40;
      if (/\bweek\s*\d{1,2}\b/i.test(clue)) score += 10;
      if (/policy|requirement|guideline/i.test(clue) && !/codes?/i.test(clue)) score -= 30;
      const href = url.href.split("#")[0];
      const previous = seen.get(href);
      if (!previous || score > previous.score) seen.set(href, { href, score });
    } catch {
      // Ignore malformed activity links.
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 4);
}

function applyMatches(result, page, course) {
  if (!page?.ok || !page.text) return false;
  const indexes = (result.items || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => String(item.course || "").toUpperCase() === course)
    .filter(({ item }) => !item.code || item.confidence !== "high");
  if (!indexes.length) return false;

  const matched = matchCodesToAttendance(page.text, indexes.map(({ item }) => item));
  let changed = false;
  matched.forEach((candidate, localIndex) => {
    const index = indexes[localIndex].index;
    const current = result.items[index];
    if (!candidate.code || confidenceRank(candidate.confidence) <= confidenceRank(current.confidence)) return;
    result.items[index] = {
      ...current,
      code: candidate.code,
      confidence: candidate.confidence,
      context: candidate.context,
      sourceUrl: page.url
    };
    changed = true;
  });
  return changed;
}

function targetWeeksForCourse(home, result, course, settings) {
  const courseDates = (result.items || [])
    .filter((item) => String(item.course || "").toUpperCase() === course)
    .map((item) => item.attendanceDate)
    .filter(Boolean);
  const weekOneMonday = settings?.weekOneMonday || detectWeekOneMonday(home.text);
  let targets = weekOneMonday
    ? [...new Set(courseDates
      .map((date) => teachingWeek({ weekOneMonday }, new Date(`${date.iso}T12:00:00`)))
      .filter(Number.isFinite))]
    : inferWeekNumbersFromText(home.text, courseDates);
  return targets;
}

async function scanAttendanceActivities(result, page, course, scans) {
  applyMatches(result, page, course);
  if (courseFullyResolved(result, course)) return;

  for (const activity of attendanceActivityCandidates(page)) {
    const activityPage = await readPage(activity.href, { maxMs: 14000, minMs: 1200 });
    scans.push(scanSummary(activityPage, [course]));
    applyMatches(result, activityPage, course);
    if (courseFullyResolved(result, course)) return;
  }
}

async function enrichWithMoodle(latestScan) {
  const result = {
    ...latestScan,
    items: (latestScan.items || []).map((item) => ({ ...item })),
    scans: [...(latestScan.scans || [])]
  };

  const initialUnresolved = unresolvedCourses(result);
  if (!initialUnresolved.length) {
    result.moodleFallback = { version: FALLBACK_VERSION, status: "not-needed", completedAt: new Date().toISOString() };
    return result;
  }

  const { settings } = await chrome.storage.local.get("settings");
  const fallbackScans = [];
  const myUnits = await readPage("https://learning.monash.edu/my/courses.php", {
    maxMs: 16000,
    waitFor: "a[href*='course/view.php?id=']",
    minMs: 1000
  });
  fallbackScans.push(scanSummary(myUnits, []));
  if (!myUnits.ok) {
    result.scans.push(...fallbackScans);
    result.moodleFallback = {
      version: FALLBACK_VERSION,
      status: "failed",
      error: myUnits.error || "无法读取 Moodle My units",
      completedAt: new Date().toISOString()
    };
    return result;
  }

  const candidates = moodleCourseCandidates(myUnits.links);
  let recognised = 0;
  for (const candidate of candidates.slice(0, 16)) {
    const stillNeeded = unresolvedCourses(result);
    if (!stillNeeded.length) break;

    const home = await readPage(candidate.href, {
      maxMs: 15000,
      waitFor: "a[href*='section']",
      minMs: 1000
    });
    if (!home.ok) {
      fallbackScans.push(scanSummary(home, []));
      continue;
    }

    const course = identifyCourse(home, stillNeeded);
    if (!course) continue;
    recognised += 1;
    fallbackScans.push(scanSummary(home, [course]));
    await scanAttendanceActivities(result, home, course, fallbackScans);
    if (courseFullyResolved(result, course)) continue;

    const weekLinks = moodleWeekLinks(home.links);
    const available = [...weekLinks.keys()];
    const targets = targetWeeksForCourse(home, result, course, settings || {});
    const exact = targets.length ? available.filter((week) => targets.includes(week)) : [];
    const selected = exact.length ? exact : pickWeekNumbers(available, targets);

    for (const week of selected.slice(0, 5)) {
      const href = weekLinks.get(week);
      if (!href) continue;
      const section = await readPage(href, { maxMs: 15000, minMs: 1200 });
      fallbackScans.push(scanSummary(section, [course]));
      await scanAttendanceActivities(result, section, course, fallbackScans);
      if (courseFullyResolved(result, course)) break;
    }
  }

  result.scans.push(...fallbackScans);
  result.moodleFallback = {
    version: FALLBACK_VERSION,
    status: "complete",
    recognisedCoursePages: recognised,
    remainingCourses: unresolvedCourses(result),
    completedAt: new Date().toISOString()
  };
  return result;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.latestScan?.newValue || fallbackRunning) return;
  const latestScan = changes.latestScan.newValue;
  if (latestScan?.mode !== "attendance-discovery") return;
  if (latestScan?.moodleFallback?.version === FALLBACK_VERSION) return;
  if (!unresolvedCourses(latestScan).length) return;

  fallbackRunning = true;
  enrichWithMoodle(latestScan)
    .then(async (enriched) => {
      await chrome.storage.local.set({ latestScan: enriched });
      const found = (enriched.items || []).filter((item) => item.code).length;
      const remaining = unresolvedCourses(enriched).length;
      await chrome.notifications.create("attendance-moodle-fallback", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Moodle 签到码补充检查完成",
        message: `已找到 ${found}/${(enriched.items || []).length} 个代码${remaining ? `，仍有 ${remaining} 门课程需要人工核对。` : "。"}`,
        priority: 1
      }).catch(() => {});
    })
    .catch(async (error) => {
      const failed = {
        ...latestScan,
        moodleFallback: {
          version: FALLBACK_VERSION,
          status: "failed",
          error: error?.message || String(error),
          completedAt: new Date().toISOString()
        }
      };
      await chrome.storage.local.set({ latestScan: failed }).catch(() => {});
    })
    .finally(() => {
      fallbackRunning = false;
    });
});
