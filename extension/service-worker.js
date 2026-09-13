import { ATTENDANCE_URL, DEFAULT_SETTINGS, attendanceDate, extractCandidates, hasUsableConfig, loadSettings, matchCodesToAttendance, parseDateKey, recentAttendanceDates, teachingWeek } from "./shared.js";

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

function sessionName(label, course) {
  const withoutCourse = String(label || "").replace(new RegExp(course, "ig"), " ").replace(/\s+/g, " ").trim();
  const match = withoutCourse.match(/(workshop|tutorial|studio|applied class|practical|laboratory|lab|seminar)[^|·,;]*/i);
  return (match?.[0] || withoutCourse || "Scheduled activity").trim();
}

async function discoverAttendance(settings) {
  const dates = recentAttendanceDates(new Date(), Number(settings.lookbackDays) || 7);
  const isoWindow = new Set(dates.map((date) => date.iso));
  const items = [];
  const errors = [];
  for (const date of dates) {
    const url = new URL("Units.aspx", ATTENDANCE_URL);
    url.hash = date.key;
    const tab = await chrome.tabs.create({ url: url.href, active: false });
    try {
      await waitForLoaded(tab.id);
      const page = await chrome.tabs.sendMessage(tab.id, { type: "DISCOVER_ATTENDANCE_SESSIONS" });
      for (const link of page.links || []) {
        const course = link.label.match(/\b[A-Z]{3}\d{4}\b/i)?.[0]?.toUpperCase();
        if (!course) continue;
        // Units.aspx preloads several days of sessions into the DOM at once and only
        // expands the one matching the hash, so the real date lives in the link's own
        // "d=" query param, not in whichever date this tab happened to be opened for.
        const linkDate = parseDateKey(new URL(link.href).searchParams.get("d"));
        if (!linkDate || !isoWindow.has(linkDate.iso)) continue;
        const label = sessionName(link.label, course);
        items.push({
          id: `attendance:${linkDate.iso}:${link.href}`,
          courseId: course.toLowerCase(),
          course,
          sessionId: label.toLowerCase().replace(/\W+/g, "-"),
          session: label,
          attendanceLabel: link.label,
          day: new Date(`${linkDate.iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" }),
          time: "",
          week: null,
          code: "",
          confidence: "missing",
          context: "",
          entryUrl: link.href,
          sourceUrl: link.href,
          attendanceDate: linkDate
        });
      }
    } catch (error) {
      errors.push(`${date.iso}: ${error.message}`);
    } finally {
      if (tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
  return { items: [...new Map(items.map((item) => [item.id, item])).values()], errors };
}

async function scanTextUrl(url, waitMs = 1800) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoaded(tab.id);
    await pause(waitMs);
    const page = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_SOURCE" });
    if (page.loginRequired) throw new Error("需要重新登录");
    return { ok: true, url, text: page.text || "" };
  } catch (error) {
    return { ok: false, url, error: error.message, text: "" };
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function discoverCourseUrls(dashboardUrl, courseCodes) {
  const tab = await chrome.tabs.create({ url: dashboardUrl, active: false });
  try {
    await waitForLoaded(tab.id);
    await pause(1800);
    const page = await chrome.tabs.sendMessage(tab.id, { type: "DISCOVER_COURSE_LINKS", courseCodes });
    return [...new Set((page.links || []).map((item) => item.href))].slice(0, 20);
  } catch {
    return [];
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function automaticSourceScans(items) {
  const codes = [...new Set(items.map((item) => item.course).filter(Boolean))];
  if (!codes.length) return [];
  const dates = items.map((item) => item.attendanceDate?.iso).filter(Boolean).sort();
  const after = dates[0]?.replaceAll("-", "/");
  const beforeDate = new Date(`${dates.at(-1)}T12:00:00`);
  beforeDate.setDate(beforeDate.getDate() + 1);
  const before = `${beforeDate.getFullYear()}/${String(beforeDate.getMonth() + 1).padStart(2, "0")}/${String(beforeDate.getDate()).padStart(2, "0")}`;
  const query = `(${codes.join(" OR ")}) attendance after:${after} before:${before}`;
  const gmailTabs = await chrome.tabs.query({ url: "https://mail.google.com/*" });
  const gmailBase = gmailTabs[0]?.url?.match(/^(https:\/\/mail\.google\.com\/mail\/u\/\d+\/)/)?.[1] || "https://mail.google.com/mail/";
  const urls = [`${gmailBase}#search/${encodeURIComponent(query)}`];
  urls.push(...await discoverCourseUrls("https://learning.monash.edu/my/courses.php", codes));
  urls.push(...await discoverCourseUrls("https://edstem.org/au/dashboard", codes));
  const scans = [];
  for (const url of [...new Set(urls)]) scans.push(await scanTextUrl(url, url.includes("mail.google.com") ? 4500 : 1800));
  return scans;
}

async function scanCourse(course, week) {
  const tab = await chrome.tabs.create({ url: course.url, active: false });
  try {
    await waitForLoaded(tab.id);
    const page = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_SOURCE" });
    if (page.loginRequired) throw new Error("需要重新登录");
    return { courseId: course.id, ok: true, items: extractCandidates(page.text, course, week) };
  } catch (error) {
    return {
      courseId: course.id,
      ok: false,
      error: error.message,
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
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
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
    const sourceScans = await automaticSourceScans(discovered.items);
    const combinedText = sourceScans.filter((scan) => scan.ok).map((scan) => scan.text).join("\n");
    const items = matchCodesToAttendance(combinedText, discovered.items).map((item) => ({
      ...item,
      sourceUrl: sourceScans.find((scan) => scan.ok && item.code && scan.text.includes(item.code))?.url || item.sourceUrl
    }));
    const result = { reason, mode: "attendance-discovery", week: null, scannedAt: new Date().toISOString(), items, scans: sourceScans, discoveryErrors: discovered.errors };
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
