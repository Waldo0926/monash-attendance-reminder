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

const MONTH_NAMES_RE = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

// Moodle unit pages print the Week 1 date range in their own header
// ("Week 1 ... Mon 27 July 26 - Sun 2 Aug 26"), which is enough to work out the
// current teaching week without asking the student to type it in.
export function detectWeekOneMonday(text) {
  const re = new RegExp(`\\bweek\\s*1\\b[\\s\\S]{0,400}?\\b(\\d{1,2})\\s+(${MONTH_NAMES_RE})[a-z]*\\.?,?\\s+(\\d{4}|\\d{2})\\b`, "i");
  const match = re.exec(String(text || ""));
  if (!match) return "";
  const month = MONTH_ABBR.findIndex((name) => name.toLowerCase() === match[2].toLowerCase());
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(year, month, Number(match[1]), 12);
  if (Number.isNaN(date.getTime())) return "";
  return dateInfo(mondayOf(date)).iso;
}

function stripHash(href) {
  return String(href || "").split("#")[0];
}

export function findCourseLinks(links, courseCodes, { hrefPattern, normaliseHref = (href) => href }) {
  const codes = (courseCodes || []).map((code) => String(code).toLowerCase());
  const seen = new Map();
  for (const link of links || []) {
    const raw = stripHash(link.href);
    if (!hrefPattern.test(raw)) continue;
    const haystack = `${link.label} ${raw}`.toLowerCase();
    const courses = codes.filter((code) => haystack.includes(code));
    if (!courses.length) continue;
    const href = normaliseHref(raw);
    if (!seen.has(href)) seen.set(href, courses);
  }
  return [...seen.entries()].map(([href, courses]) => ({ href, courses }));
}

// Ed only shows thread titles in the discussion list; the code table lives inside
// the thread body, so pick the threads worth opening by title.
export function edThreadLinks(links) {
  const seen = new Map();
  for (const link of links || []) {
    const href = stripHash(link.href);
    if (!/\/discussion\/\d+/.test(href)) continue;
    const label = String(link.label || "");
    const priority = /attendance/i.test(label) ? 0 : /\bcodes?\b/i.test(label) ? 1 : /\bweek\s*\d+/i.test(label) ? 2 : -1;
    if (priority < 0) continue;
    if (!seen.has(href) || seen.get(href) > priority) seen.set(href, priority);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([href]) => href).slice(0, 5);
}

// Moodle unit pages link each teaching week to its own section page; codes are
// posted inside the week's section, not on the unit home page.
export function moodleWeekLinks(links) {
  const byWeek = new Map();
  for (const link of links || []) {
    const match = /\bweek\s*(\d{1,2})\b/i.exec(link.label || "");
    if (!match) continue;
    const href = stripHash(link.href);
    if (!/section/i.test(href)) continue;
    const week = Number(match[1]);
    if (!byWeek.has(week)) byWeek.set(week, href);
  }
  return byWeek;
}

