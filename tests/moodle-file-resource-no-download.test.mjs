import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Moodle's "Code for International Students week N" is an uploaded .docx (mod/resource). It sits
// right under an "Attendance Codes" heading, so its link looked attendance-related and the
// scanner opened it in a background tab. Moodle answers with the file itself, so Chrome showed
// a Save dialog on every scan. File resources must never be followed.
const read = (name) => readFileSync(new URL(`../extension/${name}`, import.meta.url), "utf8");

test("reconciliation-v3 skips mod/resource attendance links but keeps forum/page/folder", () => {
  const source = read("reconciliation-v3.js");
  assert.ok(source.includes("/\\/mod\\/(?!resource\\/)[^/]+\\/view\\.php/i"), "attendance link filter must exclude mod/resource");
  const re = /\/mod\/(?!resource\/)[^/]+\/view\.php/i;
  assert.equal(re.test("/mod/resource/view.php"), false);
  assert.equal(re.test("/mod/forum/view.php"), true);
  assert.equal(re.test("/mod/page/view.php"), true);
  assert.equal(re.test("/mod/folder/view.php"), true);
});

test("the Moodle content-script fetch path also skips mod/resource", () => {
  assert.ok(read("content.js").includes("/\\/mod\\/resource\\//i"), "content.js must skip mod/resource");
});
