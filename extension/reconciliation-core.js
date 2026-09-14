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
    if (item?.completed) return { ...item };
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
    return {
      ...item,
      code: row.code,
      confidence: "high",
      context: `Moodle attendance table · ${row.raw}`.slice(0, 520),
      sourceUrl: row.sourceUrl || item.sourceUrl
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

export function mergePortalAttendance(items, sessions, attendanceSourceUrl = "https://attendance.monash.edu.my/student/Units.aspx") {
  const byKey = new Map((items || []).map((item) => [attendanceIdentity(item), { ...item }]));
  for (const session of sessions || []) {
    const key = attendanceIdentity(session);
    if (!key || key.startsWith("||||")) continue;
    const existing = byKey.get(key);
    const completed = Boolean(session.completed);
    if (existing) {
      byKey.set(key, {
        ...existing,
        entryUrl: session.entryUrl || existing.entryUrl || "",
        completed: completed || Boolean(existing.completed),
        confidence: completed ? "completed" : existing.confidence,
        code: completed ? "" : existing.code,
        context: completed ? "Monash Attendance 已显示完成，无需再次提交。" : existing.context,
        sourceUrl: session.sourceUrl || existing.sourceUrl || attendanceSourceUrl
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
      confidence: completed ? "completed" : "missing",
      context: completed ? "Monash Attendance 已显示完成，无需再次提交。" : "",
      entryUrl: session.entryUrl || "",
      sourceUrl: session.sourceUrl || attendanceSourceUrl,
      attendanceDate: date,
      completed
    });
  }
  return [...byKey.values()].sort((a, b) => String(a.attendanceDate?.iso || "").localeCompare(String(b.attendanceDate?.iso || "")) || String(a.time || "").localeCompare(String(b.time || "")));
}
