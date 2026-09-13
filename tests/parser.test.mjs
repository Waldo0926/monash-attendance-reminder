import test from "node:test";
import assert from "node:assert/strict";
import { ATTENDANCE_URL, DEFAULT_SETTINGS, attendanceDate, extractCandidates, hasUsableConfig, matchCodesToAttendance, parseDateKey, recentAttendanceDates, teachingWeek } from "../extension/shared.js";

test("ships with a blank per-user course configuration", () => {
  assert.deepEqual(DEFAULT_SETTINGS.courses, []);
  assert.equal(DEFAULT_SETTINGS.weekOneMonday, "");
  assert.equal(DEFAULT_SETTINGS.autoDiscover, true);
  assert.equal(teachingWeek(DEFAULT_SETTINGS, new Date("2026-09-13T12:00:00+08:00")), null);
});

test("builds a seven-day Attendance discovery window without a timetable", () => {
  const dates = recentAttendanceDates(new Date("2026-09-13T12:00:00+08:00"), 7);
  assert.equal(dates[0].iso, "2026-09-07");
  assert.equal(dates[6].iso, "2026-09-13");
});

test("matches a Gmail code to a class discovered from Attendance", () => {
  const items = [{ course: "ENG2005", session: "Workshop 12", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" } }];
  const [result] = matchCodesToAttendance("Week 7 Attendance Codes\nENG2005 Workshop 12 Tuesday 8 Sep 12:00PM S7M3X", items);
  assert.equal(result.code, "S7M3X");
});

test("rejects a candidate that would apply identically to two unrelated classes", () => {
  const items = [
    { course: "FIT2102", session: "Workshop 01" },
    { course: "FIT2109", session: "Tutorial 05" }
  ];
  // "1CRLF" sits close enough to both course mentions to score for either one, which is
  // exactly the shape of a false positive picked up from an unrelated page (an ID, a build
  // number, anything 5 characters long) rather than a real per-session signed code.
  const text = "FIT2102 Workshop 01\n1CRLF\nFIT2109 Tutorial 05";
  const [first, second] = matchCodesToAttendance(text, items);
  assert.equal(first.code, "");
  assert.equal(first.confidence, "missing");
  assert.equal(second.code, "");
  assert.equal(second.confidence, "missing");
});

test("keeps a code that only matches a single class", () => {
  const items = [
    { course: "FIT2102", session: "Workshop 01" },
    { course: "FIT2109", session: "Tutorial 05" }
  ];
  // Non-blank filler lines, since blank lines get filtered out before the context
  // window is measured and so can't actually separate two matches on their own.
  const filler = Array.from({ length: 8 }, (_, i) => `unrelated line ${i}`).join("\n");
  const text = `FIT2102 Workshop 01 Tuesday ABC1D\n${filler}\nFIT2109 Tutorial 05 Friday XY9ZQ`;
  const [first, second] = matchCodesToAttendance(text, items);
  assert.equal(first.code, "ABC1D");
  assert.equal(second.code, "XY9ZQ");
});

test("calculates Week 1 and Week 7 from the configured Monday", () => {
  const settings = { weekOneMonday: "2026-07-27" };
  assert.equal(teachingWeek(settings, new Date("2026-07-27T12:00:00+08:00")), 1);
  assert.equal(teachingWeek(settings, new Date("2026-09-13T12:00:00+08:00")), 7);
});

test("builds the Attendance date key from teaching week and weekday", () => {
  const settings = { weekOneMonday: "2026-07-27" };
  assert.deepEqual(attendanceDate(settings, 7, "Wednesday"), { iso: "2026-09-09", key: "9_Sep_26" });
});

test("matches a code to the correct class using nearby context", () => {
  const course = {
    id: "fit2102",
    name: "FIT2102",
    url: "https://example.test",
    category: "Malaysia",
    sessions: [
      { id: "workshop01", label: "Workshop 01", day: "Tuesday", time: "16:00", aliases: ["Workshop 1"] },
      { id: "tutorial09", label: "Tutorial 09", day: "Wednesday", time: "14:00", aliases: ["Tutorial 9"] }
    ]
  };
  const text = `FIT2102 Malaysia Week 7\nWorkshop 01 Tuesday 16:00 ABC1D\nTutorial 09 Wednesday 14:00 XY9ZQ`;
  const results = extractCandidates(text, course, 7);
  assert.equal(results[0].code, "ABC1D");
  assert.equal(results[1].code, "XY9ZQ");
  assert.equal(results[0].confidence, "high");
});

test("treats the default auto-discovery setup as usable without a Week 1 date", () => {
  const settings = { ...DEFAULT_SETTINGS, reminder: { weekday: 0, hour: 19, minute: 0 }, backup: { enabled: false } };
  assert.equal(settings.weekOneMonday, "");
  assert.equal(hasUsableConfig(settings), true);
});

test("requires a Week 1 date and a real course only once auto-discovery is turned off", () => {
  const base = { autoDiscover: false, reminder: { weekday: 0, hour: 19, minute: 0 }, backup: { enabled: false } };
  assert.equal(hasUsableConfig({ ...base, weekOneMonday: "" }), false);
  assert.equal(hasUsableConfig({ ...base, weekOneMonday: "2026-07-27" }), false);
  const course = { enabled: true, name: "FIT2102", url: "https://learning.monash.edu/x", sessions: [{ id: "s1" }] };
  assert.equal(hasUsableConfig({ ...base, weekOneMonday: "2026-07-27", courses: [course] }), true);
});

test("builds the Units page beside Default.aspx without duplicating /student/", () => {
  assert.equal(new URL("Units.aspx", ATTENDANCE_URL).pathname, "/student/Units.aspx");
});

test("parses the real Attendance date key format seen on Entry.aspx links", () => {
  assert.deepEqual(parseDateKey("8_Sep_26"), { iso: "2026-09-08", key: "8_Sep_26" });
  assert.deepEqual(parseDateKey("11_Sep_26"), { iso: "2026-09-11", key: "11_Sep_26" });
  assert.equal(parseDateKey("not-a-date"), null);
  assert.equal(parseDateKey(""), null);
});

test("does not accept a code without a matching class label", () => {
  const course = {
    id: "fit3162",
    name: "FIT3162",
    url: "https://example.test",
    sessions: [{ id: "studio01", label: "Studio 01", day: "Thursday", time: "17:00", aliases: ["Studio 1"] }]
  };
  const [result] = extractCandidates("Week 7 general notice X1Y2Z", course, 7);
  assert.equal(result.code, "");
  assert.equal(result.confidence, "missing");
});
