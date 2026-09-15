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

test("review and popup treat synthetic completed rows as completed and never submit them", () => {
  const review = read("../extension/review.js");
  const popup = read("../extension/popup.js");
  assert.match(review, /function portalCompleted\(item\)/);
  assert.match(review, /mah_completed=1/);
  assert.match(review, /latestScan\.items\.filter\(\(item\) => !portalCompleted\(item\)/);
  assert.match(popup, /function portalCompleted\(item\)/);
  assert.match(popup, /items\.filter\(portalCompleted\)/);
});
