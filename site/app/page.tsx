"use client";

import { useMemo, useState } from "react";

type Course = { id: string; name: string; source: string; url: string; enabled: boolean };
type Reminder = { id: string; weekday: number; time: string; enabled: boolean };

const weekdays = [
  { value: 1, label: "周日" }, { value: 2, label: "周一" },
  { value: 3, label: "周二" }, { value: 4, label: "周三" },
  { value: 5, label: "周四" }, { value: 6, label: "周五" },
  { value: 7, label: "周六" },
];

const initialCourses: Course[] = [
  { id: "fit3162", name: "FIT3162", source: "Moodle 当前周", url: "https://learning.monash.edu/course/view.php?id=44555", enabled: true },
  { id: "fit2109", name: "FIT2109", source: "Ed Discussion", url: "https://edstem.org/au/courses/39026/discussion", enabled: true },
  { id: "fit2102", name: "FIT2102", source: "Ed · Malaysia", url: "https://edstem.org/au/courses/36340/discussion?category=Malaysia", enabled: true },
];

const initialReminders: Reminder[] = [
  { id: "primary", weekday: 1, time: "19:00", enabled: true },
  { id: "backup", weekday: 2, time: "10:00", enabled: true },
];

const attendanceUrl = "https://attendance.monash.edu.my/student/Default.aspx";

