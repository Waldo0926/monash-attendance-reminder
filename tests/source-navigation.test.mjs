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
