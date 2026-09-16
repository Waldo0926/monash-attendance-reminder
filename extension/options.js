import { DEFAULT_SETTINGS, loadSettings, sendMessageWithTimeout, validSchedule } from "./shared.js";

let settings;
const coursesRoot = document.querySelector("#courses");
const manualSection = document.querySelector("#manualSection");
const status = document.querySelector("#status");

function syncManualSectionVisibility() {
  manualSection.hidden = document.querySelector("#autoDiscover").checked;
}
const CLASS_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function timeValue(item) {
  return `${String(item?.hour ?? 0).padStart(2, "0")}:${String(item?.minute ?? 0).padStart(2, "0")}`;
}

function parseTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) return { hour: NaN, minute: NaN };
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

function validCourseUrl(course) {
  try {
    const url = new URL(course.url);
    if (url.protocol !== "https:") return false;
    if (course.source === "moodle") return url.hostname === "learning.monash.edu";
    return url.hostname === "edstem.org" || url.hostname.endsWith(".edstem.org");
  } catch {
    return false;
  }
}

function uniqueId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankSession() {
  return { id: uniqueId("session"), label: "", day: "Monday", time: "09:00", aliases: [] };
}

function blankCourse() {
  return {
    id: uniqueId("course"),
    name: "",
    source: "moodle",
    url: "",
    category: "",
    enabled: true,
    sessions: [blankSession()]
  };
}

function normaliseSettings(value) {
  const base = structuredClone(DEFAULT_SETTINGS);
  return {
    ...base,
    ...(value || {}),
    timezone: deviceTimeZone(),
    autoDiscover: value?.autoDiscover !== false,
    reminder: { ...base.reminder, ...(value?.reminder || {}) },
    backup: { ...base.backup, ...(value?.backup || {}) },
    courses: Array.isArray(value?.courses) ? value.courses.map((course) => ({
      id: course.id || uniqueId("course"),
      name: course.name || "",
      source: course.source === "ed" ? "ed" : "moodle",
      url: course.url || "",
      category: course.category || "",
      enabled: course.enabled !== false,
      sessions: Array.isArray(course.sessions) ? course.sessions.map((session) => ({
        id: session.id || uniqueId("session"),
        label: session.label || "",
        day: CLASS_DAYS.includes(session.day) ? session.day : "Monday",
        time: session.time || "09:00",
        aliases: Array.isArray(session.aliases) ? session.aliases : []
      })) : []
    })) : []
  };
}

function renderCourses() {
  if (!settings.courses.length) {
    coursesRoot.innerHTML = '<div class="card empty"><strong>还没有课程</strong><p>点击“添加课程”，把你自己的 Moodle / Ed 页面和实际参加的班次加进来。</p></div>';
    return;
  }

  coursesRoot.innerHTML = settings.courses.map((course, courseIndex) => `
    <article class="card course" data-course="${courseIndex}">
      <div class="row course-header">
        <label class="inline-label">启用 <input class="enabled" type="checkbox" ${course.enabled === false ? "" : "checked"}></label>
        <button class="danger remove-course" type="button">删除课程</button>
      </div>
      <div class="course-grid">
        <label>课程代码 / 名称</label><input class="name" type="text" value="${escapeHtml(course.name)}" placeholder="例如 FIT2102">
        <label>来源</label><select class="source"><option value="moodle" ${course.source === "moodle" ? "selected" : ""}>Moodle</option><option value="ed" ${course.source === "ed" ? "selected" : ""}>Ed Discussion</option></select>
        <label>发布页面</label><input class="url" type="url" value="${escapeHtml(course.url)}" placeholder="粘贴课程 Moodle / Ed 页面链接">
        <label>Ed 板块（可选）</label><input class="category" type="text" value="${escapeHtml(course.category || "")}" placeholder="例如 Malaysia；Moodle 可留空">
      </div>
      <div class="session-heading row"><strong>班次</strong><button class="secondary add-session" type="button">＋ 添加班次</button></div>
      <div class="sessions">
        ${(course.sessions || []).map((session, sessionIndex) => `
          <div class="session editable" data-session="${sessionIndex}">
            <input class="label" value="${escapeHtml(session.label)}" aria-label="班次" placeholder="例如 Tutorial 03">
            <select class="day" aria-label="星期">
              ${CLASS_DAYS.map((day) => `<option value="${day}" ${session.day === day ? "selected" : ""}>${day}</option>`).join("")}
            </select>
            <input class="time" type="time" value="${escapeHtml(session.time || "09:00")}" aria-label="时间">
            <button class="danger remove-session" type="button">删除</button>
          </div>`).join("") || '<p class="muted">还没有班次，请添加至少一个你实际参加的班次。</p>'}
      </div>
    </article>`).join("");
}

