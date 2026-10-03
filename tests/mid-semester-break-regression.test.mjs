import assert from "node:assert/strict";
import test from "node:test";
import { attendanceDate, detectWeekAnchors, edThreadLinks, mergeWeekAnchors, teachingWeek } from "../extension/shared.js";

// S2 2026 Malaysia: Week 1 starts Mon 27 Jul, the mid-semester break is Mon 21 Sep, and Mon
// 28 Sep is labelled "Week 9" everywhere. Counting calendar weeks made it Week 10, so the
// FIT2102 "Week 9 Attendance Code" Ed thread was never opened.
const weekOneMonday = "2026-07-27";
const moodleHome = "Section outline · Week 9 · Consultation with Supervisor · Mon 28 Sept 26 - Sun 4 Oct 26 · FIT3162 Attendance Codes";
const moodleWeek10 = "Section outline\nWeek 10\nConsultation with Supervisor\nMon 5 Oct 26 - Sun 11 Oct 26\nYour Learning Journey";
const moodleWeek8 = "Section outline\nWeek 8\nConsultation with Supervisor\nMon 14 Sept 26 - Sun 20 Sept 26\nThis week";

test("Moodle section headers yield week anchors", () => {
  assert.deepEqual(detectWeekAnchors(moodleHome), [{ week: 9, monday: "2026-09-28" }]);
  assert.deepEqual(detectWeekAnchors(moodleWeek10), [{ week: 10, monday: "2026-10-05" }]);
  // A date that isn't a Monday range start is not an anchor.
  assert.deepEqual(detectWeekAnchors("Week 9 quiz due Fri 2 Oct 26"), []);
});

test("only anchors after a break are kept, and only for this semester", () => {
  const settings = { weekOneMonday };
  assert.equal(mergeWeekAnchors(settings, detectWeekAnchors(moodleWeek8)), null);
  assert.deepEqual(mergeWeekAnchors(settings, detectWeekAnchors(moodleHome)), [{ week: 9, monday: "2026-09-28" }]);
  assert.equal(mergeWeekAnchors(settings, [{ week: 9, monday: "2026-03-30" }]), null);
  const learned = { weekOneMonday, weekAnchors: [{ week: 9, monday: "2026-09-28" }] };
  assert.equal(mergeWeekAnchors(learned, detectWeekAnchors(moodleHome)), null);
});

test("teaching weeks skip the break once an anchor is known", () => {
  const plain = { weekOneMonday };
  const learned = { weekOneMonday, weekAnchors: [{ week: 9, monday: "2026-09-28" }] };
  const tue29Sep = new Date(2026, 8, 29, 12);
  assert.equal(teachingWeek(plain, tue29Sep), 10);
  assert.equal(teachingWeek(learned, tue29Sep), 9);
  assert.equal(teachingWeek(learned, new Date(2026, 8, 16, 12)), 8);
  assert.equal(teachingWeek(learned, new Date(2026, 9, 7, 12)), 10);
  assert.equal(attendanceDate(learned, 9, "Tuesday").iso, "2026-09-29");
  assert.equal(attendanceDate(learned, 8, "Wednesday").iso, "2026-09-16");
});

test("Ed falls back to the previous week's thread when the computed week has none", () => {
  const links = [
    { href: "https://edstem.org/au/courses/36340/discussion/3615735", label: "Week 9 Attendance Code" },
    { href: "https://edstem.org/au/courses/36340/discussion/3580000", label: "Week 8 Attendance Codes" }
  ];
  assert.deepEqual(edThreadLinks(links, [10]), ["https://edstem.org/au/courses/36340/discussion/3615735"]);
  assert.deepEqual(edThreadLinks(links, [9]), ["https://edstem.org/au/courses/36340/discussion/3615735"]);
});
