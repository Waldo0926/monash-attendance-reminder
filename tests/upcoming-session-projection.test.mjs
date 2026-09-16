import assert from "node:assert/strict";
import test from "node:test";
import { projectUpcomingSessions } from "../extension/reconciliation-core.js";

// A weekly class only shows up on Attendance once its day arrives. Before this, a class whose
// day this week hadn't happened yet was indistinguishable from a class whose day already
// passed with nothing found - both just weren't in the items array. This confused a user who
// saw a course appear for last week and vanish for this week, with no way to tell it apart
// from a real gap.
function fitClass(overrides = {}) {
  return {
    id: "attendance:2026-09-10:fit3162:studio-01",
    courseId: "fit3162",
    course: "FIT3162",
    sessionId: "studio-01",
    session: "Studio 01",
    day: "Thursday",
    time: "5:00 pm",
    completed: true,
    attendanceDate: { iso: "2026-09-10", key: "10_Sep_26" },
    ...overrides
  };
}

test("projects a placeholder for a recurring class whose day this week hasn't happened yet", () => {
  // Wednesday 16 Sep 2026: this week's Thursday (17 Sep) is still ahead.
  const wednesday = new Date(2026, 8, 16);
  const items = [fitClass()]; // only last week's (10 Sep) occurrence is known
  const projected = projectUpcomingSessions(items, wednesday);

  const upcoming = projected.find((item) => item.upcoming);
  assert.ok(upcoming, "an upcoming placeholder must be added");
  assert.equal(upcoming.attendanceDate.iso, "2026-09-17");
  assert.equal(upcoming.course, "FIT3162");
  assert.equal(upcoming.completed, false);
  assert.equal(upcoming.code, "");
  assert.equal(upcoming.entryUrl, "");
});

test("does not project a placeholder once this week's occurrence already exists", () => {
  const wednesday = new Date(2026, 8, 16);
  const items = [
    fitClass(), // last week
    fitClass({ id: "attendance:2026-09-17:fit3162:studio-01", attendanceDate: { iso: "2026-09-17", key: "17_Sep_26" }, completed: false })
  ];
  const projected = projectUpcomingSessions(items, wednesday);
  assert.equal(projected.filter((item) => item.upcoming).length, 0);
  assert.equal(projected.length, items.length);
});

test("does not project a placeholder for a day that has already passed this week", () => {
  // Wednesday 16 Sep 2026: this week's Monday (14 Sep) has already happened - a missing
  // Monday item is a real gap, not "not due yet".
  const wednesday = new Date(2026, 8, 16);
  const items = [fitClass({ day: "Monday", attendanceDate: { iso: "2026-09-03", key: "3_Sep_26" } })];
  const projected = projectUpcomingSessions(items, wednesday);
  assert.equal(projected.filter((item) => item.upcoming).length, 0);
});
