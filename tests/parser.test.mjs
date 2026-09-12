import test from "node:test";
import assert from "node:assert/strict";
import { attendanceDate, extractCandidates, teachingWeek } from "../extension/shared.js";

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
