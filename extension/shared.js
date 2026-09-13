export const ATTENDANCE_URL = "https://attendance.monash.edu.my/student/Default.aspx";

export const DEFAULT_SETTINGS = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kuala_Lumpur",
  weekOneMonday: "",
  autoDiscover: true,
  lookbackDays: 7,
  reminder: { weekday: 0, hour: 19, minute: 0 },
  backup: { enabled: true, weekday: 1, hour: 10, minute: 0 },
  courses: []
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dateInfo(date) {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  return {
    iso: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`,
    key: `${value.getDate()}_${MONTH_ABBR[value.getMonth()]}_${String(value.getFullYear()).slice(-2)}`
  };
}

export function parseDateKey(key) {
  const match = /^(\d{1,2})_([A-Za-z]{3})_(\d{2})$/.exec(String(key || ""));
  if (!match) return null;
  const [, day, mon, yy] = match;
  const month = MONTH_ABBR.findIndex((name) => name.toLowerCase() === mon.toLowerCase());
  if (month === -1) return null;
  return dateInfo(new Date(2000 + Number(yy), month, Number(day), 12));
}

export function recentAttendanceDates(now = new Date(), count = 7) {
  const dates = [];
  for (let offset = Math.max(1, count) - 1; offset >= 0; offset -= 1) {
    dates.push(dateInfo(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12)));
  }
  return dates;
}

export function mondayOf(date = new Date()) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - offset);
  return local;
}

export function teachingWeek(settings, now = new Date()) {
  if (!settings?.weekOneMonday) return null;
  const anchor = new Date(`${settings.weekOneMonday}T00:00:00`);
  if (Number.isNaN(anchor.getTime())) return null;
  const diff = mondayOf(now).getTime() - anchor.getTime();
  return Math.floor(diff / 604800000) + 1;
}

export function attendanceDate(settings, week, day) {
  const dayOffsets = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };
  if (!settings?.weekOneMonday || !Number.isFinite(week) || !(day in dayOffsets)) return null;
  const date = new Date(`${settings.weekOneMonday}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + ((week - 1) * 7) + dayOffsets[day]);
  return dateInfo(date);
}

export function normalise(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function extractCandidates(text, course, week) {
  const clean = text.replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ");
  const lines = clean.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const codeRe = /\b(?=[A-Z0-9]{5}\b)(?=.*[A-Z])(?=.*\d)[A-Z0-9]{5}\b/g;
  const hits = [];

  lines.forEach((line, lineIndex) => {
    for (const match of line.matchAll(codeRe)) {
      const from = Math.max(0, lineIndex - 4);
      const to = Math.min(lines.length, lineIndex + 5);
      const context = lines.slice(from, to).join(" · ");
      if (/^(FIT|ECE|ENG|MMA|TRC)\d$/i.test(match[0])) continue;
      hits.push({ code: match[0].toUpperCase(), context, line: line.trim(), lineIndex });
    }
  });

  const weekTokens = [`week ${week}`, `wk ${week}`, `第 ${week} 周`, `第${week}周`];
  return (course.sessions || []).map((session) => {
    const aliases = [session.label, ...(session.aliases || [])].map(normalise).filter(Boolean);
    const ranked = hits.map((hit) => {
      const haystack = normalise(hit.context);
      const sameLine = normalise(hit.line);
      let score = 0;
      if (weekTokens.some((token) => haystack.includes(normalise(token)))) score += 8;
      if (aliases.some((alias) => haystack.includes(alias))) score += 12;
      if (aliases.some((alias) => sameLine.includes(alias))) score += 20;
      if (haystack.includes(normalise(session.day))) score += 3;
      if (sameLine.includes(normalise(session.day))) score += 4;
      if (haystack.includes(session.time)) score += 3;
      if (sameLine.includes(session.time)) score += 4;
      if (haystack.includes(normalise(course.name))) score += 2;
      if (course.category && haystack.includes(normalise(course.category))) score += 2;
      return { ...hit, score };
    }).sort((a, b) => b.score - a.score);

    const best = ranked[0];
    return {
      id: `${course.id}:${session.id}:w${week}`,
      courseId: course.id,
      course: course.name,
      sessionId: session.id,
      session: session.label,
      day: session.day,
      time: session.time,
      week,
      code: best?.score >= 12 ? best.code : "",
      confidence: best?.score >= 20 ? "high" : best?.score >= 12 ? "review" : "missing",
      context: best?.score >= 12 ? best.context.slice(0, 420) : "",
      sourceUrl: course.url
    };
  });
}

export function matchCodesToAttendance(text, attendanceItems) {
  const clean = String(text || "").replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ");
  const lines = clean.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const codeRe = /\b(?=[A-Z0-9]{5}\b)(?=.*[A-Z])(?=.*\d)[A-Z0-9]{5}\b/g;
  const hits = [];
  lines.forEach((line, lineIndex) => {
    for (const match of line.matchAll(codeRe)) {
      if (/^(FIT|ECE|ENG|MMA|TRC)\d$/i.test(match[0])) continue;
      hits.push({
        code: match[0].toUpperCase(),
        line,
        context: lines.slice(Math.max(0, lineIndex - 7), Math.min(lines.length, lineIndex + 8)).join(" · ")
      });
    }
  });

  return attendanceItems.map((item) => {
    const course = normalise(item.course);
    const sessionAliases = [item.session, ...(item.aliases || [])].map(normalise).filter(Boolean);
    const dateTokens = [item.attendanceDate?.iso, item.attendanceDate?.key?.replaceAll("_", " ")].map(normalise).filter(Boolean);
    const ranked = hits.map((hit) => {
      const context = normalise(hit.context);
      const line = normalise(hit.line);
      let score = 0;
      if (course && context.includes(course)) score += 14;
      if (course && line.includes(course)) score += 12;
      if (sessionAliases.some((alias) => context.includes(alias))) score += 14;
      if (sessionAliases.some((alias) => line.includes(alias))) score += 14;
      if (dateTokens.some((token) => context.includes(token))) score += 4;
      return { ...hit, score };
    }).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    return {
      ...item,
      code: best?.score >= 24 ? best.code : "",
      confidence: best?.score >= 36 ? "high" : best?.score >= 24 ? "review" : "missing",
      context: best?.score >= 24 ? best.context.slice(0, 520) : ""
    };
  });
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings || structuredClone(DEFAULT_SETTINGS);
}
