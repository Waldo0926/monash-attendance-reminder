"use client";

import { useMemo, useState } from "react";

type Session = { id: string; label: string; day: string; time: string; aliases: string[] };
type Course = {
  id: string;
  name: string;
  source: "moodle" | "ed";
  url: string;
  category: string;
  enabled: boolean;
  sessions: Session[];
};
type Reminder = { id: string; weekday: number; time: string; enabled: boolean };

const weekdays = [
  { value: 0, label: "周日" }, { value: 1, label: "周一" },
  { value: 2, label: "周二" }, { value: 3, label: "周三" },
  { value: 4, label: "周四" }, { value: 5, label: "周五" },
  { value: 6, label: "周六" },
];
const classDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const attendanceUrl = "https://attendance.monash.edu.my/student/Default.aspx";

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function newSession(): Session {
  return { id: makeId("session"), label: "", day: "Monday", time: "09:00", aliases: [] };
}

function newCourse(): Course {
  return {
    id: makeId("course"),
    name: "",
    source: "moodle",
    url: "",
    category: "",
    enabled: true,
    sessions: [newSession()],
  };
}

function sessionAliases(label: string) {
  const compact = label.replace(/\b0+(\d+)/g, "$1");
  return [...new Set([label, compact].filter(Boolean))];
}

function isValidSession(session: Session) {
  return Boolean(session.label.trim() && classDays.includes(session.day) && /^\d{2}:\d{2}$/.test(session.time));
}

function isValidReminder(reminder: Reminder) {
  return Number.isInteger(reminder.weekday) && reminder.weekday >= 0 && reminder.weekday <= 6
    && /^\d{2}:\d{2}$/.test(reminder.time);
}

function isValidCourseUrl(course: Course) {
  try {
    const url = new URL(course.url);
    if (url.protocol !== "https:") return false;
    if (course.source === "moodle") return url.hostname === "learning.monash.edu";
    return url.hostname === "edstem.org" || url.hostname.endsWith(".edstem.org");
  } catch {
    return false;
  }
}

