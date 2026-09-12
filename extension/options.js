import { DEFAULT_SETTINGS, loadSettings } from "./shared.js";

let settings;
const coursesRoot = document.querySelector("#courses");

function timeValue(item) { return `${String(item.hour).padStart(2,"0")}:${String(item.minute).padStart(2,"0")}`; }
function parseTime(value) { const [hour, minute] = value.split(":").map(Number); return { hour, minute }; }

function renderCourses() {
  coursesRoot.innerHTML = settings.courses.map((course, courseIndex) => `
    <article class="card course" data-course="${courseIndex}">
      <div class="row"><h2>${course.name}</h2><label>启用 <input class="enabled" type="checkbox" ${course.enabled === false ? "" : "checked"}></label></div>
      <div class="course-grid">
        <label>来源</label><select class="source"><option value="moodle" ${course.source === "moodle" ? "selected" : ""}>Moodle 当前周</option><option value="ed" ${course.source === "ed" ? "selected" : ""}>Ed Discussion</option></select>
        <label>发布页面</label><input class="url" type="url" value="${course.url}">
        <label>板块</label><input class="category" type="text" value="${course.category || ""}" placeholder="例如 Malaysia">
      </div>
      <div>${course.sessions.map((session, sessionIndex) => `<div class="session" data-session="${sessionIndex}"><input class="label" value="${session.label}" aria-label="班次"><input class="day" value="${session.day}" aria-label="星期"><input class="time" type="time" value="${session.time}" aria-label="时间"></div>`).join("")}</div>
    </article>`).join("");
}

async function collect() {
  settings.weekOneMonday = document.querySelector("#weekOneMonday").value;
  settings.reminder.weekday = Number(document.querySelector("#primaryDay").value);
  Object.assign(settings.reminder, parseTime(document.querySelector("#primaryTime").value));
  settings.backup.enabled = document.querySelector("#backupEnabled").checked;
  [...coursesRoot.querySelectorAll("[data-course]")].forEach((card) => {
    const course = settings.courses[Number(card.dataset.course)];
    course.enabled = card.querySelector(".enabled").checked;
    course.source = card.querySelector(".source").value;
    course.url = card.querySelector(".url").value.trim();
    course.category = card.querySelector(".category").value.trim();
    [...card.querySelectorAll("[data-session]")].forEach((row) => {
      const session = course.sessions[Number(row.dataset.session)];
      session.label = row.querySelector(".label").value.trim();
      session.day = row.querySelector(".day").value.trim();
      session.time = row.querySelector(".time").value;
      session.aliases = [session.label, session.label.replace(/^0+|\s0+/g, " ")];
    });
  });
  await chrome.storage.local.set({ settings });
  await chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
  document.querySelector("#status").textContent = "已保存，定时检查已启用。";
}

async function init() {
  settings = await loadSettings();
  document.querySelector("#weekOneMonday").value = settings.weekOneMonday;
  document.querySelector("#primaryDay").value = settings.reminder.weekday;
  document.querySelector("#primaryTime").value = timeValue(settings.reminder);
  document.querySelector("#backupEnabled").checked = settings.backup.enabled;
  renderCourses();
}

document.querySelector("#save").addEventListener("click", collect);
document.querySelector("#scan").addEventListener("click", async () => { await collect(); document.querySelector("#status").textContent = "正在检查，完成后会弹出系统通知。"; await chrome.runtime.sendMessage({ type: "SCAN_ALL" }); });
document.querySelector("#import").addEventListener("click", () => document.querySelector("#importFile").click());
document.querySelector("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported.weekOneMonday || !Array.isArray(imported.courses)) throw new Error("配置格式不正确");
    settings = imported;
    await chrome.storage.local.set({ settings });
    await chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
    location.reload();
  } catch (error) {
    document.querySelector("#status").textContent = `导入失败：${error.message}`;
  }
});
init().catch(() => { settings = structuredClone(DEFAULT_SETTINGS); renderCourses(); });
