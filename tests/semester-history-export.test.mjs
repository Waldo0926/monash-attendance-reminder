import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Attendance only accepts a submission up to about a week back, so a student who forgot to
// fill one in earlier in the semester has no way to fix it there. This feature never tries to
// submit anything old - it rebuilds the whole semester's attendance/code picture (reusing the
// same discovery pipeline as the weekly scan, just over a wider date range restored from the
// code-evidence cache first) so the student has something to download and act on elsewhere.
test("EXPORT_SEMESTER_HISTORY reuses the weekly-scan discovery pipeline over the full semester", () => {
  const serviceWorker = read("../extension/service-worker.js");
  assert.match(serviceWorker, /import\s*\{[^}]*\bEVIDENCE_CACHE_KEY\b[^}]*\breadAttendancePortal\b[^}]*\}\s*from\s*"\.\/reconciliation-v3\.js"/);
  assert.match(serviceWorker, /async function buildSemesterHistory\(settings\)/);
  assert.match(serviceWorker, /message\.type === "EXPORT_SEMESTER_HISTORY"/);

  const fn = serviceWorker.slice(serviceWorker.indexOf("async function buildSemesterHistory"), serviceWorker.indexOf("async function submitOne"));
  assert.match(fn.slice(0, 1500), /if \(!settings\?\.weekOneMonday\)/, "must require Week 1 to be configured before computing a range");
  assert.match(fn.slice(0, 1500), /await readAttendancePortal\(lookbackDays\)/, "must reuse the same DOM-based Attendance reader as the weekly scan");
  assert.match(fn, /restoreCodeEvidence\(items, stored\[EVIDENCE_CACHE_KEY\] \|\| \{\}\)/, "must restore already-known codes from the cache before searching sources again");
  assert.match(fn, /mergeSourceScanCodes\(items, sourceScans\)/, "must reuse the same matching logic as the weekly scan rather than a separate implementation");
});

test("the semester export shares mergeSourceScanCodes with the normal weekly scan instead of duplicating the matching loop", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const occurrences = serviceWorker.match(/mergeSourceScanCodes\(/g) || [];
  assert.ok(occurrences.length >= 2, "both scanAll() and buildSemesterHistory() must call the shared helper");
  assert.match(serviceWorker, /function mergeSourceScanCodes\(items, sourceScans\)/);
});

test("options.js exports the semester history as a downloadable CSV, not a raw JSON dump", () => {
  const options = read("../extension/options.js");
  assert.match(options, /type: "EXPORT_SEMESTER_HISTORY"/);
  assert.match(options, /function downloadHistoryCsv\(items\)/);
  assert.match(options, /String\.fromCharCode\(0xfeff\)/, "must include a UTF-8 BOM so Excel renders the Chinese headers correctly");
  assert.match(options, /if \(!settings\.weekOneMonday\)/, "must tell the student to set Week 1 first instead of silently failing");

  const optionsHtml = read("../extension/options.html");
  assert.match(optionsHtml, /id="exportHistory"/);
  assert.match(optionsHtml, /id="historyStatus"/);
});