export default function Home() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [weekOneMonday, setWeekOneMonday] = useState("");
  const [reminders, setReminders] = useState<Reminder[]>([
    { id: "primary", weekday: 0, time: "19:00", enabled: true },
    { id: "backup", weekday: 1, time: "10:00", enabled: true },
  ]);
  const [downloaded, setDownloaded] = useState(false);

  const activeCourses = useMemo(
    () => courses.filter((course) => course.enabled && course.name.trim() && isValidCourseUrl(course) && course.sessions.some(isValidSession)),
    [courses],
  );
  const activeReminders = useMemo(() => reminders.filter((reminder) => reminder.enabled), [reminders]);
  const remindersValid = activeReminders.length > 0 && activeReminders.every(isValidReminder);
  const hasInvalidCourseUrl = courses.some((course) => course.enabled && course.url.trim() && !isValidCourseUrl(course));
  const configurationReady = Boolean(weekOneMonday && activeCourses.length && remindersValid);

  const updateCourse = (id: string, patch: Partial<Course>) => {
    setCourses((current) => current.map((course) => course.id === id ? { ...course, ...patch } : course));
    setDownloaded(false);
  };

  const updateSession = (courseId: string, sessionId: string, patch: Partial<Session>) => {
    setCourses((current) => current.map((course) => course.id === courseId ? {
      ...course,
      sessions: course.sessions.map((session) => session.id === sessionId ? { ...session, ...patch } : session),
    } : course));
    setDownloaded(false);
  };

  const removeSession = (courseId: string, sessionId: string) => {
    setCourses((current) => current.map((course) => course.id === courseId ? {
      ...course,
      sessions: course.sessions.filter((session) => session.id !== sessionId),
    } : course));
    setDownloaded(false);
  };

  const updateReminder = (id: string, patch: Partial<Reminder>) => {
    setReminders((current) => current.map((reminder) => reminder.id === id ? { ...reminder, ...patch } : reminder));
    setDownloaded(false);
  };

  const generateConfig = () => {
    if (!configurationReady) return;
    const primary = reminders[0];
    const backup = reminders[1];
    const [primaryHour, primaryMinute] = primary.time.split(":").map(Number);
    const [backupHour, backupMinute] = backup.time.split(":").map(Number);
    const config = {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      weekOneMonday,
      reminder: { weekday: primary.weekday, hour: primaryHour, minute: primaryMinute },
      backup: { enabled: backup.enabled, weekday: backup.weekday, hour: backupHour, minute: backupMinute },
      courses: activeCourses.map((course) => ({
        ...course,
        name: course.name.trim(),
        url: course.url.trim(),
        category: course.category.trim(),
        sessions: course.sessions.filter(isValidSession).map((session) => ({
          ...session,
          label: session.label.trim(),
          aliases: sessionAliases(session.label.trim()),
        })),
      })),
    };
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = "attendance-helper-config.json";
    anchor.click();
    URL.revokeObjectURL(blobUrl);
    setDownloaded(true);
  };

  const testPages = () => {
    [...activeCourses.map((course) => course.url), attendanceUrl]
      .forEach((url) => window.open(url, "_blank", "noopener,noreferrer"));
  };

  return (
    <main className="page-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Attendance Helper 首页"><span className="brand-mark">A</span><span>Attendance Helper</span></a>
        <a className="github-link" href="https://github.com/Waldo0926/monash-attendance-reminder" target="_blank" rel="noreferrer">GitHub ↗</a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">CHROME 扩展 · 自定义课程 · 本地确认</span>
          <h1>按你自己的课表，<br />自动检查签到码。</h1>
          <p>每个人的课程和班次都不同。这里不会预设任何人的课表：添加你自己的 Moodle / Ed 页面、实际参加的班次和提醒时间，再导入 Chrome 扩展。</p>
        </div>
        <div className="week-card" aria-label="自动化说明">
          <div className="week-card-top"><span>YOUR TIMETABLE</span><span className="live-dot">本地配置</span></div>
          <div className="big-time">YOU DECIDE</div>
          <div className="week-line"><span>课程来源</span><span>Moodle / Ed</span></div>
          <div className="week-line"><span>提交动作</span><span>必须本人确认</span></div>
        </div>
      </section>

      <section className="builder" aria-label="扩展设置器">
        <div className="form-column">
          <div className="section-heading"><span>01</span><div><h2>学期设置</h2><p>Week 1 日期用于计算当前教学周；提醒按你的电脑或浏览器当前时区运行。</p></div></div>
          <div className="setup-grid">
            <label><span>Week 1 的星期一</span><input className="text-input" type="date" value={weekOneMonday} onChange={(event) => { setWeekOneMonday(event.target.value); setDownloaded(false); }} /></label>
            <label><span>设备时区</span><input className="text-input" value="自动使用当前设备时区" disabled readOnly /></label>
          </div>

          <div className="section-heading schedule-heading"><span>02</span><div><h2>课程来源</h2><p>添加你自己的课程。课程代码、Moodle / Ed 页面、板块和班次都可以独立设置。</p></div></div>
          <div className="course-list">
            {!courses.length && <div className="empty-course"><strong>还没有课程</strong><span>点击下方“添加课程”，从空白配置开始。</span></div>}
            {courses.map((course) => (
              <article className={`course-card ${course.enabled ? "active" : ""}`} key={course.id}>
                <div className="course-card-head">
                  <label className="switch-row"><input type="checkbox" checked={course.enabled} onChange={(event) => updateCourse(course.id, { enabled: event.target.checked })} /><span className="switch" /><strong>{course.name || "新课程"}</strong></label>
                  <button className="remove-button" type="button" onClick={() => { setCourses((current) => current.filter((item) => item.id !== course.id)); setDownloaded(false); }}>删除课程</button>
                </div>

                <div className="course-fields">
                  <label><span className="field-label">课程代码 / 名称</span><input className="text-input" value={course.name} disabled={!course.enabled} onChange={(event) => updateCourse(course.id, { name: event.target.value })} placeholder="例如 FIT2004" /></label>
                  <label><span className="field-label">来源</span><select className="browser-select" value={course.source} disabled={!course.enabled} onChange={(event) => updateCourse(course.id, { source: event.target.value as Course["source"] })}><option value="moodle">Moodle</option><option value="ed">Ed Discussion</option></select></label>
                </div>
                <label className="field-label" htmlFor={`${course.id}-url`}>发布页面</label>
                <input id={`${course.id}-url`} className="text-input" type="url" value={course.url} disabled={!course.enabled} onChange={(event) => updateCourse(course.id, { url: event.target.value })} placeholder="粘贴课程 Moodle / Ed 页面链接" />
                <label className="field-label" htmlFor={`${course.id}-category`}>Ed 板块（可选）</label>
                <input id={`${course.id}-category`} className="text-input" value={course.category} disabled={!course.enabled || course.source !== "ed"} onChange={(event) => updateCourse(course.id, { category: event.target.value })} placeholder="例如 Malaysia；Moodle 可留空" />

                <div className="session-header"><strong>班次</strong><button className="small-button" type="button" onClick={() => updateCourse(course.id, { sessions: [...course.sessions, newSession()] })}>＋ 添加班次</button></div>
                <div className="session-list">
                  {course.sessions.map((session) => (
                    <div className="session-row" key={session.id}>
                      <input className="text-input" value={session.label} disabled={!course.enabled} onChange={(event) => updateSession(course.id, session.id, { label: event.target.value })} placeholder="Tutorial 03 / Workshop 01" />
                      <select className="browser-select" value={session.day} disabled={!course.enabled} onChange={(event) => updateSession(course.id, session.id, { day: event.target.value })}>{classDays.map((day) => <option value={day} key={day}>{day}</option>)}</select>
                      <input className="text-input" type="time" value={session.time} disabled={!course.enabled} onChange={(event) => updateSession(course.id, session.id, { time: event.target.value })} />
                      <button className="remove-button compact" type="button" onClick={() => removeSession(course.id, session.id)}>删除</button>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <button className="add-course-button" type="button" onClick={() => { setCourses((current) => [...current, newCourse()]); setDownloaded(false); }}>＋ 添加课程</button>

          <div className="section-heading schedule-heading"><span>03</span><div><h2>提醒时间</h2><p>主提醒自动查码；备用提醒可以再次检查缺失项。</p></div></div>
          <div className="reminder-grid">
            {reminders.map((reminder, index) => (
              <article className="reminder-card" key={reminder.id}>
                <div className="reminder-title"><span>{index === 0 ? "主提醒" : "备用提醒"}</span><label className="mini-toggle"><input type="checkbox" checked={reminder.enabled} disabled={index === 0} onChange={(event) => updateReminder(reminder.id, { enabled: event.target.checked })} /><span /></label></div>
                <div className="schedule-controls">
                  <select aria-label="提醒星期" value={reminder.weekday} disabled={!reminder.enabled} onChange={(event) => updateReminder(reminder.id, { weekday: Number(event.target.value) })}>{weekdays.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}</select>
                  <input aria-label="提醒时间" type="time" value={reminder.time} disabled={!reminder.enabled} onChange={(event) => updateReminder(reminder.id, { time: event.target.value })} />
                </div>
              </article>
            ))}
          </div>

          <div className="section-heading schedule-heading"><span>04</span><div><h2>安装方式</h2><p>下载仓库，在 Chrome 扩展程序页面开启开发者模式并选择 <code>extension</code> 文件夹；然后在扩展设置中导入这里生成的 JSON。</p></div></div>
        </div>

        <aside className="summary-column">
          <div className="summary-sticky">
            <div className="summary-label">YOUR SETUP</div><h2>自动流程</h2>
            <div className="summary-block"><span className="summary-kicker">课程</span>{activeCourses.length ? activeCourses.map((course) => <div className="summary-row" key={course.id}><span className="check">✓</span><span>{course.name}</span><span>{course.source === "moodle" ? "Moodle" : "Ed"}</span></div>) : <div className="empty-state">尚未添加完整课程。</div>}</div>
            <div className="summary-block"><span className="summary-kicker">提醒</span>{activeReminders.map((reminder) => <div className="summary-row" key={reminder.id}><span className="clock-dot" /><span>{weekdays.find((day) => day.value === reminder.weekday)?.label}</span><strong>{reminder.time || "未设置"}</strong></div>)}</div>
            <button className="primary-button" onClick={generateConfig} disabled={!configurationReady}>下载扩展配置 <span>↓</span></button>
            <a className="secondary-button" href="https://github.com/Waldo0926/monash-attendance-reminder/archive/refs/heads/main.zip">下载 Chrome 扩展</a>
            <button className="secondary-button" onClick={testPages} disabled={!activeCourses.length}>测试课程登录状态 ↗</button>
            {downloaded && <div className="download-note" role="status">配置已生成。安装扩展后打开“设置 → 导入网页配置”。</div>}
            {!weekOneMonday && <div className="download-note">生成配置前，请先填写 Week 1 的星期一。</div>}
            {!remindersValid && <div className="download-note">请填写完整的提醒时间。</div>}
            {hasInvalidCourseUrl && <div className="download-note">Moodle 链接必须来自 learning.monash.edu；Ed 链接必须来自 edstem.org。</div>}
            <p className="privacy-note"><span>●</span>登录状态、课程页面内容和签到码留在本机，不会上传到本站。</p>
          </div>
        </aside>
      </section>
      <footer><span>Attendance Helper · 2026</span><span>你的课表由你配置；确认后才提交。</span></footer>
    </main>
  );
}