export function pickWeekNumbers(available, targetWeeks) {
  const weeks = [...available].sort((a, b) => b - a);
  const targets = (targetWeeks || []).filter(Number.isFinite);
  if (targets.length) {
    const wanted = weeks.filter((week) => targets.some((target) => Math.abs(week - target) <= 1));
    if (wanted.length) return wanted;
  }
  return weeks.slice(0, 14);
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

const SESSION_TYPE_RE = /\b(workshop|tutorial|studio|applied class|practical|laboratory|lab|seminar)\b/i;
const TIME_TOKEN_RE = /\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\b/gi;
const ANY_DATE_RE = new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH_NAMES_RE})[a-z]*\\b|\\b(?:${MONTH_NAMES_RE})[a-z]*\\s+\\d{1,2}\\b`, "i");

export function normaliseTimeToken(value) {
  TIME_TOKEN_RE.lastIndex = 0;
  const match = TIME_TOKEN_RE.exec(String(value || ""));
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "p") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function lineHasMatchingTime(line, targetTime) {
  if (!targetTime) return false;
  const tokens = String(line || "").match(TIME_TOKEN_RE) || [];
  return tokens.some((token) => normaliseTimeToken(token) === targetTime);
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

  const candidates = attendanceItems.map((item) => {
    const course = normalise(item.course);
    const sessionAliases = [item.session, ...(item.aliases || [])].map(normalise).filter(Boolean);
    const dateTokens = [item.attendanceDate?.iso, item.attendanceDate?.key?.replaceAll("_", " ")].map(normalise).filter(Boolean);
    // Real Monash attendance-code postings list one session per line as
    // "<Type> <Date> <Number> <Time> <Code>", with the date sitting between the type
    // word and the session number. That means "Workshop 02" never appears as one
    // contiguous phrase, so a substring check against the session label alone misses
    // every real posting. The type word plus the exact time Attendance itself reported
    // for this session is a far more reliable, position-independent signal.
    const sessionType = SESSION_TYPE_RE.exec(item.session || "")?.[1]?.toLowerCase();
    const itemTime = normaliseTimeToken(item.time);
    const typeRe = sessionType ? new RegExp(`\\b${sessionType}\\b`, "i") : null;
    // "9_Sep_26" -> matches "9 Sep" / "9 September" / "Sep 9" on the same line. A line that
    // carries some other date is an old or future week's posting for the same slot and must
    // lose to the right week, even though its type and time look identical.
    const dateParts = String(item.attendanceDate?.key || "").split("_");
    const lineDateRe = dateParts.length === 3
      ? new RegExp(`\\b${Number(dateParts[0])}\\s+${dateParts[1]}[a-z]*\\b|\\b${dateParts[1]}[a-z]*\\s+${Number(dateParts[0])}\\b`, "i")
      : null;
    // "Workshop 02" -> the standalone number 02/2, but never the hour of a time or the day of a date.
    const sessionNumber = /\b(\d{1,2})\b/.exec(item.session || "")?.[1];
    const numberRe = sessionNumber
      ? new RegExp(`\\b0*${Number(sessionNumber)}\\b(?![:\\d])(?!\\s*(?:${MONTH_NAMES_RE}))`, "i")
      : null;
    const ranked = hits.map((hit) => {
      const context = normalise(hit.context);
      const line = normalise(hit.line);
      let score = 0;
      if (course && context.includes(course)) score += 14;
      if (course && line.includes(course)) score += 12;
      if (sessionAliases.some((alias) => context.includes(alias))) score += 14;
      if (sessionAliases.some((alias) => line.includes(alias))) score += 14;
      if (dateTokens.some((token) => context.includes(token))) score += 4;
      if (typeRe?.test(line) && lineHasMatchingTime(line, itemTime)) score += 26;
      if (lineDateRe) {
        if (lineDateRe.test(line)) score += 10;
        else if (ANY_DATE_RE.test(line)) score -= 10;
      }
      if (numberRe?.test(line)) score += 6;
      return { ...hit, score };
    });
    return ranked.filter((hit) => hit.score >= 24);
  });

  // A real signed code belongs to exactly one class, so hand each code to the single
  // item that wants it most. If two items want the same code equally, neither gets it:
  // that pattern means the match came from shared surrounding text, not a real code.
  const claims = candidates
    .flatMap((hits, index) => hits.map((hit) => ({ index, ...hit })))
    .sort((a, b) => b.score - a.score);
  const assigned = new Map();
  const usedCodes = new Set();
  for (const claim of claims) {
    if (assigned.has(claim.index) || usedCodes.has(claim.code)) continue;
    const rival = claims.some((other) => other.code === claim.code && other.score === claim.score && other.index !== claim.index && !assigned.has(other.index));
    usedCodes.add(claim.code);
    if (!rival) assigned.set(claim.index, claim);
  }

  return attendanceItems.map((item, index) => {
    const best = assigned.get(index);
    return {
      ...item,
      code: best ? best.code : "",
      confidence: best ? (best.score >= 36 ? "high" : "review") : "missing",
      context: best ? best.context.slice(0, 520) : ""
    };
  });
}

export function validSchedule(item) {
  return Number.isInteger(item?.weekday) && item.weekday >= 0 && item.weekday <= 6
    && Number.isInteger(item?.hour) && item.hour >= 0 && item.hour <= 23
    && Number.isInteger(item?.minute) && item.minute >= 0 && item.minute <= 59;
}

export function hasUsableConfig(settings) {
  const backupValid = !settings?.backup?.enabled || validSchedule(settings.backup);
  const autoDiscover = settings?.autoDiscover !== false;
  return Boolean(
    validSchedule(settings?.reminder)
    && backupValid
    && (autoDiscover
      || (settings?.weekOneMonday && settings?.courses?.some((course) => course.enabled !== false && course.name && course.url && course.sessions?.length)))
  );
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings || structuredClone(DEFAULT_SETTINGS);
}
