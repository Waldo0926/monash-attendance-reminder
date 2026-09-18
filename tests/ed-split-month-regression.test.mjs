import test from "node:test";
import assert from "node:assert/strict";
import { matchCodesToAttendance } from "../extension/shared.js";

test("repairs Ed rows where the month is detached onto the next DOM line", () => {
  // Real FIT2102 Week 8 Ed rendering: the visual table row is split so that "Sep"
  // becomes its own DOM line after the code. The parser must rebuild "16 Sep" before
  // applying the exact date/session/time guards rather than weakening those guards.
  const text = [
    "FIT2102 Week 8 Attendance Codes",
    "Workshop Tuesday, 15 Sep 01 4:00PM TYBZR",
    "Tutorial Wednesday, 16 01 8:00AM 8NMZY",
    "Sep",
    "Tutorial Wednesday, 16 02 10:00AM XNQGS",
    "Sep",
    "Tutorial Wednesday, 16 09 2:00PM UBMP4",
    "Sep",
    "Tutorial Thursday, 17 Sep 03 10:00AM YUUCG"
  ].join("\n");
  const items = [
    {
      course: "FIT2102",
      session: "Workshop 01",
      time: "4:00 pm",
      attendanceDate: { iso: "2026-09-15", key: "15_Sep_26" }
    },
    {
      course: "FIT2102",
      session: "Tutorial 09",
      time: "2:00 pm",
      attendanceDate: { iso: "2026-09-16", key: "16_Sep_26" }
    }
  ];

  const [workshop, tutorial09] = matchCodesToAttendance(text, items);
  assert.equal(workshop.code, "TYBZR");
  assert.equal(workshop.confidence, "high");
  assert.equal(tutorial09.code, "UBMP4");
  assert.equal(tutorial09.confidence, "high");
});

test("a detached month still has to match the exact Attendance date", () => {
  const text = [
    "Tutorial Wednesday, 16 09 2:00PM BAD9X",
    "Oct"
  ].join("\n");
  const [result] = matchCodesToAttendance(text, [{
    course: "FIT2102",
    session: "Tutorial 09",
    time: "2:00 pm",
    attendanceDate: { iso: "2026-09-16", key: "16_Sep_26" }
  }]);

  assert.equal(result.code, "");
  assert.equal(result.confidence, "missing");
});

test("does not borrow a non-adjacent month from unrelated context", () => {
  const text = [
    "Tutorial Wednesday, 16 09 2:00PM UBMP4",
    "unrelated paragraph",
    "Sep"
  ].join("\n");
  const [result] = matchCodesToAttendance(text, [{
    course: "FIT2102",
    session: "Tutorial 09",
    time: "2:00 pm",
    attendanceDate: { iso: "2026-09-16", key: "16_Sep_26" }
  }]);

  assert.equal(result.code, "");
  assert.equal(result.confidence, "missing");
});