function shellQuote(value: string) {
  return `'${value.replace(/[\r\n]/g, "").replaceAll("'", `'\\''`)}'`;
}

export default function Home() {
  const [courses, setCourses] = useState(initialCourses);
  const [reminders, setReminders] = useState(initialReminders);
  const [browserName, setBrowserName] = useState("Google Chrome");
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

  const generateInstaller = () => {
    const openLines = [...activeCourses.map((course) => course.url), attendanceUrl]
      .map((url) => `/usr/bin/open -a ${shellQuote(browserName)} ${shellQuote(url)}`)
      .join("\n");

    const reminderScript = `#!/bin/zsh
set -eu
/usr/bin/osascript -e 'display notification "请检查本周课程签到码；填写后再关闭页面。" with title "Monash Attendance Reminder" sound name "Glass"'
${openLines}
`;

    const intervals = activeReminders.map((reminder) => {
      const [hour, minute] = reminder.time.split(":").map(Number);
      return `    <dict>
      <key>Weekday</key><integer>${reminder.weekday}</integer>
      <key>Hour</key><integer>${hour}</integer>
      <key>Minute</key><integer>${minute}</integer>
    </dict>`;
    }).join("\n");

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.monash.attendance-reminder</string>
  <key>ProgramArguments</key><array><string>__TARGET_SCRIPT__</string></array>
  <key>StartCalendarInterval</key><array>
${intervals}
  </array>
  <key>RunAtLoad</key><false/>
</dict></plist>`;

    const installer = `#!/bin/zsh
set -eu
TARGET_DIR="$HOME/Library/Application Support/MonashAttendanceReminder"
TARGET_SCRIPT="$TARGET_DIR/attendance-reminder.sh"
TARGET_PLIST="$HOME/Library/LaunchAgents/com.monash.attendance-reminder.plist"
USER_ID="$(/usr/bin/id -u)"
/bin/mkdir -p "$TARGET_DIR" "$HOME/Library/LaunchAgents"
/bin/cat > "$TARGET_SCRIPT" <<'REMINDER_SCRIPT'
${reminderScript}REMINDER_SCRIPT
/bin/chmod 755 "$TARGET_SCRIPT"
/bin/cat > "$TARGET_PLIST" <<'REMINDER_PLIST'
${plist}
REMINDER_PLIST
/usr/bin/sed -i '' "s|__TARGET_SCRIPT__|$TARGET_SCRIPT|g" "$TARGET_PLIST"
/bin/launchctl bootout "gui/$USER_ID" "$TARGET_PLIST" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$USER_ID" "$TARGET_PLIST"
echo "Attendance Reminder 已安装。"
"$TARGET_SCRIPT"
read -r "?按 Return 关闭窗口。"
`;

    const blobUrl = URL.createObjectURL(new Blob([installer], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = "install-attendance-reminder.command";
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
        <a className="brand" href="#top" aria-label="Attendance Helper 首页">
          <span className="brand-mark" aria-hidden="true">A</span><span>Attendance Helper</span>
        </a>
        <a className="github-link" href="https://github.com/Waldo0926/monash-attendance-reminder" target="_blank" rel="noreferrer">GitHub ↗</a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">MACOS · 本地运行 · 不保存密码</span>
          <h1>把签到提醒，调成<br />适合你的节奏。</h1>
          <p>选择课程页面和提醒时间，下载专属安装文件。到点自动打开签到码来源与 Monash Attendance，最后一步由你本人确认。</p>
        </div>
        <div className="week-card" aria-label="当前默认提醒安排">
          <div className="week-card-top"><span>DEFAULT RHYTHM</span><span className="live-dot">已启用</span></div>
          <div className="big-time">SUN 19:00</div>
          <div className="week-line"><span>主提醒</span><span>周日集中检查</span></div>
          <div className="week-line"><span>备用提醒</span><span>周一 10:00</span></div>
        </div>
      </section>

      <section className="builder" aria-label="提醒设置器">
        <div className="form-column">
          <div className="section-heading"><span>01</span><div><h2>课程来源</h2><p>开启需要每周检查的课程，并修改发布页面。</p></div></div>
          <div className="course-list">
            {courses.map((course) => (
              <article className={`course-card ${course.enabled ? "active" : ""}`} key={course.id}>
                <div className="course-card-head">
                  <label className="switch-row">
                    <input type="checkbox" checked={course.enabled} onChange={(event) => updateCourse(course.id, { enabled: event.target.checked })} />
                    <span className="switch" aria-hidden="true" /><strong>{course.name}</strong>
                  </label>
                  <span className="source-tag">{course.source}</span>
                </div>
                <label className="field-label" htmlFor={`${course.id}-url`}>发布页面</label>
                <input id={`${course.id}-url`} className="text-input" type="url" value={course.url} disabled={!course.enabled} onChange={(event) => updateCourse(course.id, { url: event.target.value })} />
              </article>
            ))}
          </div>

          <div className="section-heading schedule-heading"><span>02</span><div><h2>提醒节奏</h2><p>建议保留一次主提醒和一次备用提醒。</p></div></div>
          <div className="reminder-grid">
            {reminders.map((reminder, index) => (
              <article className="reminder-card" key={reminder.id}>
                <div className="reminder-title">
                  <span>{index === 0 ? "主提醒" : "备用提醒"}</span>
                  <label className="mini-toggle"><input type="checkbox" checked={reminder.enabled} onChange={(event) => updateReminder(reminder.id, { enabled: event.target.checked })} /><span aria-hidden="true" /></label>
                </div>
                <div className="schedule-controls">
                  <select aria-label={`${index === 0 ? "主" : "备用"}提醒星期`} value={reminder.weekday} disabled={!reminder.enabled} onChange={(event) => updateReminder(reminder.id, { weekday: Number(event.target.value) })}>
                    {weekdays.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}
                  </select>
                  <input aria-label={`${index === 0 ? "主" : "备用"}提醒时间`} type="time" value={reminder.time} disabled={!reminder.enabled} onChange={(event) => updateReminder(reminder.id, { time: event.target.value })} />
                </div>
              </article>
            ))}
          </div>
          <label className="field-label browser-label" htmlFor="browser">打开方式</label>
          <select id="browser" className="browser-select" value={browserName} onChange={(event) => setBrowserName(event.target.value)}>
            <option>Google Chrome</option><option>Safari</option><option>Microsoft Edge</option>
          </select>
        </div>

        <aside className="summary-column">
          <div className="summary-sticky">
            <div className="summary-label">YOUR SETUP</div><h2>本周提醒清单</h2>
            <div className="summary-block"><span className="summary-kicker">课程</span>
              {activeCourses.length ? activeCourses.map((course) => (
                <div className="summary-row" key={course.id}><span className="check">✓</span><span>{course.name}</span><span>{course.source}</span></div>
              )) : <p className="empty-state">尚未选择课程</p>}
            </div>
            <div className="summary-block"><span className="summary-kicker">提醒</span>
              {activeReminders.map((reminder) => (
                <div className="summary-row" key={reminder.id}><span className="clock-dot" /><span>{weekdays.find((day) => day.value === reminder.weekday)?.label}</span><strong>{reminder.time}</strong></div>
              ))}
            </div>
            <button className="primary-button" onClick={generateInstaller} disabled={!activeCourses.length || !activeReminders.length}>下载 Mac 安装文件 <span>↓</span></button>
            <button className="secondary-button" onClick={testPages}>测试打开页面 ↗</button>
            {downloaded && <div className="download-note" role="status">已生成。若 macOS 阻止打开，请在“隐私与安全性”中允许。</div>}
            <p className="privacy-note"><span aria-hidden="true">●</span>设置仅在本页生成文件，不会上传登录状态、课程链接或签到码。</p>
          </div>
        </aside>
      </section>
      <footer><span>Attendance Helper · 2026</span><span>提醒你签到，不替你签到。</span></footer>
    </main>
  );
}

