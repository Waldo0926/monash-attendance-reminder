import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// v1.3.23/v1.3.24 could freeze indefinitely on "final reconciliation": every executeScript
// call against a live Attendance/Moodle tab was awaited with no timeout, so one unresponsive
// tab stalled the whole scan and the UI's sendMessage() call sat waiting forever with no way
// to recover short of restarting the browser.
test("reconciliation v3 bounds every scripting.executeScript call with a timeout", () => {
  const reconciler = read("../extension/reconciliation-v3.js");
  assert.match(reconciler, /function withTimeout\(/, "a timeout helper must exist");
  const executeCalls = reconciler.match(/await withTimeout\(\s*\n?\s*chrome\.scripting\.executeScript/g) || [];
  assert.ok(executeCalls.length >= 2, "both the document probe and the read attempt must be time-boxed");
});

test("reconciliation v3 caps how long a single Attendance date or Moodle page can stall the scan", () => {
  const reconciler = read("../extension/reconciliation-v3.js");
  assert.match(reconciler, /withTimeout\(runOnPage\(url, extractAttendanceRows/, "a stuck Attendance date must not block the remaining dates");
  assert.match(reconciler, /withTimeout\(runOnPage\(url, extractMoodleEvidence/, "a stuck Moodle page must not block course resolution");
});

test("popup, review and options never await the background scan without a client-side timeout", () => {
  const shared = read("../extension/shared.js");
  assert.match(shared, /export function sendMessageWithTimeout/);
  for (const file of ["../extension/popup.js", "../extension/review.js", "../extension/options.js"]) {
    const source = read(file);
    assert.match(source, /sendMessageWithTimeout/, `${file} must guard SCAN_ALL/RUN_FINAL_RECONCILIATION with a timeout`);
    assert.doesNotMatch(source, /chrome\.runtime\.sendMessage\(\{\s*type:\s*"SCAN_ALL"/, `${file} must not call SCAN_ALL without the timeout wrapper`);
    assert.doesNotMatch(source, /chrome\.runtime\.sendMessage\(\{\s*type:\s*"RUN_FINAL_RECONCILIATION"/, `${file} must not call RUN_FINAL_RECONCILIATION without the timeout wrapper`);
  }
});