function collectCoursesFromDom() {
  [...coursesRoot.querySelectorAll("[data-course]")].forEach((card) => {
    const course = settings.courses[Number(card.dataset.course)];
    course.enabled = card.querySelector(".enabled").checked;
    course.name = card.querySelector(".name").value.trim();
    course.source = card.querySelector(".source").value;
    course.url = card.querySelector(".url").value.trim();
    course.category = card.querySelector(".category").value.trim();
    [...card.querySelectorAll("[data-session]")].forEach((row) => {
      const session = course.sessions[Number(row.dataset.session)];
      session.label = row.querySelector(".label").value.trim();
      session.day = row.querySelector(".day").value;
      session.time = row.querySelector(".time").value;
      const compact = session.label.replace(/\b0+(\d+)/g, "$1");
      session.aliases = [...new Set([session.label, compact].filter(Boolean))];
    });
  });
}

function collectTopLevel() {
  settings.weekOneMonday = document.querySelector("#weekOneMonday").value;
  settings.autoDiscover = document.querySelector("#autoDiscover").checked;
  settings.timezone = deviceTimeZone();
  settings.reminder.weekday = Number(document.querySelector("#primaryDay").value);
  Object.assign(settings.reminder, parseTime(document.querySelector("#primaryTime").value));
  settings.backup.enabled = document.querySelector("#backupEnabled").checked;
  settings.backup.weekday = Number(document.querySelector("#backupDay").value);
  Object.assign(settings.backup, parseTime(document.querySelector("#backupTime").value));
}

function validate() {
  if (settings.autoDiscover === false && (!settings.weekOneMonday || Number.isNaN(new Date(`${settings.weekOneMonday}T00:00:00`).getTime()))) {
    return "请设置有效的 Week 1 星期一日期。";
  }
  if (!validSchedule(settings.reminder)) return "请填写完整且有效的主提醒时间。";
  if (settings.backup.enabled && !validSchedule(settings.backup)) return "请填写完整且有效的备用提醒时间。";

  const enabledCourses = settings.courses.filter((course) => course.enabled !== false);
  if (settings.autoDiscover !== false) return "";
  if (!enabledCourses.length) return "请至少添加并启用一门课程。";
  for (const course of enabledCourses) {
    if (!course.name) return "每门启用的课程都需要填写课程代码或名称。";
    if (!course.url) return `${course.name} 还没有填写课程页面链接。`;
    if (!validCourseUrl(course)) {
      return course.source === "moodle"
        ? `${course.name} 的 Moodle 链接必须来自 learning.monash.edu。`
        : `${course.name} 的 Ed 链接必须来自 edstem.org。`;
    }
    if (!course.sessions.length) return `${course.name} 至少需要一个班次。`;
    for (const session of course.sessions) {
      if (!session.label || !CLASS_DAYS.includes(session.day) || !/^\d{2}:\d{2}$/.test(session.time)) {
        return `${course.name} 有班次信息未填写完整。`;
      }
    }
  }
  return "";
}

