"use client";

import { useMemo, useState } from "react";

type Course = { id: string; name: string; source: string; url: string; category?: string; enabled: boolean };
type Reminder = { id: string; weekday: number; time: string; enabled: boolean };

const weekdays = [
  { value: 0, label: "周日" }, { value: 1, label: "周一" },
  { value: 2, label: "周二" }, { value: 3, label: "周三" },
  { value: 4, label: "周四" }, { value: 5, label: "周五" },
  { value: 6, label: "周六" },
];

const initialCourses: Course[] = [
  { id: "fit3162", name: "FIT3162", source: "Moodle 当前周", url: "https://learning.monash.edu/course/view.php?id=44555", enabled: true },
  { id: "fit2102", name: "FIT2102", source: "Ed · Malaysia", url: "https://edstem.org/au/courses/36340/discussion?category=Malaysia", category: "Malaysia", enabled: true },
  { id: "fit2109", name: "FIT2109", source: "Ed Discussion", url: "https://edstem.org/au/courses/39026/discussion", enabled: true },
];

const initialReminders: Reminder[] = [
  { id: "primary", weekday: 0, time: "19:00", enabled: true },
  { id: "backup", weekday: 1, time: "10:00", enabled: true },
];

const attendanceUrl = "https://attendance.monash.edu.my/student/Default.aspx";

const courseSessions: Record<string, object[]> = {
  fit3162: [{ id: "studio01", label: "Studio 01", day: "Thursday", time: "17:00", aliases: ["Studio 01", "Studio 1"] }],
  fit2102: [
    { id: "workshop01", label: "Workshop 01", day: "Tuesday", time: "16:00", aliases: ["Workshop 01", "Workshop 1"] },
    { id: "tutorial09", label: "Tutorial 09", day: "Wednesday", time: "14:00", aliases: ["Tutorial 09", "Tutorial 9"] },
  ],
  fit2109: [
    { id: "workshop02", label: "Workshop 02", day: "Wednesday", time: "16:00", aliases: ["Workshop 02", "Workshop 2"] },
    { id: "tutorial05", label: "Tutorial 05", day: "Friday", time: "14:00", aliases: ["Tutorial 05", "Tutorial 5"] },
  ],
};

