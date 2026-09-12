import { ATTENDANCE_URL, DEFAULT_SETTINGS, attendanceDate, extractCandidates, loadSettings, teachingWeek } from "./shared.js";

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

async function configureAlarms() {
  const settings = await loadSettings();
  await chrome.alarms.clearAll();
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

function waitForLoaded(tabId, timeoutMs = 25000) {
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
      items: course.sessions.map((session) => ({
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
  const week = teachingWeek(settings);
  const scans = [];
  for (const course of settings.courses.filter((item) => item.enabled !== false)) {
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
  const date = item.attendanceDate || attendanceDate(settings, item.week, item.day);
  const unitsUrl = new URL("student/Units.aspx", ATTENDANCE_URL);
  unitsUrl.hash = date.key;
  const tab = await chrome.tabs.create({ url: unitsUrl.href, active: true });
  await waitForLoaded(tab.id);
  const session = await chrome.tabs.sendMessage(tab.id, {
    type: "FIND_ATTENDANCE_SESSION",
    course: item.course,
    session: item.session
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
