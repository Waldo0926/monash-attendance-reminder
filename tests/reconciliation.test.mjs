import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodeEvidenceCache,
  codeConfidenceOf,
  isCompletionClue,
  matchStructuredAttendanceRows,
  mergePortalAttendance,
  parseStructuredAttendanceRows,
  restoreCodeEvidence
} from "../extension/reconciliation-core.js";

const trcRows = [
  ["Session", "Date & Time", "Attendance Code"],
  ["Workshop 1", "Wednesday, 9 Sep | 10:00 AM", "W9JTY"],
  ["Workshop 2", "Thursday, 10 Sep | 12:00 PM", "MWJU6"],
  ["Lab 4", "Wednesday, 9 Sep | 1:00 PM", "H2JNY"],
  ["Lab 1", "Thursday, 10 Sep | 8:30 AM", "SU8UR"],
  ["Lab 3", "Thursday, 10 Sep | 3:00 PM", "7JZM8"],
  ["Lab 5", "Friday, 11 Sep | 8:30 AM", "NLVYZ"],
  ["Lab 6", "Friday, 11 Sep | 3:00 PM", "X2DB3"]
];

test("parses the real TRC2001 Moodle attendance table deterministically", () => {
  const rows = parseStructuredAttendanceRows(trcRows);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((row) => row.code), ["W9JTY", "MWJU6", "H2JNY", "SU8UR", "7JZM8", "NLVYZ", "X2DB3"]);
  assert.equal(rows[1].type, "workshop");
  assert.equal(rows[1].number, 2);
  assert.equal(rows[4].type, "laboratory");
  assert.equal(rows[4].number, 3);
});

test("matches the user's TRC2001 Workshop 02 and Laboratory 03 exact rows", () => {
  const items = [
    { id: "w2", course: "TRC2001", session: "Workshop 02", time: "12:00 pm", attendanceDate: { iso: "2026-09-10", key: "10_Sep_26" }, confidence: "missing", code: "" },
    { id: "l3", course: "TRC2001", session: "Laboratory 03", time: "3:00 pm", attendanceDate: { iso: "2026-09-10", key: "10_Sep_26" }, confidence: "missing", code: "" }
  ];
  const [workshop, lab] = matchStructuredAttendanceRows(trcRows, items);
  assert.equal(workshop.code, "MWJU6");
  assert.equal(workshop.confidence, "high");
  assert.equal(workshop.codeConfidence, "high");
  assert.equal(lab.code, "7JZM8");
  assert.equal(lab.confidence, "high");
});

