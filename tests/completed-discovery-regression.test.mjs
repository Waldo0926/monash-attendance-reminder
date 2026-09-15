import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("completed Attendance rows are injected before normal page discovery", () => {
  const manifest = JSON.parse(read("../extension/manifest.json"));
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  const shimIndex = scripts.indexOf("attendance-portal-shim.js");
  const contentIndex = scripts.indexOf("content.js");
  assert.ok(shimIndex >= 0, "completed-row discovery shim must be loaded");
  assert.ok(contentIndex >= 0, "normal content reader must be loaded");
  assert.ok(shimIndex < contentIndex, "completed rows must be exposed before content.js reads page links");
});

test("completed-row shim never replaces a real pending Entry.aspx row", () => {
  const shim = read("../extension/attendance-portal-shim.js");
  assert.match(shim, /row\.querySelector\("a\[href\*='Entry\.aspx'\]"\)\) continue/);
  assert.match(shim, /completionClue\(rowClue\(row\)\)/);
  assert.match(shim, /mah_completed/);
  assert.match(shim, /mah_id/);
  assert.match(shim, /Entry\.aspx-completed/);
});

test("final reconciliation treats synthetic completed links as completed but not submittable", () => {
  const reconciler = read("../extension/reconciliation-v3.js");
  assert.match(reconciler, /function extractAttendanceRows/);
  assert.match(reconciler, /searchParams\.get\("mah_completed"\) === "1"/);
  assert.match(reconciler, /const syntheticCompleted = syntheticCompletedHref\(entryHref\)/);
  assert.match(reconciler, /const realEntryHref = syntheticCompleted \? "" : String\(entryHref \|\| ""\)/);
  assert.match(reconciler, /entryUrl: completed \? "" : realEntryHref/);
});

test("final reconciliation keeps a real Entry.aspx row pending even if generic success CSS exists", () => {
  const reconciler = read("../extension/reconciliation-v3.js");
  assert.match(reconciler, /const completed = syntheticCompleted \|\| \(!realEntryHref && \(completedHint \|\| completionClue/);
  assert.match(reconciler, /add\(root, syntheticCompletedHref\(link\.href\), link\.href\)/);
});

test("review and popup treat synthetic completed rows as completed and never submit them", () => {
  const review = read("../extension/review.js");
  const popup = read("../extension/popup.js");
  assert.match(review, /function portalCompleted\(item\)/);
  assert.match(review, /mah_completed=1/);
  assert.match(review, /latestScan\.items\.filter\(\(item\) => !portalCompleted\(item\)/);
  assert.match(popup, /function portalCompleted\(item\)/);
  assert.match(popup, /items\.filter\(portalCompleted\)/);
});

test("settings test flow does not stop after the preliminary SCAN_ALL result", () => {
  const options = read("../extension/options.js");
  const scanIndex = options.indexOf('type: "SCAN_ALL"');
  const reconciliationIndex = options.indexOf('type: "RUN_FINAL_RECONCILIATION"');
  assert.ok(scanIndex >= 0, "settings page must run the preliminary scan");
  assert.ok(reconciliationIndex > scanIndex, "settings page must run final reconciliation after the preliminary scan");
});
