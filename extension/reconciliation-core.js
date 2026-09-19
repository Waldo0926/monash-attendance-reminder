const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SESSION_TYPE_RE = /\b(workshop|tutorial|studio|applied(?:\s+class)?|practical|laboratory|lab|seminar)\b/i;
const TIME_RE = /\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\b/i;
const DATE_RE = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const CODE_RE = /\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5}\b/g;

export function canonicalSessionType(value) {
  const match = SESSION_TYPE_RE.exec(String(value || ""));
  if (!match) return "";
  const type = match[1].toLowerCase().replace(/\s+/g, " ");
  if (type === "lab" || type === "laboratory") return "laboratory";
  if (type.startsWith("applied")) return "applied";
  return type;
}

export function normaliseClock(value) {
  const match = TIME_RE.exec(String(value || ""));
  if (!match) return "";
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "p") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function sessionNumber(value) {
  const type = SESSION_TYPE_RE.exec(String(value || ""));
  if (!type) return null;
  const tail = String(value || "").slice((type.index || 0) + type[0].length);
  const match = /\b0*(\d{1,2})\b/.exec(tail);
  return match ? Number(match[1]) : null;
}

export function codeConfidenceOf(item) {
  if (item?.codeConfidence === "high" || item?.codeConfidence === "review") return item.codeConfidence;
  if (item?.code && (item?.confidence === "high" || item?.confidence === "review")) return item.confidence;
  return "missing";
}

export function needsCodeEvidence(item) {
  return !item?.code || codeConfidenceOf(item) !== "high";
}

export function isCompletionClue(value) {
  const clue = String(value || "").toLowerCase();
  if (/question|help|unknown|pending|incomplete/.test(clue)) return false;
  return /[✓✔☑]|\b(?:glyphicon|icon)[-_ ]+ok\b|\b(?:fa|fas|far|fal|fab|bi)[-_ ]+check(?:[-_ ]|\b)|\bcheck(?:ed|mark)?\b|\btick\b|\bcomplete(?:d)?\b|\bpresent\b|\bsuccess\b/.test(clue);
}

function codeFromCells(cells, raw, timeIndex) {
  const candidates = [];
  const start = Number.isInteger(timeIndex) && timeIndex >= 0 ? timeIndex + 1 : 0;
  for (let index = start; index < cells.length; index += 1) {
    for (const match of String(cells[index] || "").toUpperCase().matchAll(CODE_RE)) candidates.push(match[0]);
  }
  if (!candidates.length) {
    for (const match of String(raw || "").toUpperCase().matchAll(CODE_RE)) candidates.push(match[0]);
  }
  return candidates.find((code) => !/^(?:FIT|ECE|ENG|MMA|TRC)\d$/i.test(code)) || "";
}

function dateParts(value) {
  const match = DATE_RE.exec(String(value || ""));
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[2].slice(0, 3).toLowerCase());
  return month < 0 ? null : { day: Number(match[1]), month };
}

function itemDateParts(item) {
  const key = String(item?.attendanceDate?.key || "");
  const [day, month] = key.split("_");
  const monthIndex = MONTHS.findIndex((name) => name.toLowerCase() === String(month || "").slice(0, 3).toLowerCase());
  if (Number(day) && monthIndex >= 0) return { day: Number(day), month: monthIndex };
  return dateParts(item?.attendanceDate?.iso || "");
}

function sameDate(row, item) {
  const left = row.dateParts || dateParts(row.dateText || row.raw);
  const right = itemDateParts(item);
  return Boolean(left && right && left.day === right.day && left.month === right.month);
}

function rowNumber(cells, typeIndex, dateIndex, timeIndex, raw) {
  const typeCell = cells[typeIndex] || "";
  const inType = sessionNumber(typeCell);
  if (inType !== null) return inType;

  const start = Math.max(0, typeIndex + 1);
  const end = timeIndex >= 0 ? timeIndex : cells.length;
  for (let index = start; index < end; index += 1) {
    if (index === dateIndex) continue;
    const value = String(cells[index] || "").trim();
    if (/^0*\d{1,2}$/.test(value)) return Number(value);
  }

  const type = SESSION_TYPE_RE.exec(String(raw || ""));
  const date = DATE_RE.exec(String(raw || ""));
  if (type && date && date.index > type.index) {
    const between = String(raw || "").slice(type.index + type[0].length, date.index);
    const match = /\b0*(\d{1,2})\b/.exec(between);
    if (match) return Number(match[1]);
  }
  return null;
}

