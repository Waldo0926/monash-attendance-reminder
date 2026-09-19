import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { projectHistoricalSessions } from "../extension/reconciliation-core.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// The Attendance portal's own UI only ever renders roughly the last couple of weeks no matter
// what date is requested in the URL hash - a real platform limit, confirmed by hand against the
// live site, not a bug in how the extension reads it. That is exactly why this export exists: a
// student who missed a code weeks ago has no way to even see that class in Attendance any more.
// The three earlier Gmail-matching fixes never touched this because the session LIST itself
// (before any code search even starts) was already missing every week Attendance's UI could no
// longer show - there was nothing there yet for Gmail to attach a code to.
test("projectHistoricalSessions fills every week the portal left blank using the recurring weekly pattern", () => {
  const weekOneMonday = "2026-07-27";
  // Only the two most recent weeks came back from the portal - the platform's real window.
  const realItems = [
    { course: "FIT2102", session: "Workshop 01", day: "Tuesday", time: "4:00 PM", completed: true, code: "JY4H6", confidence: "high", codeConfidence: "high", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" } },
    { course: "FIT2109", session: "Tutorial 05", day: "Friday", time: "2:00 PM", completed: true, code: "PMM66", confidence: "high", codeConfidence: "high", attendanceDate: { iso: "2026-09-18", key: "18_Sep_26" } }
  ];
  const filled = projectHistoricalSessions(realItems, weekOneMonday, new Date("2026-09-19T12:00:00"));

  const projected = filled.filter((item) => item.outOfPortalRange);
  assert.ok(projected.length > 0, "must add placeholder rows for weeks the portal never returned anything for");

  // Week 1 (27 Jul) is a Monday, so the Tuesday FIT2102 Workshop pattern must be projected onto
  // 28 Jul even though Attendance itself has never shown that date to this student again.
  const week1Workshop = projected.find((item) => item.course === "FIT2102" && item.attendanceDate.iso === "2026-07-28");
  assert.ok(week1Workshop, "must project the Tuesday FIT2102 Workshop pattern back to Week 1");
  assert.equal(week1Workshop.code, "", "a projected row must not inherit the real row's code - it was never actually checked for this week");
  assert.equal(week1Workshop.completed, false);

  // Real, portal-confirmed rows must never be touched or duplicated by the projection.
  const stillReal = filled.filter((item) => item.attendanceDate.iso === "2026-09-08");
  assert.equal(stillReal.length, 1, "a week the portal actually covered must not also get a projected duplicate");
  assert.equal(stillReal[0].outOfPortalRange, undefined);

  // Nothing may be projected into the future - that is projectUpcomingSessions' job.
  assert.ok(filled.every((item) => new Date(`${item.attendanceDate.iso}T12:00:00`) <= new Date("2026-09-19T12:00:00")));
});

test("projectHistoricalSessions does nothing when there is no real data to infer a weekly pattern from", () => {
  const filled = projectHistoricalSessions([], "2026-07-27", new Date("2026-09-19T12:00:00"));
  assert.deepEqual(filled, [], "must not invent sessions out of thin air with zero portal evidence");
});

test("buildSemesterHistory fills the portal's own display-window gap before searching for codes", () => {
  const serviceWorker = read("../extension/service-worker.js");
  assert.match(serviceWorker, /import\s*\{[^}]*\bprojectHistoricalSessions\b[^}]*\}\s*from\s*"\.\/reconciliation-core\.js"/);
  const fn = serviceWorker.slice(serviceWorker.indexOf("async function buildSemesterHistory"));
  const projectionCall = fn.indexOf("projectHistoricalSessions(items, settings.weekOneMonday, today)");
  const restoreCall = fn.indexOf("restoreCodeEvidence(items, stored[EVIDENCE_CACHE_KEY]");
  const searchCall = fn.indexOf("automaticSourceScans(items.filter(needsCodeEvidence)");
  assert.ok(projectionCall > -1, "must call projectHistoricalSessions");
  assert.ok(projectionCall < restoreCall && restoreCall < searchCall, "projection must run before cache restore and source searching, so the filled-in weeks also get looked up for codes");
});

test("the exported CSV never shows a false 未签到 for a class Attendance was never actually asked to confirm", () => {
  const options = read("../extension/options.js");
  assert.match(options, /item\.outOfPortalRange\s*\?\s*"无法从Attendance查询/, "a projected row must read as unconfirmed, not as a missed sign-in");
});

test("options.js tells the student how many rows were filled in versus actually confirmed by Attendance", () => {
  const options = read("../extension/options.js");
  assert.match(options, /range\.projectedCount/);
});
