import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// The Ed thread-cap fix (v1.3.41) still came back with FIT2102/FIT3162 blank in the user's
// own real semester export, but the only logging automaticSourceScans ever had was scoped
// to Gmail URLs - Ed dashboard, Ed discussion list, Ed thread, Moodle my-units and Moodle
// section scans were all completely invisible in the debug log, so there was no way to tell
// from the outside whether the Ed/Moodle fallback ran at all, matched the right course, or
// picked the wrong threads/weeks. These diagnostics make every one of those steps show up
// in the same debug log the Gmail steps already use, so the next real run gives actual
// evidence instead of another guess. Safe to remove once the underlying gap is resolved.
test("automaticSourceScans logs the Ed dashboard scan and what it matched", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const edSection = serviceWorker.slice(
    serviceWorker.indexOf("const edDashboard = await scan"),
    serviceWorker.indexOf("const resolvedCourses = confidentlyResolvedCourses(scans, items);")
  );
  assert.match(edSection, /logDebug\("ed dashboard scan"/);
  assert.match(edSection, /logDebug\(`ed course discussion list \$\{course\.href\}`/);
  assert.match(edSection, /logDebug\(`ed thread scan \$\{threadUrl\}`/);
});

test("automaticSourceScans logs the Moodle my-units scan and each course/section it opens", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const moodleSection = serviceWorker.slice(
    serviceWorker.indexOf("const myUnits = await scan"),
    serviceWorker.indexOf("return scans;\n}\n\nasync function scanCourse")
  );
  assert.match(moodleSection, /logDebug\("moodle my-units scan"/);
  assert.match(moodleSection, /logDebug\(`moodle course home \$\{course\.href\}`/);
  assert.match(moodleSection, /logDebug\(`moodle section scan week \$\{week\}/);
});

// The old `if (!home?.ok) continue;` sat before targetWeeks/availableWeeks/selectedWeeks
// were ever computed, so a failed Moodle course-home fetch left no trace of what would have
// been searched. The diagnostic log line must fire even when the fetch failed, so a broken
// fetch is visible instead of silently indistinguishable from "nothing needed".
test("the Moodle course diagnostic logs even when the course home page failed to load", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const moodleSection = serviceWorker.slice(
    serviceWorker.indexOf("for (const course of moodleCourses.slice(0, 8))"),
    serviceWorker.indexOf("return scans;\n}\n\nasync function scanCourse")
  );
  const logIndex = moodleSection.indexOf("logDebug(`moodle course home");
  const continueIndex = moodleSection.indexOf("if (!home?.ok) continue;");
  assert.ok(logIndex >= 0 && continueIndex >= 0 && logIndex < continueIndex, "the diagnostic must log before the ok-guard skips the course");
});
