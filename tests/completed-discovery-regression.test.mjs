import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("Attendance pages are not mutated by a completed-row DOM shim", () => {
  const manifest = JSON.parse(read("../extension/manifest.json"));
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  const wrapper = read("../extension/service-worker-wrapper.js");
  assert.ok(scripts.includes("content.js"), "normal content reader must still be loaded");
  assert.ok(!scripts.includes("attendance-portal-shim.js"), "Attendance DOM shim must not run as a content script");
  assert.doesNotMatch(wrapper, /attendance-shim-bootstrap/);
});

test("final reconciliation detects completed rows directly from the live Attendance DOM", () => {
  const reconciler = read("../extension/reconciliation-v3.js");
  assert.match(reconciler, /function extractAttendanceRows/);
  assert.match(reconciler, /glyphicon-ok/);
  assert.match(reconciler, /ui-icon-check/);
  assert.match(reconciler, /const completed = syntheticCompleted \|\| \(!realEntryHref && \(completedHint \|\| completionClue/);
  assert.match(reconciler, /entryUrl: completed \? "" : realEntryHref/);
});

test("a real Entry.aspx row remains pending even if generic success CSS exists", () => {
  const reconciler = read("../extension/reconciliation-v3.js");
  assert.match(reconciler, /const realEntryHref = syntheticCompleted \? "" : String\(entryHref \|\| ""\)/);
  assert.match(reconciler, /const completed = syntheticCompleted \|\| \(!realEntryHref && \(completedHint \|\| completionClue/);
});

test("review and popup never submit completed rows", () => {
  const review = read("../extension/review.js");
  const popup = read("../extension/popup.js");
  assert.match(review, /function portalCompleted\(item\)/);
  assert.match(review, /latestScan\.items\.filter\(\(item\) => !portalCompleted\(item\)/);
  assert.match(popup, /function portalCompleted\(item\)/);
  assert.match(popup, /\.filter\(portalCompleted\)/);
});

test("settings test flow does not stop after the preliminary SCAN_ALL result", () => {
  const options = read("../extension/options.js");
  const scanIndex = options.indexOf('type: "SCAN_ALL"');
  const reconciliationIndex = options.indexOf('type: "RUN_FINAL_RECONCILIATION"');
  assert.ok(scanIndex >= 0, "settings page must run the preliminary scan");
  assert.ok(reconciliationIndex > scanIndex, "settings page must run final reconciliation after the preliminary scan");
});