export function parseStructuredAttendanceRows(inputRows) {
  const parsed = [];
  for (const input of inputRows || []) {
    const cells = Array.isArray(input)
      ? input.map((cell) => String(cell || "").replace(/\s+/g, " ").trim()).filter(Boolean)
      : (input?.cells || []).map((cell) => String(cell || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const raw = String(input?.raw || cells.join(" | ") || input || "").replace(/\s+/g, " ").trim();
    if (!raw) continue;

    const type = canonicalSessionType(raw);
    const date = dateParts(raw);
    const time = normaliseClock(raw);
    if (!type || !date || !time) continue;

    const typeIndex = cells.findIndex((cell) => canonicalSessionType(cell));
    const dateIndex = cells.findIndex((cell) => dateParts(cell));
    const timeIndex = cells.findIndex((cell) => normaliseClock(cell));
    const code = codeFromCells(cells, raw, timeIndex);
    if (!code) continue;

    parsed.push({
      type,
      number: rowNumber(cells, typeIndex, dateIndex, timeIndex, raw),
      dateParts: date,
      dateText: dateIndex >= 0 ? cells[dateIndex] : "",
      time,
      code,
      raw,
      sourceUrl: input?.sourceUrl || ""
    });
  }
  return parsed;
}

export function matchStructuredAttendanceRows(inputRows, items) {
  const rows = parseStructuredAttendanceRows(inputRows);
  const claimedCodes = new Set();

  return (items || []).map((item) => {
    const type = canonicalSessionType(item?.session);
    const time = normaliseClock(item?.time);
    const number = sessionNumber(item?.session);
    if (!type || !time || !itemDateParts(item)) return { ...item };

    let candidates = rows.filter((row) => row.type === type && row.time === time && sameDate(row, item));
    if (number !== null) {
      const exactNumber = candidates.filter((row) => row.number === number);
      if (exactNumber.length) candidates = exactNumber;
      else if (candidates.some((row) => row.number !== null)) candidates = [];
    }

    const unique = [...new Map(candidates.map((row) => [`${row.code}|${row.raw}`, row])).values()];
    if (unique.length !== 1 || claimedCodes.has(unique[0].code)) return { ...item };
    claimedCodes.add(unique[0].code);
    const row = unique[0];
    const completed = Boolean(item?.completed) || item?.confidence === "completed";
    const sourceContext = `Moodle attendance table · ${row.raw}`.slice(0, 520);
    return {
      ...item,
      code: row.code,
      codeConfidence: "high",
      confidence: completed ? "completed" : "high",
      context: completed ? `Monash Attendance 已显示完成；签到码来源：${sourceContext}`.slice(0, 620) : sourceContext,
      codeSourceUrl: row.sourceUrl || item.codeSourceUrl || item.sourceUrl,
      sourceUrl: completed ? (item.sourceUrl || row.sourceUrl) : (row.sourceUrl || item.sourceUrl)
    };
  });
}

function identityParts(item) {
  const type = canonicalSessionType(item?.session || item?.attendanceLabel);
  const number = sessionNumber(item?.session || item?.attendanceLabel);
  const time = normaliseClock(item?.time || item?.attendanceLabel);
  const iso = String(item?.attendanceDate?.iso || "");
  const course = String(item?.course || "").toUpperCase();
  return { type, number, time, iso, course };
}

export function attendanceIdentity(item) {
  const { type, number, time, iso, course } = identityParts(item);
  return [iso, course, type, number ?? "", time].join("|");
}

export function restoreCodeEvidence(items, cache = {}) {
  return (items || []).map((item) => {
    if (!needsCodeEvidence(item)) return { ...item };
    const evidence = cache?.[attendanceIdentity(item)];
    if (!evidence?.code || evidence.codeConfidence !== "high") return { ...item };
    const completed = Boolean(item.completed) || item.confidence === "completed";
    return {
      ...item,
      code: evidence.code,
      codeConfidence: "high",
      confidence: completed ? "completed" : "high",
      context: completed
        ? (item.context || "Monash Attendance 已显示完成，无需再次提交。")
        : (evidence.context || item.context || ""),
      codeSourceUrl: evidence.codeSourceUrl || evidence.sourceUrl || item.codeSourceUrl || "",
      sourceUrl: item.sourceUrl || evidence.sourceUrl || ""
    };
  });
}

export function buildCodeEvidenceCache(items, previous = {}) {
  const next = { ...(previous || {}) };
  for (const item of items || []) {
    if (!item?.code || codeConfidenceOf(item) !== "high") continue;
    const key = attendanceIdentity(item);
    if (!key || key.startsWith("||||")) continue;
    next[key] = {
      code: item.code,
      codeConfidence: "high",
      context: item.context || "",
      sourceUrl: item.sourceUrl || "",
      codeSourceUrl: item.codeSourceUrl || item.sourceUrl || "",
      updatedAt: new Date().toISOString()
    };
  }
  return next;
}

const WEEKDAY_INDEX = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

function startOfWeekLocal(date) {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return value;
}

function isoFor(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function attendanceDateKeyFor(date) {
  return `${date.getDate()}_${MONTHS[date.getMonth()]}_${String(date.getFullYear()).slice(-2)}`;
}

// Attendance only ever shows a class once its day has arrived, so a recurring weekly class
// whose day this week hasn't happened yet has no row anywhere to scan - it isn't missing, it
// simply doesn't exist yet. Without this, that looked identical to a class whose day already
// passed with nothing found for it (a genuine gap worth investigating). Project each known
// recurring (course, session, weekday, time) pattern - inferred from whatever week already
// carries it - forward onto this week, and add a placeholder only when that projected date is
// still ahead of today and this week doesn't already have a row for it.
export function projectUpcomingSessions(items, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const monday = startOfWeekLocal(today);
  const patterns = new Map();
  const seenThisWeek = new Set();

  for (const item of items || []) {
    const weekdayIndex = WEEKDAY_INDEX[item?.day];
    const time = normaliseClock(item?.time);
    const course = String(item?.course || "").toUpperCase();
    if (weekdayIndex === undefined || !time || !course) continue;
    const key = `${course}|${String(item.session || "").toLowerCase()}|${weekdayIndex}|${time}`;
    if (!patterns.has(key)) patterns.set(key, item);
    const iso = item?.attendanceDate?.iso;
    if (!iso) continue;
    const itemDate = new Date(`${iso}T12:00:00`);
    if (!Number.isNaN(itemDate.getTime()) && itemDate >= monday) seenThisWeek.add(key);
  }

  const additions = [];
  for (const [key, sample] of patterns) {
    if (seenThisWeek.has(key)) continue;
    const projected = new Date(monday);
    projected.setDate(projected.getDate() + ((WEEKDAY_INDEX[sample.day] + 6) % 7));
    if (projected <= today) continue; // Already due/passed: a real gap, not a not-yet-scanned future class.
    additions.push({
      ...sample,
      id: `${sample.courseId || sample.course}:${sample.sessionId || sample.session || "session"}:upcoming-${isoFor(projected)}`,
      code: "",
      codeConfidence: "missing",
      confidence: "missing",
      completed: false,
      upcoming: true,
      context: "",
      entryUrl: "",
      sourceUrl: "",
      attendanceSourceUrl: "",
      attendanceDate: { iso: isoFor(projected), key: attendanceDateKeyFor(projected) }
    });
  }
  return [...(items || []), ...additions];
}

// The Attendance portal's own UI only ever renders roughly the last couple of weeks, no matter
// what date is requested - a genuine platform limit, not a bug in how this extension reads it.
// That is exactly why this export exists: a student who missed a code six weeks ago has no way
// to see that class in Attendance at all any more, so the whole point is to hand their unit
// coordinator a full list of what should have happened, code included, for manual backfill -
// not to reproduce Attendance's own already-signed-in/not-signed-in status for classes it can
// no longer show. Reuse the exact same (course, session, weekday, time) pattern trick
// projectUpcomingSessions uses for next classes, run backward over every earlier week from
// Week 1 instead of forward from this week, and fill in only the weeks the portal actually left
// blank. Each filled week is flagged outOfPortalRange so the caller can show "无法从 Attendance
// 查询" instead of a false "未签到" - this was never confirmed absent, Attendance just cannot
// say either way for a date that old.
export function projectHistoricalSessions(items, weekOneMonday, now = new Date()) {
  const anchor = new Date(`${weekOneMonday || ""}T00:00:00`);
  if (Number.isNaN(anchor.getTime())) return items || [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const anchorMonday = startOfWeekLocal(anchor);
  const todayMonday = startOfWeekLocal(today);
  const totalWeeks = Math.round((todayMonday - anchorMonday) / 604800000) + 1;
  if (totalWeeks < 1) return items || [];

  const patterns = new Map();
  const seenByWeek = new Map();
  for (const item of items || []) {
    const weekdayIndex = WEEKDAY_INDEX[item?.day];
    const time = normaliseClock(item?.time);
    const course = String(item?.course || "").toUpperCase();
    const iso = item?.attendanceDate?.iso;
    if (weekdayIndex === undefined || !time || !course || !iso) continue;
    const key = `${course}|${String(item.session || "").toLowerCase()}|${weekdayIndex}|${time}`;
    if (!patterns.has(key)) patterns.set(key, item);
    const itemDate = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(itemDate.getTime())) continue;
    const weekIndex = Math.round((startOfWeekLocal(itemDate) - anchorMonday) / 604800000);
    if (!seenByWeek.has(weekIndex)) seenByWeek.set(weekIndex, new Set());
    seenByWeek.get(weekIndex).add(key);
  }
  // Nothing real was ever scanned (e.g. the portal returned zero rows for the whole requested
  // range) - there is no known weekly pattern to project from, so there is nothing safe to add.
  if (!patterns.size) return items || [];

  const additions = [];
  for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex += 1) {
    const seen = seenByWeek.get(weekIndex) || new Set();
    const weekMonday = new Date(anchorMonday);
    weekMonday.setDate(weekMonday.getDate() + weekIndex * 7);
    for (const [key, sample] of patterns) {
      if (seen.has(key)) continue;
      const projected = new Date(weekMonday);
      projected.setDate(projected.getDate() + ((WEEKDAY_INDEX[sample.day] + 6) % 7));
      if (projected > today) continue; // projectUpcomingSessions already owns this week onward.
      additions.push({
        ...sample,
        id: `${sample.courseId || sample.course}:${sample.sessionId || sample.session || "session"}:historical-${isoFor(projected)}`,
        code: "",
        codeConfidence: "missing",
        confidence: "missing",
        completed: false,
        upcoming: false,
        outOfPortalRange: true,
        context: "",
        entryUrl: "",
        sourceUrl: "",
        attendanceSourceUrl: "",
        attendanceDate: { iso: isoFor(projected), key: attendanceDateKeyFor(projected) }
      });
    }
  }
  return [...(items || []), ...additions];
}

export function mergePortalAttendance(items, sessions, attendanceSourceUrl = "https://attendance.monash.edu.my/student/Units.aspx") {
  const byKey = new Map((items || []).map((item) => [attendanceIdentity(item), { ...item }]));
  for (const session of sessions || []) {
    const key = attendanceIdentity(session);
    if (!key || key.startsWith("||||")) continue;
    const existing = byKey.get(key);
    const completed = Boolean(session.completed);
    if (existing) {
      const finalCompleted = completed || Boolean(existing.completed) || existing.confidence === "completed";
      const existingCodeConfidence = codeConfidenceOf(existing);
      byKey.set(key, {
        ...existing,
        entryUrl: session.entryUrl || existing.entryUrl || "",
        completed: finalCompleted,
        confidence: finalCompleted ? "completed" : existing.confidence,
        code: existing.code || "",
        codeConfidence: existingCodeConfidence,
        context: finalCompleted
          ? (existing.code
            ? "Monash Attendance 已显示完成；已保留此前找到的签到码，无需再次提交。"
            : "Monash Attendance 已显示完成，无需再次提交；仍会继续尝试补充历史签到码。")
          : existing.context,
        attendanceSourceUrl: session.sourceUrl || existing.attendanceSourceUrl || attendanceSourceUrl,
        sourceUrl: existing.sourceUrl || session.sourceUrl || attendanceSourceUrl
      });
      continue;
    }

    const date = session.attendanceDate || null;
    const id = `attendance:${date?.iso || "unknown"}:${String(session.course || "").toLowerCase()}:${String(session.session || "session").toLowerCase().replace(/\W+/g, "-")}:${normaliseClock(session.time)}`;
    byKey.set(key, {
      id,
      courseId: String(session.course || "").toLowerCase(),
      course: String(session.course || "").toUpperCase(),
      sessionId: String(session.session || "session").toLowerCase().replace(/\W+/g, "-"),
      session: session.session || "Scheduled activity",
      attendanceLabel: session.attendanceLabel || `${session.course || ""} ${session.session || ""}`.trim(),
      day: session.day || "",
      time: session.time || "",
      week: null,
      code: "",
      codeConfidence: "missing",
      confidence: completed ? "completed" : "missing",
      context: completed ? "Monash Attendance 已显示完成，无需再次提交；仍会继续尝试补充历史签到码。" : "",
      entryUrl: session.entryUrl || "",
      sourceUrl: session.sourceUrl || attendanceSourceUrl,
      attendanceSourceUrl: session.sourceUrl || attendanceSourceUrl,
      attendanceDate: date,
      completed
    });
  }
  return [...byKey.values()].sort((a, b) => String(a.attendanceDate?.iso || "").localeCompare(String(b.attendanceDate?.iso || "")) || String(a.time || "").localeCompare(String(b.time || "")));
}
