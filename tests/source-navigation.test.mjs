import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const extension = new URL("../extension/", import.meta.url);
const text = (name) => readFile(new URL(name, extension), "utf8");

test("keeps the automatic source order Gmail -> Ed -> Moodle", async () => {
  const worker = await text("service-worker.js");
  const gmail = worker.indexOf("const gmailTabs = await chrome.tabs.query");
  const ed = worker.indexOf("const edDashboard = await scan");
  const moodle = worker.indexOf("const myUnits = await scan");
  assert.ok(gmail >= 0 && ed > gmail && moodle > ed);
});

test("best-effort switches Gmail search from Most relevant to Most recent", async () => {
  const source = await text("content.js");
  assert.match(source, /preferGmailMostRecent/);
  assert.match(source, /showing\\s\+most\\s\+relevant/);
  assert.match(source, /most\\s\+recent/);
  assert.match(source, /menuitemradio/);
});

test("Moodle weekly pages follow same-origin attendance activities one level deeper", async () => {
  const source = await text("content.js");
  assert.match(source, /moodleAttendanceLinkCandidates/);
  assert.match(source, /url\.origin !== location\.origin/);
  assert.match(source, /\\\/mod\\\//);
  assert.match(source, /attendance\\s\+codes/);
  assert.match(source, /fetchMoodleAttendancePages/);
  assert.match(source, /credentials: "include"/);
  assert.match(source, /readableDetachedDocument/);
  assert.match(source, /cells\.join\(" \\| "\)/);
  assert.match(source, /linkedMoodleAttendanceText/);
});

test("Moodle fallback opens target My units cards without truncating late-listed units", async () => {
  const source = await text("moodle-fallback.js");
  assert.match(source, /moodleCourseCandidates/);
  assert.match(source, /course\/view\.php/);
  assert.match(source, /identifyCourse/);
  assert.match(source, /courseCodesInText/);
  assert.doesNotMatch(source, /candidates\.slice\(0, 16\)/);
  assert.match(source, /bMatch - aMatch/);
});

test("Moodle fallback follows the attendance activity and rematches exact Attendance rows", async () => {
  const source = await text("moodle-fallback.js");
  assert.match(source, /attendanceActivityCandidates/);
  assert.match(source, /\\\/mod\\\/\[\^\/\]\+\\\/view/);
  assert.match(source, /international\\s\+student/);
  assert.match(source, /scanAttendanceActivities/);
  assert.match(source, /matchCodesToAttendance/);
});

test("background wrapper keeps the normal scanner, Moodle fallback and final reconciliation active", async () => {
  const wrapper = await text("service-worker-wrapper.js");
  assert.match(wrapper, /moodle-fallback\.js/);
  assert.match(wrapper, /service-worker\.js/);
  assert.match(wrapper, /reconciliation\.js/);
});

test("final reconciliation reads completed Attendance rows and exact Moodle table cells", async () => {
  const source = await text("reconciliation.js");
  const core = await text("reconciliation-core.js");
  const review = await text("review.js");
  assert.match(source, /extractAttendancePortalRows/);
  assert.match(source, /extractMoodleTableRows/);
  assert.match(source, /matchStructuredAttendanceRows/);
  assert.match(core, /mergePortalAttendance/);
  assert.match(review, /status\.key === "completed"/);
  assert.match(review, /\.pick:not\(:disabled\):checked/);
});
