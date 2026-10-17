import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// v1.3.50 said "已处理 2/2" while Attendance still showed FIT3162 Studio 01 as not signed.
// A click is not a submission, only the Attendance row counts.
test("a submit only counts once Attendance shows the row as completed", () => {
  const worker = read("../extension/service-worker.js");
  const submitOne = worker.slice(worker.indexOf("async function submitOne("), worker.indexOf("chrome.runtime.onInstalled"));
  assert.match(submitOne, /await checkAttendanceSession\(/);
  assert.match(submitOne, /if \(check\.checked && check\.completed\) \{\s*return \{ ok: true, verified: true/);
  assert.doesNotMatch(submitOne.slice(submitOne.indexOf("const reason")), /ok: true/);
});

test("only verified successes are skipped on a later submit", () => {
  const worker = read("../extension/service-worker.js");
  assert.match(worker, /filter\(\(item\) => item\.ok && item\.verified\)/);
});

test("the check opens a fresh Attendance tab instead of reusing a stale one", () => {
  const reconciliation = read("../extension/reconciliation-v3.js");
  const check = reconciliation.slice(reconciliation.indexOf("export async function checkAttendanceSession("));
  assert.match(check, /runOnPage\(url, extractAttendanceRows, \[key\], 3, \{ reuse: false \}\)/);
  assert.match(reconciliation, /const tabs = reuse \? await chrome\.tabs\.query\(\{\}\) : \[\];/);
});

test("the button search skips navigation links and answers before clicking", () => {
  const content = read("../extension/content.js");
  const find = content.slice(content.indexOf("function findSubmitButton("), content.indexOf("function describeNode("));
  assert.match(find, /logout\|log out\|cancel\|back\|home/);
  assert.match(find, /\^javascript:/);
  assert.doesNotMatch(find, /querySelectorAll\("button,input\[type=submit\],input\[type=button\],a"\)/);
  const fill = content.slice(content.indexOf('message.type === "FILL_ATTENDANCE_CODE"'));
  assert.ok(fill.indexOf("sendResponse({ ok: true") < fill.indexOf("button.click()"));
});

test("the confirm page reports each class on its own line", () => {
  const review = read("../extension/review.js");
  assert.match(review, /outcome\?\.ok && outcome\?\.verified/);
  assert.match(review, /Attendance 核对后已签上/);
  assert.doesNotMatch(review, /已处理 \$\{successes\}/);
});