async function collectAndSave() {
  collectTopLevel();
  collectCoursesFromDom();
  const error = validate();
  if (error) {
    status.textContent = error;
    return false;
  }
  await chrome.storage.local.set({ settings });
  await chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
  status.textContent = "已保存，定时检查已启用。";
  return true;
}

async function init() {
  settings = normaliseSettings(await loadSettings());
  document.querySelector("#weekOneMonday").value = settings.weekOneMonday || "";
  document.querySelector("#autoDiscover").checked = settings.autoDiscover !== false;
  document.querySelector("#timezone").value = deviceTimeZone();
  document.querySelector("#primaryDay").value = settings.reminder.weekday;
  document.querySelector("#primaryTime").value = timeValue(settings.reminder);
  document.querySelector("#backupEnabled").checked = settings.backup.enabled;
  document.querySelector("#backupDay").value = settings.backup.weekday;
  document.querySelector("#backupTime").value = timeValue(settings.backup);
  renderCourses();
  syncManualSectionVisibility();
}

document.querySelector("#autoDiscover").addEventListener("change", syncManualSectionVisibility);

document.querySelector("#addCourse").addEventListener("click", () => {
  collectCoursesFromDom();
  settings.courses.push(blankCourse());
  renderCourses();
});

coursesRoot.addEventListener("click", (event) => {
  const card = event.target.closest("[data-course]");
  if (!card) return;
  const courseIndex = Number(card.dataset.course);
  collectCoursesFromDom();

  if (event.target.closest(".remove-course")) {
    settings.courses.splice(courseIndex, 1);
    renderCourses();
    return;
  }
  if (event.target.closest(".add-session")) {
    settings.courses[courseIndex].sessions.push(blankSession());
    renderCourses();
    return;
  }
  const row = event.target.closest("[data-session]");
  if (row && event.target.closest(".remove-session")) {
    settings.courses[courseIndex].sessions.splice(Number(row.dataset.session), 1);
    renderCourses();
  }
});

document.querySelector("#save").addEventListener("click", collectAndSave);
document.querySelector("#scan").addEventListener("click", async () => {
  if (!(await collectAndSave())) return;
  // SCAN_ALL now chains the preliminary scan and the final reconciliation inside one
  // background message handler instead of requiring this page to send a follow-up
  // RUN_FINAL_RECONCILIATION message. Two round trips meant this page's own JS had to stay
  // alive long enough to send the second one - closing this tab (or, for the equivalent
  // popup.js flow, closing the popup) mid-scan silently dropped reconciliation entirely.
  status.textContent = "正在检查 Gmail / Ed / Moodle 与 Attendance，并做最终核对…";
  let scan;
  try {
    scan = await sendMessageWithTimeout({ type: "SCAN_ALL" });
  } catch (error) {
    status.textContent = `检查超时：${error.message}`;
    return;
  }
  if (!scan?.ok) {
    status.textContent = `检查失败：${scan?.error || "未知错误"}`;
    return;
  }
  const result = scan.result || {};
  const items = result.items || [];
  status.textContent = result.reconciliation?.status === "failed"
    ? `最终核对未完成：${result.reconciliation.error || "未知错误"}`
    : `检查完成：识别 ${items.length} 节，已签到 ${items.filter((item) => item.completed).length} 节，找到代码 ${items.filter((item) => item.code).length} 个。`;
});
document.querySelector("#import").addEventListener("click", () => document.querySelector("#importFile").click());
document.querySelector("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.courses)) throw new Error("配置格式不正确");
    settings = normaliseSettings(parsed);
    const error = validate();
    if (error) throw new Error(error);
    await chrome.storage.local.set({ settings });
    await chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
    location.reload();
  } catch (error) {
    status.textContent = `导入失败：${error.message}`;
  }
});

init().catch((error) => {
  settings = structuredClone(DEFAULT_SETTINGS);
  renderCourses();
  status.textContent = `设置加载失败：${error.message}`;
});