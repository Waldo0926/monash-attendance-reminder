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

test("SCAN_ALL chains final reconciliation in the background instead of relying on a caller's follow-up message", () => {
  // A UI (popup.js in particular) sending SCAN_ALL and then a separate RUN_FINAL_RECONCILIATION
  // message once it resolves depends on that UI's own script surviving both round trips. A
  // popup's script is destroyed the instant the popup closes, so a user clicking away while
  // the scan was still running silently dropped the second message before it was ever sent -
  // the scan itself still finished and notified normally, making a real bug look like nothing
  // was wrong. The background must do both steps inside the one SCAN_ALL handler so no caller
  // needs to stay alive for a second message.
  const serviceWorker = read("../extension/service-worker.js");
  assert.match(serviceWorker, /import\s*\{\s*reconcileAndStore\s*\}\s*from\s*"\.\/reconciliation-v3\.js"/);
  const scanAllHandler = serviceWorker.slice(serviceWorker.indexOf('message.type === "SCAN_ALL"'));
  assert.match(scanAllHandler.slice(0, 1500), /await reconcileAndStore\(result\)/);

  for (const file of ["../extension/popup.js", "../extension/review.js", "../extension/options.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /type:\s*"RUN_FINAL_RECONCILIATION"/, `${file} must not depend on a second message for reconciliation`);
  }
});
