import test from "node:test";
import assert from "node:assert/strict";
import { ATTENDANCE_URL, DEFAULT_SETTINGS, attendanceDate, detectWeekOneMonday, edThreadLinks, extractCandidates, findCourseLinks, hasUsableConfig, matchCodesToAttendance, moodleWeekLinks, normaliseTimeToken, parseDateKey, pickWeekNumbers, recentAttendanceDates, teachingWeek } from "../extension/shared.js";

test("ships with a blank per-user course configuration", () => {
  assert.deepEqual(DEFAULT_SETTINGS.courses, []);
  assert.equal(DEFAULT_SETTINGS.weekOneMonday, "");
  assert.equal(DEFAULT_SETTINGS.autoDiscover, true);
  assert.equal(teachingWeek(DEFAULT_SETTINGS, new Date("2026-09-13T12:00:00+08:00")), null);
});

test("builds a seven-day Attendance discovery window without a timetable", () => {
  const dates = recentAttendanceDates(new Date("2026-09-13T12:00:00+08:00"), 7);
  assert.equal(dates[0].iso, "2026-09-07");
  assert.equal(dates[6].iso, "2026-09-13");
});

test("matches a Gmail code to a class discovered from Attendance", () => {
  const items = [{ course: "ENG2005", session: "Workshop 12", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" } }];
  const [result] = matchCodesToAttendance("Week 7 Attendance Codes\nENG2005 Workshop 12 Tuesday 8 Sep 12:00PM S7M3X", items);
  assert.equal(result.code, "S7M3X");
});

test("rejects a candidate that would apply identically to two unrelated classes", () => {
  const items = [
    { course: "FIT2102", session: "Workshop 01" },
    { course: "FIT2109", session: "Tutorial 05" }
  ];
  // "1CRLF" sits close enough to both course mentions to score for either one, which is
  // exactly the shape of a false positive picked up from an unrelated page (an ID, a build
  // number, anything 5 characters long) rather than a real per-session signed code.
  const text = "FIT2102 Workshop 01\n1CRLF\nFIT2109 Tutorial 05";
  const [first, second] = matchCodesToAttendance(text, items);
  assert.equal(first.code, "");
  assert.equal(first.confidence, "missing");
  assert.equal(second.code, "");
  assert.equal(second.confidence, "missing");
});

test("keeps a code that only matches a single class", () => {
  const items = [
    { course: "FIT2102", session: "Workshop 01" },
    { course: "FIT2109", session: "Tutorial 05" }
  ];
  // Non-blank filler lines, since blank lines get filtered out before the context
  // window is measured and so can't actually separate two matches on their own.
  const filler = Array.from({ length: 8 }, (_, i) => `unrelated line ${i}`).join("\n");
  const text = `FIT2102 Workshop 01 Tuesday ABC1D\n${filler}\nFIT2109 Tutorial 05 Friday XY9ZQ`;
  const [first, second] = matchCodesToAttendance(text, items);
  assert.equal(first.code, "ABC1D");
  assert.equal(second.code, "XY9ZQ");
});

test("normalises 12-hour time tokens regardless of spacing or case", () => {
  assert.equal(normaliseTimeToken("4:00 pm"), "16:00");
  assert.equal(normaliseTimeToken("4:00PM"), "16:00");
  assert.equal(normaliseTimeToken("4:00 p.m."), "16:00");
  assert.equal(normaliseTimeToken("12:00 am"), "00:00");
  assert.equal(normaliseTimeToken("not a time"), null);
});

test("matches the real Monash 'Type Date Number Time Code' announcement layout by time, not a contiguous label", () => {
  // Taken from a real Ed announcement: the session number sits between the date and the
  // time, so "Workshop 02" never appears together as one phrase anywhere in the posting.
  const text = [
    "Workshops:",
    "Workshop Monday, 7 Sep 01 6:00PM TREW9",
    "Workshop Wednesday, 9 Sep 02 4:00PM SQP3R",
    "Tutorials:",
    "Tutorial Thursday, 10 Sep 01 10:00AM 8BPYR",
    "Tutorial Friday, 11 Sep 05 2:00PM ZS9CR"
  ].join("\n");
  const items = [
    { course: "FIT2109", session: "Workshop 02", time: "4:00 pm" },
    { course: "FIT2109", session: "Tutorial 05", time: "2:00 pm" }
  ];
  const [workshop02, tutorial05] = matchCodesToAttendance(text, items);
  assert.equal(workshop02.code, "SQP3R");
  assert.equal(tutorial05.code, "ZS9CR");
});

test("prefers this week's row over an older week with the same slot, and rejects the old one alone", () => {
  // FIT3162's Moodle page keeps every week's codes; Studio 01 is Thursday 5:00PM every week.
  const item = { course: "FIT3162", session: "Studio 01", time: "5:00 pm", attendanceDate: { iso: "2026-09-10", key: "10_Sep_26" } };
  const both = "Studio Thursday, 27 Aug 01 5:00PM 7KZY2\nStudio Thursday, 10 Sep 01 5:00PM NEW7K";
  assert.equal(matchCodesToAttendance(both, [item])[0].code, "NEW7K");
  const oldOnly = "Studio Thursday, 27 Aug 01 5:00PM 7KZY2";
  assert.equal(matchCodesToAttendance(oldOnly, [item])[0].code, "");
});

test("uses the session number to split two sessions sharing a date and time", () => {
  const text = "Workshop Wednesday, 9 Sep 02 4:00PM SQP3R\nWorkshop Wednesday, 9 Sep 03_OnlineRealTime 4:00PM QQKZQ";
  const items = [
    { course: "FIT2109", session: "Workshop 02", time: "4:00 pm", attendanceDate: { iso: "2026-09-09", key: "9_Sep_26" } },
    { course: "FIT2109", session: "Workshop 03", time: "4:00 pm", attendanceDate: { iso: "2026-09-09", key: "9_Sep_26" } }
  ];
  const [w02, w03] = matchCodesToAttendance(text, items);
  assert.equal(w02.code, "SQP3R");
  // "03_OnlineRealTime" has no word boundary after the 3, so Workshop 03 can't claim it by
  // number; the two rows tie and the duplicate guard has to refuse rather than guess.
  assert.notEqual(w03.code, "SQP3R");
});

test("reads the Week 1 Monday off a Moodle unit page", () => {
  const text = "Unit dashboard\nWeek 1\nIntroduction to Unit and transitioning from FIT3161-63\nMon 27 July 26 - Sun 2 Aug 26\nLearning Outcomes";
  assert.equal(detectWeekOneMonday(text), "2026-07-27");
  assert.equal(detectWeekOneMonday("Week 10 Consultation with Supervisor"), "");
});

test("finds unit links by course code and normalises them to the page worth opening", () => {
  const links = [
    { label: "FIT2109 S2 2026 Malaysia", href: "https://edstem.org/au/courses/39026/lessons" },
    { label: "FIT2109 S2 2026 Malaysia", href: "https://edstem.org/au/courses/39026/discussion" },
    { label: "Some other unit", href: "https://edstem.org/au/courses/11111/discussion" },
    { label: "FIT3162/FIT3164 MUM S2 2026", href: "https://learning.monash.edu/course/view.php?id=44555#section-0" }
  ];
  const ed = findCourseLinks(links, ["FIT2109", "FIT3162"], {
    hrefPattern: /\/courses\/\d+/,
    normaliseHref: (href) => href.replace(/(\/courses\/\d+).*$/, "$1/discussion")
  });
  assert.deepEqual(ed, [{ href: "https://edstem.org/au/courses/39026/discussion", courses: ["fit2109"] }]);
  const moodle = findCourseLinks(links, ["FIT2109", "FIT3162"], { hrefPattern: /\/course\/view\.php\?id=\d+/ });
  assert.deepEqual(moodle, [{ href: "https://learning.monash.edu/course/view.php?id=44555", courses: ["fit3162"] }]);
});

test("picks Ed threads worth opening by title, attendance first", () => {
  const links = [
    { label: "Mock Test is now released! General Abdul Rafae STAFF", href: "https://edstem.org/au/courses/39026/discussion/3573001" },
    { label: "Week 7 General Adrian Kristanto STAFF", href: "https://edstem.org/au/courses/36340/discussion/3573002" },
    { label: "Announcement 2 of 2 - Attendance code (International Students Only) - Week 7", href: "https://edstem.org/au/courses/39026/discussion/3573676" },
    { label: "FIT2109 S2 2026 Malaysia", href: "https://edstem.org/au/courses/39026/discussion" }
  ];
  assert.deepEqual(edThreadLinks(links), [
    "https://edstem.org/au/courses/39026/discussion/3573676",
    "https://edstem.org/au/courses/36340/discussion/3573002"
  ]);
});

test("maps Moodle week links to section pages and narrows them to the current week", () => {
  const links = [
    { label: "Week 1 - Introduction to Unit", href: "https://learning.monash.edu/course/view.php?id=44555#section-12" },
    { label: "Week 5 Consultation with Supervisor", href: "https://learning.monash.edu/course/view.php?id=44555&section=24" },
    { label: "Week 6 Presentation Sessions", href: "https://learning.monash.edu/course/section.php?id=901" },
    { label: "Week 7 Presentation sessions", href: "https://learning.monash.edu/course/view.php?id=44555&section=30" },
    { label: "Week 8 Consultation with Supervisor", href: "https://learning.monash.edu/course/view.php?id=44555&section=33" },
    { label: "Week 12", href: "https://learning.monash.edu/course/view.php?id=44555&section=45" }
  ];
  const weeks = moodleWeekLinks(links);
  assert.equal(weeks.has(1), false);
  assert.equal(weeks.get(7), "https://learning.monash.edu/course/view.php?id=44555&section=30");
  assert.deepEqual(pickWeekNumbers(weeks.keys(), [7]), [8, 7, 6]);
  assert.deepEqual(pickWeekNumbers(weeks.keys(), []), [12, 8, 7, 6, 5]);
});

test("calculates Week 1 and Week 7 from the configured Monday", () => {
  const settings = { weekOneMonday: "2026-07-27" };
  assert.equal(teachingWeek(settings, new Date("2026-07-27T12:00:00+08:00")), 1);
  assert.equal(teachingWeek(settings, new Date("2026-09-13T12:00:00+08:00")), 7);
});

test("builds the Attendance date key from teaching week and weekday", () => {
  const settings = { weekOneMonday: "2026-07-27" };
  assert.deepEqual(attendanceDate(settings, 7, "Wednesday"), { iso: "2026-09-09", key: "9_Sep_26" });
});

test("matches a code to the correct class using nearby context", () => {
  const course = {
    id: "fit2102",
    name: "FIT2102",
    url: "https://example.test",
    category: "Malaysia",
    sessions: [
      { id: "workshop01", label: "Workshop 01", day: "Tuesday", time: "16:00", aliases: ["Workshop 1"] },
      { id: "tutorial09", label: "Tutorial 09", day: "Wednesday", time: "14:00", aliases: ["Tutorial 9"] }
    ]
  };
  const text = `FIT2102 Malaysia Week 7\nWorkshop 01 Tuesday 16:00 ABC1D\nTutorial 09 Wednesday 14:00 XY9ZQ`;
  const results = extractCandidates(text, course, 7);
  assert.equal(results[0].code, "ABC1D");
  assert.equal(results[1].code, "XY9ZQ");
  assert.equal(results[0].confidence, "high");
});

test("treats the default auto-discovery setup as usable without a Week 1 date", () => {
  const settings = { ...DEFAULT_SETTINGS, reminder: { weekday: 0, hour: 19, minute: 0 }, backup: { enabled: false } };
  assert.equal(settings.weekOneMonday, "");
  assert.equal(hasUsableConfig(settings), true);
});

test("requires a Week 1 date and a real course only once auto-discovery is turned off", () => {
  const base = { autoDiscover: false, reminder: { weekday: 0, hour: 19, minute: 0 }, backup: { enabled: false } };
  assert.equal(hasUsableConfig({ ...base, weekOneMonday: "" }), false);
  assert.equal(hasUsableConfig({ ...base, weekOneMonday: "2026-07-27" }), false);
  const course = { enabled: true, name: "FIT2102", url: "https://learning.monash.edu/x", sessions: [{ id: "s1" }] };
  assert.equal(hasUsableConfig({ ...base, weekOneMonday: "2026-07-27", courses: [course] }), true);
});

test("builds the Units page beside Default.aspx without duplicating /student/", () => {
  assert.equal(new URL("Units.aspx", ATTENDANCE_URL).pathname, "/student/Units.aspx");
});

test("parses the real Attendance date key format seen on Entry.aspx links", () => {
  assert.deepEqual(parseDateKey("8_Sep_26"), { iso: "2026-09-08", key: "8_Sep_26" });
  assert.deepEqual(parseDateKey("11_Sep_26"), { iso: "2026-09-11", key: "11_Sep_26" });
  assert.equal(parseDateKey("not-a-date"), null);
  assert.equal(parseDateKey(""), null);
});

test("does not accept a code without a matching class label", () => {
  const course = {
    id: "fit3162",
    name: "FIT3162",
    url: "https://example.test",
    sessions: [{ id: "studio01", label: "Studio 01", day: "Thursday", time: "17:00", aliases: ["Studio 1"] }]
  };
  const [result] = extractCandidates("Week 7 general notice X1Y2Z", course, 7);
  assert.equal(result.code, "");
  assert.equal(result.confidence, "missing");
});