export default function Home() {
  const [courses, setCourses] = useState(initialCourses);
  const [reminders, setReminders] = useState(initialReminders);
  const [downloaded, setDownloaded] = useState(false);

  const activeCourses = useMemo(() => courses.filter((course) => course.enabled && course.url.trim()), [courses]);
  const activeReminders = useMemo(() => reminders.filter((reminder) => reminder.enabled), [reminders]);

  const updateCourse = (id: string, patch: Partial<Course>) => {
    setCourses((current) => current.map((course) => course.id === id ? { ...course, ...patch } : course));
    setDownloaded(false);
  };

  const updateReminder = (id: string, patch: Partial<Reminder>) => {
    setReminders((current) => current.map((reminder) => reminder.id === id ? { ...reminder, ...patch } : reminder));
    setDownloaded(false);
  };

  const generateConfig = () => {
    const primary = reminders[0];
    const backup = reminders[1];
    const [primaryHour, primaryMinute] = primary.time.split(":").map(Number);
    const [backupHour, backupMinute] = backup.time.split(":").map(Number);
    const config = {
      timezone: "Asia/Kuala_Lumpur",
      weekOneMonday: "2026-07-27",
      reminder: { weekday: primary.weekday, hour: primaryHour, minute: primaryMinute },
      backup: { enabled: backup.enabled, weekday: backup.weekday, hour: backupHour, minute: backupMinute },
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        source: course.id === "fit3162" ? "moodle" : "ed",
        url: course.url,
        category: course.category || "",
        enabled: course.enabled,
        sessions: courseSessions[course.id],
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
          <span className="eyebrow">CHROME 扩展 · 自动查码 · 本地确认</span>
          <h1>到点查好签到码，<br />只等你确认。</h1>
          <p>扩展会使用 Chrome 里已登录的 Moodle 和 Ed，会按课程与班次寻找本周代码并弹出清单；只有你确认实际参加后才会提交。</p>
        </div>
        <div className="week-card" aria-label="默认提醒安排">
          <div className="week-card-top"><span>AUTOMATION</span><span className="live-dot">安装后启用</span></div>
          <div className="big-time">SUN 19:00</div>
          <div className="week-line"><span>自动动作</span><span>查 Moodle / Ed</span></div>
          <div className="week-line"><span>提交动作</span><span>必须本人确认</span></div>
        </div>
      </section>

      <section className="builder" aria-label="扩展设置器">
        <div className="form-column">
          <div className="section-heading"><span>01</span><div><h2>课程来源</h2><p>开启需要检查的课程；FIT2102 已固定到 Malaysia 板块。</p></div></div>
          <div className="course-list">
            {courses.map((course) => (
              <article className={`course-card ${course.enabled ? "active" : ""}`} key={course.id}>
                <div className="course-card-head">
                  <label className="switch-row"><input type="checkbox" checked={course.enabled} onChange={(event) => updateCourse(course.id, { enabled: event.target.checked })} /><span className="switch" /><strong>{course.name}</strong></label>
                  <span className="source-tag">{course.source}</span>
                </div>
                <label className="field-label" htmlFor={`${course.id}-url`}>发布页面</label>
                <input id={`${course.id}-url`} className="text-input" type="url" value={course.url} disabled={!course.enabled} onChange={(event) => updateCourse(course.id, { url: event.target.value })} />
              </article>
            ))}
          </div>

          <div className="section-heading schedule-heading"><span>02</span><div><h2>提醒时间</h2><p>主提醒自动查码；备用提醒会再次检查缺失项。</p></div></div>
          <div className="reminder-grid">
            {reminders.map((reminder, index) => (
              <article className="reminder-card" key={reminder.id}>
                <div className="reminder-title"><span>{index === 0 ? "主提醒" : "备用提醒"}</span><label className="mini-toggle"><input type="checkbox" checked={reminder.enabled} onChange={(event) => updateReminder(reminder.id, { enabled: event.target.checked })} /><span /></label></div>
                <div className="schedule-controls">
                  <select aria-label="提醒星期" value={reminder.weekday} disabled={!reminder.enabled} onChange={(event) => updateReminder(reminder.id, { weekday: Number(event.target.value) })}>{weekdays.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}</select>
                  <input aria-label="提醒时间" type="time" value={reminder.time} disabled={!reminder.enabled} onChange={(event) => updateReminder(reminder.id, { time: event.target.value })} />
                </div>
              </article>
            ))}
          </div>

          <div className="section-heading schedule-heading"><span>03</span><div><h2>安装方式</h2><p>下载仓库并在 Chrome 的“扩展程序”页面开启开发者模式，选择仓库里的 <code>extension</code> 文件夹；再到扩展设置导入右侧生成的配置。</p></div></div>
        </div>

        <aside className="summary-column">
          <div className="summary-sticky">
            <div className="summary-label">YOUR SETUP</div><h2>自动流程</h2>
            <div className="summary-block"><span className="summary-kicker">课程</span>{activeCourses.map((course) => <div className="summary-row" key={course.id}><span className="check">✓</span><span>{course.name}</span><span>{course.source}</span></div>)}</div>
            <div className="summary-block"><span className="summary-kicker">提醒</span>{activeReminders.map((reminder) => <div className="summary-row" key={reminder.id}><span className="clock-dot" /><span>{weekdays.find((day) => day.value === reminder.weekday)?.label}</span><strong>{reminder.time}</strong></div>)}</div>
            <button className="primary-button" onClick={generateConfig} disabled={!activeCourses.length || !activeReminders.length}>下载扩展配置 <span>↓</span></button>
            <a className="secondary-button" href="https://github.com/Waldo0926/monash-attendance-reminder/archive/refs/heads/main.zip">下载 Chrome 扩展</a>
            <button className="secondary-button" onClick={testPages}>测试课程登录状态 ↗</button>
            {downloaded && <div className="download-note" role="status">配置已生成。安装扩展后打开“设置 → 导入网页配置”。</div>}
            <p className="privacy-note"><span>●</span>登录状态、课程页面内容和签到码留在本机，不会上传到本站。</p>
          </div>
        </aside>
      </section>
      <footer><span>Attendance Helper · 2026</span><span>自动查码；确认后才提交。</span></footer>
    </main>
  );
}
