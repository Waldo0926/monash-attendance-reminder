import { ATTENDANCE_URL, DEFAULT_SETTINGS, attendanceDate, detectWeekOneMonday, edThreadLinks, extractCandidates, findCourseLinks, hasUsableConfig, loadSettings, matchCodesToAttendance, moodleWeekLinks, parseDateKey, pickWeekNumbers, recentAttendanceDates, teachingWeek } from "./shared.js";

const PRIMARY_ALARM = "attendance-primary";
const BACKUP_ALARM = "attendance-backup";

function nextAlarm(weekday, hour, minute) {
  const now = new Date();
  const target = new Date(now);
  const days = (weekday - now.getDay() + 7) % 7;
  target.setDate(now.getDate() + days);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target.getTime();
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function configureAlarms() {
  const settings = await loadSettings();
  await chrome.alarms.clearAll();
  if (!hasUsableConfig(settings)) return;

  await chrome.alarms.create(PRIMARY_ALARM, {
    when: nextAlarm(settings.reminder.weekday, settings.reminder.hour, settings.reminder.minute),
    periodInMinutes: 10080
  });
  if (settings.backup.enabled) {
    await chrome.alarms.create(BACKUP_ALARM, {
      when: nextAlarm(settings.backup.weekday, settings.backup.hour, settings.backup.minute),
      periodInMinutes: 10080
    });
  }
}

async function waitForLoaded(tabId, timeoutMs = 25000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === "complete") {
    await pause(1200);
    return;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("页面加载超时"));
    }, timeoutMs);
    const listener = (updatedId, info) => {
      if (updatedId === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1200);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function confidenceRank(confidence) {
  return confidence === "high" ? 2 : confidence === "review" ? 1 : 0;
}

function sessionName(label, course) {
  const withoutCourse = String(label || "").replace(new RegExp(course, "ig"), " ").replace(/\s+/g, " ").trim();
  const match = withoutCourse.match(/(workshop|tutorial|studio|applied class|practical|laboratory|lab|seminar)[^|·,;]*/i);
  return (match?.[0] || withoutCourse || "Scheduled activity").trim();
}

// Opens a page in a background tab, lets content.js wait for it to finish rendering,
// and returns its visible text plus every link on it. Never throws.
async function readPage(url, { maxMs, waitFor, minMs } = {}) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoaded(tab.id);
    const page = await chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", maxMs, waitFor, minMs });
    if (page.loginRequired) throw new Error("需要重新登录");
    return { ok: true, url, text: page.text || "", links: page.links || [], gmailThreads: page.gmailThreads || [] };
  } catch (error) {
    return { ok: false, url, error: error.message, text: "", links: [], gmailThreads: [] };
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function discoverAttendance(settings) {
  const dates = recentAttendanceDates(new Date(), Number(settings.lookbackDays) || 7);
  const isoWindow = new Set(dates.map((date) => date.iso));
  const items = [];
  const errors = [];
  for (const date of dates) {
    const url = new URL("Units.aspx", ATTENDANCE_URL);
    url.hash = date.key;
    const page = await readPage(url.href);
    if (!page.ok) {
      errors.push(`${date.iso}: ${page.error}`);
      continue;
    }
    for (const link of page.links.filter((link) => link.href.includes("Entry.aspx"))) {
      const course = link.label.match(/\b[A-Z]{3}\d{4}\b/i)?.[0]?.toUpperCase();
      if (!course) continue;
      // Units.aspx preloads several days of sessions into the DOM at once and only
      // expands the one matching the hash, so the real date lives in the link's own
      // "d=" query param, not in whichever date this tab happened to be opened for.
      const linkDate = parseDateKey(new URL(link.href).searchParams.get("d"));
      if (!linkDate || !isoWindow.has(linkDate.iso)) continue;
      const label = sessionName(link.label, course);
      const time = link.label.match(/\b\d{1,2}:\d{2}\s?[ap]m\b/i)?.[0] || "";
      items.push({
        id: `attendance:${linkDate.iso}:${link.href}`,
        courseId: course.toLowerCase(),
        course,
        sessionId: label.toLowerCase().replace(/\W+/g, "-"),
        session: label,
        attendanceLabel: link.label,
        day: new Date(`${linkDate.iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" }),
        time,
        week: null,
        code: "",
        confidence: "missing",
        context: "",
        entryUrl: link.href,
        sourceUrl: link.href,
        attendanceDate: linkDate
      });
    }
  }
  return { items: [...new Map(items.map((item) => [item.id, item])).values()], errors };
}

// Codes are never on the landing pages. Ed puts them inside an announcement thread,
// Moodle inside the current week's section page, and Ed's own notification emails carry
// the full announcement body. So this walks:
//   Gmail search -> each matching email (staff post to Ed, Ed emails it out)
//   Ed dashboard -> each unit's discussion list -> threads titled attendance/code/week N
//   Moodle "My units" -> each unit's home page -> the section pages for this week ±1
// scanning every page it opens along the way.
async function automaticSourceScans(items, settings) {
  const codes = [...new Set(items.map((item) => item.course).filter(Boolean))];
  if (!codes.length) return [];
  const scans = [];
  const visited = new Set();
  const scan = async (url, options) => {
    if (!url || visited.has(url)) return null;
    visited.add(url);
    const page = await readPage(url, options);
    scans.push(page);
    return page;
  };

  const gmailTabs = await chrome.tabs.query({ url: "https://mail.google.com/*" });
  const gmailBase = gmailTabs[0]?.url?.match(/^(https:\/\/mail\.google\.com\/mail\/u\/\d+\/)/)?.[1] || "https://mail.google.com/mail/u/0/";
  const query = `(${codes.join(" OR ")}) attendance newer_than:21d`;
  // The search query already restricts results to these units + "attendance", so open
  // every result rather than re-filtering by row text: rows exist in the DOM before
  // their text is painted, and a title filter on unpainted rows drops everything.
  const search = await scan(`${gmailBase}#search/${encodeURIComponent(query)}`, { maxMs: 25000, waitFor: "tr.zA, [data-legacy-thread-id]", minMs: 2000 });
  if (search?.ok) {
    const ids = [...new Set(search.gmailThreads.map((thread) => thread.id))].slice(0, 8);
    for (const id of ids) await scan(`${gmailBase}#all/${id}`, { maxMs: 20000, waitFor: "div[role='listitem'], .a3s", minMs: 1500 });
  }

  const edDashboard = await scan("https://edstem.org/au/dashboard", { waitFor: "a[href*='/courses/']" });
  const edCourses = findCourseLinks(edDashboard?.links, codes, {
    hrefPattern: /\/courses\/\d+/,
    normaliseHref: (href) => href.replace(/(\/courses\/\d+).*$/, "$1/discussion")
  });
  for (const course of edCourses.slice(0, 8)) {
    const list = await scan(course.href, { waitFor: "a[href*='/discussion/']" });
    if (!list?.ok) continue;
    // The thread body renders after the list; give it a floor so we don't read a page
    // that has the sidebar painted but the post itself still loading.
    for (const threadUrl of edThreadLinks(list.links)) await scan(threadUrl, { maxMs: 12000, minMs: 3000 });
  }

  const myUnits = await scan("https://learning.monash.edu/my/courses.php", { maxMs: 15000, waitFor: "a[href*='course/view.php?id=']" });
  const moodleCourses = findCourseLinks(myUnits?.links, codes, {
    hrefPattern: /\/course\/view\.php\?id=\d+/,
    normaliseHref: (href) => href.replace(/(\/course\/view\.php\?id=\d+).*$/, "$1")
  });
  const itemDates = [...new Set(items.map((item) => item.attendanceDate?.iso).filter(Boolean))];
  for (const course of moodleCourses.slice(0, 8)) {
    const home = await scan(course.href, { waitFor: "a[href*='section']" });
    if (!home?.ok) continue;
    const weekOneMonday = settings.weekOneMonday || detectWeekOneMonday(home.text);
    const targetWeeks = weekOneMonday
      ? [...new Set(itemDates.map((iso) => teachingWeek({ weekOneMonday }, new Date(`${iso}T12:00:00`))))]
      : [];
    const weekLinks = moodleWeekLinks(home.links);
    for (const week of pickWeekNumbers(weekLinks.keys(), targetWeeks)) await scan(weekLinks.get(week));
  }

  return scans;
}

async function scanCourse(course, week) {
  const page = await readPage(course.url);
  if (page.ok) return { courseId: course.id, ok: true, items: extractCandidates(page.text, course, week) };
  return {
    courseId: course.id,
    ok: false,
    error: page.error,
    items: (course.sessions || []).map((session) => ({
      id: `${course.id}:${session.id}:w${week}`,
      courseId: course.id,
      course: course.name,
      sessionId: session.id,
      session: session.label,
      day: session.day,
      time: session.time,
      week,
      code: "",
      confidence: "missing",
      context: "",
      sourceUrl: course.url
    }))
  };
}

async function scanAll(reason = "manual") {
  const settings = await loadSettings();
  if (!hasUsableConfig(settings)) {
    const result = { reason, week: null, scannedAt: new Date().toISOString(), items: [], scans: [], notConfigured: true };
    await chrome.storage.local.set({ latestScan: result });
    await chrome.notifications.create("attendance-scan", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Attendance Helper 尚未配置",
      message: "请先设置有效提醒时间；课程可由 Attendance 自动识别。",
      priority: 1
    });
    return result;
  }

  if (settings.autoDiscover !== false) {
    const discovered = await discoverAttendance(settings);
    const sourceScans = await automaticSourceScans(discovered.items, settings);
    // Match against each source page separately rather than one concatenated blob: joining
    // texts together let a code found near the end of one page's content "see" course names
    // from the start of the next page as nearby context, producing confident-looking matches
    // that were really just two unrelated pages bleeding into each other.
    let items = discovered.items;
    for (const scan of sourceScans) {
      if (!scan.ok) continue;
      const matched = matchCodesToAttendance(scan.text, items);
      items = items.map((item, index) => {
        const candidate = matched[index];
        if (candidate.code && confidenceRank(candidate.confidence) > confidenceRank(item.confidence)) {
          return { ...item, code: candidate.code, confidence: candidate.confidence, context: candidate.context, sourceUrl: scan.url };
        }
        return item;
      });
    }
    // Keep only a summary of each scan: full page text for a dozen pages would blow past
    // chrome.storage.local's quota and make the whole save fail silently.
    const scans = sourceScans.map(({ ok, url, error, text, links, gmailThreads }) => ({
      ok,
      url,
      error,
      textLength: (text || "").length,
      linkCount: (links || []).length,
      threadCount: (gmailThreads || []).length,
      // How many 5-char letter+digit tokens the page had at all: zero on a page that
      // visibly shows a code table means the table isn't text (image, canvas, iframe).
      codeLikeCount: ((text || "").match(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b/g) || []).length,
      excerpt: (text || "").slice(0, 20000)
    }));
    const result = { reason, mode: "attendance-discovery", week: null, scannedAt: new Date().toISOString(), items, scans, discoveryErrors: discovered.errors };
    await chrome.storage.local.set({ latestScan: result });
    const found = items.filter((item) => item.code).length;
    await chrome.notifications.create("attendance-scan", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "最近 7 天 Attendance 已检查",
      message: items.length ? `识别到 ${items.length} 节课，找到 ${found} 个代码。点击核对。` : "Attendance 最近 7 天没有显示可填写的课程，或当前账号需要重新登录。",
      priority: 2,
      requireInteraction: true
    });
    return result;
  }

  const week = teachingWeek(settings);
  if (!Number.isFinite(week)) throw new Error("Week 1 日期无效，请检查扩展设置。");

  const scans = [];
  for (const course of settings.courses.filter((item) => item.enabled !== false && item.url && item.sessions?.length)) {
    scans.push(await scanCourse(course, week));
  }
  const items = scans.flatMap((scan) => scan.items).map((item) => ({
    ...item,
    attendanceDate: attendanceDate(settings, week, item.day)
  }));
  const result = { reason, week, scannedAt: new Date().toISOString(), items, scans };
  await chrome.storage.local.set({ latestScan: result });
  const found = items.filter((item) => item.code).length;
  const missing = items.length - found;
  await chrome.notifications.create("attendance-scan", {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `Week ${week} 签到码已检查`,
    message: found
      ? `找到 ${found} 个，${missing ? `${missing} 个需人工核对。` : "全部找到。"} 点击查看并确认。`
      : "暂时没有找到代码。请确认已登录 Moodle/Ed，或稍后重试。",
    priority: 2,
    requireInteraction: true
  });
  return result;
}

async function submitOne(item, settings) {
  if (item.entryUrl) {
    const tab = await chrome.tabs.create({ url: item.entryUrl, active: true });
    await waitForLoaded(tab.id);
    const outcome = await chrome.tabs.sendMessage(tab.id, {
      type: "FILL_ATTENDANCE_CODE",
      code: item.code,
      commit: true
    });
    return { ...outcome, tabId: tab.id };
  }

  const date = item.attendanceDate || attendanceDate(settings, item.week, item.day);
  if (!date) return { ok: false, error: "无法计算签到日期，请检查 Week 1 和班次星期设置。" };
  const unitsUrl = new URL("Units.aspx", ATTENDANCE_URL);
  unitsUrl.hash = date.key;
  const tab = await chrome.tabs.create({ url: unitsUrl.href, active: true });
  await waitForLoaded(tab.id);
  const session = await chrome.tabs.sendMessage(tab.id, {
    type: "FIND_ATTENDANCE_SESSION",
    course: item.course,
    session: item.session,
    attendanceLabel: item.attendanceLabel
  });
  if (!session.ok) return { ...session, tabId: tab.id };
  await chrome.tabs.update(tab.id, { url: session.href });
  await waitForLoaded(tab.id);
  const outcome = await chrome.tabs.sendMessage(tab.id, {
    type: "FILL_ATTENDANCE_CODE",
    code: item.code,
    commit: true
  });
  return { ...outcome, tabId: tab.id };
}

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  await configureAlarms();
});

chrome.runtime.onStartup.addListener(configureAlarms);
chrome.alarms.onAlarm.addListener((alarm) => {
  if ([PRIMARY_ALARM, BACKUP_ALARM].includes(alarm.name)) scanAll(alarm.name);
});
chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("review.html") }));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SCAN_ALL") {
    scanAll("manual").then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "SETTINGS_CHANGED") {
    configureAlarms().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "OPEN_REVIEW") {
    chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "SUBMIT_CODES") {
    (async () => {
      const settings = await loadSettings();
      const { lastSubmission } = await chrome.storage.local.get("lastSubmission");
      const completed = new Set((lastSubmission?.outcomes || []).filter((item) => item.ok).map((item) => item.id));
      const outcomes = [];
      for (const item of message.items) {
        if (completed.has(item.id)) {
          outcomes.push({ id: item.id, code: item.code, ok: true, skipped: true, message: "本机已记录为提交成功，已跳过去重" });
          continue;
        }
        try {
          outcomes.push({ id: item.id, code: item.code, ...(await submitOne(item, settings)) });
        } catch (error) {
          outcomes.push({ id: item.id, code: item.code, ok: false, error: error.message });
        }
      }
      await chrome.storage.local.set({ lastSubmission: { at: new Date().toISOString(), outcomes: [...(lastSubmission?.outcomes || []), ...outcomes] } });
      sendResponse({ ok: outcomes.every((item) => item.ok), outcomes });
    })();
    return true;
  }
});
