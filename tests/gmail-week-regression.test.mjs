import test from "node:test";
import assert from "node:assert/strict";
import { matchCodesToAttendance } from "../extension/shared.js";

const week7Workshop = {
  course: "ENG2005",
  session: "Workshop 01",
  day: "Tuesday",
  time: "8:00 am",
  attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" }
};

test("prefers the exact ENG2005 Week 7 date over an undated same-slot newer email", () => {
  const text = [
    "ENG2005 - MUM S2 2026 - Announcements - Week 8 - Attendance Code",
    "Workshop Tuesday 8:00AM 9RAH3",
    "ENG2005 - MUM S2 2026 - Announcements - Week 7 - Attendance Code",
    "Workshop Tuesday, 8 Sep 8:00AM ADDKB",
    "Workshop Tuesday, 8 Sep 12:00PM S7M3X"
  ].join("\n");

  const [result] = matchCodesToAttendance(text, [week7Workshop]);
  assert.equal(result.code, "ADDKB");
  assert.equal(result.confidence, "review");
});

test("rejects an undated same-slot Gmail candidate from another week", () => {
  const [result] = matchCodesToAttendance(
    "ENG2005 Week 8 Attendance Code\nWorkshop Tuesday 8:00AM 9RAH3",
    [week7Workshop]
  );
  assert.equal(result.code, "");
  assert.equal(result.confidence, "missing");
});

test("rejects an explicitly different week's date even when type and time match", () => {
  const [result] = matchCodesToAttendance(
    "ENG2005 Week 8 Attendance Code\nWorkshop Tuesday, 15 Sep 8:00AM 9RAH3",
    [week7Workshop]
  );
  assert.equal(result.code, "");
  assert.equal(result.confidence, "missing");
});

test("leaves a numberless row unassigned when two attendance groups share the exact slot", () => {
  const items = [
    week7Workshop,
    { ...week7Workshop, session: "Workshop 02" }
  ];
  const results = matchCodesToAttendance(
    "ENG2005 Week 7 Attendance Code\nWorkshop Tuesday, 8 Sep 8:00AM ADDKB",
    items
  );
  assert.equal(results[0].code, "");
  assert.equal(results[0].confidence, "missing");
  assert.equal(results[1].code, "");
  assert.equal(results[1].confidence, "missing");
});
