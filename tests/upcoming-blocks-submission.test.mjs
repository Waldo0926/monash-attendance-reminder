import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Staff sometimes publish a code days before the class actually happens. Attendance itself
// will not accept a submission until the session is over, so a class that hasn't started yet
// must never be presented as "high confidence, ready to submit" just because a code was found
// early - that used to only check item.upcoming (the projected-placeholder case), so a class
// with a real portal row but a future start time still looked submittable.
test("a class that has not started yet is never checkable, even with a high-confidence code", () => {
  const review = read("../extension/review.js");
  assert.match(review, /function isUpcomingSession\(/);
  assert.match(review, /function sessionStart\(/);

  const statusFn = review.slice(review.indexOf("function itemStatus("));
  const completedIndex = statusFn.indexOf('key: "completed"');
  const upcomingIndex = statusFn.indexOf("isUpcomingSession(item)");
  const highIndex = statusFn.indexOf('item.confidence === "high"');
  assert.ok(completedIndex >= 0 && upcomingIndex > completedIndex && highIndex > upcomingIndex,
    "itemStatus must check isUpcomingSession before falling through to confidence-based labels");

  assert.match(review, /const autoChecked = !completed && !upcoming && item\.code/);
  assert.match(review, /const checkboxDisabled = completed \|\| upcoming \|\| !item\.code/);
});

test("isUpcomingSession treats a future scheduled start time as upcoming even without the projection flag", () => {
  const review = read("../extension/review.js");
  // sessionStart() must be derived from attendanceDate + time, not just the synthetic
  // projectUpcomingSessions() placeholder flag - a real portal row for a same-day class that
  // hasn't started yet needs the same treatment.
  assert.match(review, /if \(item\?\.upcoming\) return true;/);
  assert.match(review, /return Boolean\(start\) && start\.getTime\(\) > now\.getTime\(\)/);
});
