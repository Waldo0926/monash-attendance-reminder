import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fallback = fs.readFileSync(path.join(root, "extension", "moodle-fallback.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension", "manifest.json"), "utf8"));

test("Moodle fallback does not truncate course candidates before late-listed target units", () => {
  assert.doesNotMatch(fallback, /candidates\.slice\(\s*0\s*,\s*16\s*\)/);
  assert.match(fallback, /courseCodesInText\(clue, wanted\)/);
  assert.match(fallback, /hinted\.length === 1 \? hinted\[0\] : identifyCourse/);
});

test("Moodle fallback can inspect both My units and Dashboard when target cards are missing", () => {
  assert.match(fallback, /https:\/\/learning\.monash\.edu\/my\/courses\.php/);
  assert.match(fallback, /https:\/\/learning\.monash\.edu\/my\//);
  assert.match(fallback, /mergeCourseCandidates/);
});

test("extension version includes non-invasive completed-row reconciliation", () => {
  assert.equal(manifest.version, "1.3.40");
});