test("also handles the Monash table layout with the class number in its own cell", () => {
  const rows = [
    ["Workshop", "Tuesday, 8 Sep", "01", "4:00PM", "JY4H6"],
    ["Tutorial", "Wednesday, 9 Sep", "09", "2:00PM", "JKAHX"]
  ];
  const items = [
    { course: "FIT2102", session: "Workshop 01", time: "4:00 pm", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" } },
    { course: "FIT2102", session: "Tutorial 09", time: "2:00 pm", attendanceDate: { iso: "2026-09-09", key: "9_Sep_26" } }
  ];
  const [workshop, tutorial] = matchStructuredAttendanceRows(rows, items);
  assert.equal(workshop.code, "JY4H6");
  assert.equal(tutorial.code, "JKAHX");
});

test("recognises the Bootstrap icon used by completed Monash Attendance rows", () => {
  assert.equal(isCompletionClue("glyphicon glyphicon-ok text-success"), true);
  assert.equal(isCompletionClue("fa fa-check-circle"), true);
  assert.equal(isCompletionClue("glyphicon glyphicon-question-sign"), false);
});

test("keeps an already-completed Attendance class in the review data", () => {
  const existing = [
    { id: "eng", course: "ENG2005", session: "Workshop 01", time: "8:00 am", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" }, code: "ADDKB", confidence: "high" }
  ];
  const portal = [
    { course: "ENG2005", session: "Workshop 01", time: "8:00 am", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" }, completed: true, entryUrl: "", sourceUrl: "https://attendance.monash.edu.my/student/Units.aspx#8_Sep_26" },
    { course: "MMA2004", session: "Workshop 01", time: "2:00 pm", day: "Tuesday", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" }, completed: true, entryUrl: "", sourceUrl: "https://attendance.monash.edu.my/student/Units.aspx#8_Sep_26" }
  ];
  const merged = mergePortalAttendance(existing, portal);
  assert.equal(merged.length, 2);

  const eng = merged.find((item) => item.course === "ENG2005");
  assert.equal(eng.completed, true);
  assert.equal(eng.confidence, "completed");
  assert.equal(eng.code, "ADDKB", "marking a row completed must never erase a known code");
  assert.equal(eng.codeConfidence, "high");

  const mma = merged.find((item) => item.course === "MMA2004");
  assert.ok(mma);
  assert.equal(mma.completed, true);
  assert.equal(mma.confidence, "completed");
  assert.equal(mma.code, "");
  assert.match(mma.context, /无需再次提交/);
});

test("same-day completed sessions remain distinct during portal merge", () => {
  const portal = [
    { course: "FIT2102", session: "Workshop 01", time: "4:00 pm", day: "Tuesday", attendanceDate: { iso: "2026-09-15", key: "15_Sep_26" }, completed: true, entryUrl: "", sourceUrl: "https://attendance.monash.edu.my/student/Units.aspx#15_Sep_26" },
    { course: "FIT2102", session: "Tutorial 06", time: "6:00 pm", day: "Tuesday", attendanceDate: { iso: "2026-09-15", key: "15_Sep_26" }, completed: true, entryUrl: "", sourceUrl: "https://attendance.monash.edu.my/student/Units.aspx#15_Sep_26" },
    { course: "FIT3162", session: "Studio 01", time: "5:00 pm", day: "Tuesday", attendanceDate: { iso: "2026-09-15", key: "15_Sep_26" }, completed: true, entryUrl: "", sourceUrl: "https://attendance.monash.edu.my/student/Units.aspx#15_Sep_26" }
  ];
  const merged = mergePortalAttendance([], portal);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((item) => `${item.course}|${item.session}|${item.time}`).sort(),
    ["FIT2102|Tutorial 06|6:00 pm", "FIT2102|Workshop 01|4:00 pm", "FIT3162|Studio 01|5:00 pm"]
  );
  assert.ok(merged.every((item) => item.completed && item.confidence === "completed"));
});

test("a completed class can still be enriched with its historical Moodle code", () => {
  const rows = [["Workshop", "Tuesday, 8 Sep", "01", "2:00PM", "JSXDV"]];
  const item = {
    id: "mma",
    course: "MMA2004",
    session: "Workshop 01",
    time: "2:00 pm",
    attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" },
    completed: true,
    confidence: "completed",
    code: ""
  };
  const [matched] = matchStructuredAttendanceRows(rows, [item]);
  assert.equal(matched.completed, true);
  assert.equal(matched.confidence, "completed");
  assert.equal(matched.code, "JSXDV");
  assert.equal(matched.codeConfidence, "high");
  assert.match(matched.context, /已显示完成/);
});

test("last-known high-confidence code evidence survives later rescans", () => {
  const completedWithCode = {
    course: "MMA2004",
    session: "Workshop 01",
    time: "2:00 pm",
    attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" },
    completed: true,
    confidence: "completed",
    code: "JSXDV",
    codeConfidence: "high",
    codeSourceUrl: "https://learning.monash.edu/mod/forum/view.php?id=1"
  };
  const cache = buildCodeEvidenceCache([completedWithCode]);
  const restored = restoreCodeEvidence([{
    ...completedWithCode,
    code: "",
    codeConfidence: "missing",
    context: "Monash Attendance 已显示完成，无需再次提交。"
  }], cache)[0];
  assert.equal(restored.completed, true);
  assert.equal(restored.confidence, "completed");
  assert.equal(restored.code, "JSXDV");
  assert.equal(codeConfidenceOf(restored), "high");
});
