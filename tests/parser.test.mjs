import test from "node:test";
import assert from "node:assert/strict";
import { ATTENDANCE_URL, DEFAULT_SETTINGS, attendanceDate, courseCodesInText, detectWeekOneMonday, edThreadLinks, extractCandidates, findCourseLinks, hasUsableConfig, inferWeekNumbersFromText, matchCodesToAttendance, moodleWeekLinks, normaliseTimeToken, parseDateKey, pickWeekNumbers, recentAttendanceDates, scopedAttendanceItems, teachingWeek } from "../extension/shared.js";

test("ships with a blank per-user course configuration", () => {
  assert.deepEqual(DEFAULT_SETTINGS.courses, []);
  assert.equal(DEFAULT_SETTINGS.weekOneMonday, "");
  assert.equal(DEFAULT_SETTINGS.autoDiscover, true);
  assert.equal(teachingWeek(DEFAULT_SETTINGS, new Date("2026-09-13T12:00:00+08:00")), null);
});

test("builds an inclusive seven-day-old Attendance discovery window without a timetable", () => {
  const dates = recentAttendanceDates(new Date("2026-09-13T12:00:00+08:00"), 7);
  assert.equal(dates[0].iso, "2026-09-06");
  assert.equal(dates.at(-1).iso, "2026-09-13");
  assert.equal(dates.length, 8);
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

test("prefers the newest attendance-code week and limits expensive OCR pages", () => {
  const links = [
    { label: "Week 5 Attendance Codes", href: "https://edstem.org/au/courses/1/discussion/5" },
    { label: "Week 7 Attendance Codes", href: "https://edstem.org/au/courses/1/discussion/7" },
    { label: "Week 6 Attendance Codes", href: "https://edstem.org/au/courses/1/discussion/6" }
  ];
  assert.deepEqual(edThreadLinks(links), [
    "https://edstem.org/au/courses/1/discussion/7",
    "https://edstem.org/au/courses/1/discussion/6"
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


test("finds Ed course URLs when the FIT code is in nearby link context", () => {
  const links = [
    { label: "Open", context: "FIT2102 Functional Programming", href: "https://edstem.org/au/courses/36340/lessons" },
    { label: "Open", context: "Other course", href: "https://edstem.org/au/courses/99999/lessons" }
  ];
  const found = findCourseLinks(links, ["FIT2102"], {
    hrefPattern: /\/courses\/\d+/,
    normaliseHref: (href) => href.replace(/(\/courses\/\d+).*$/, "$1/discussion")
  });
  assert.deepEqual(found, [{ href: "https://edstem.org/au/courses/36340/discussion", courses: ["fit2102"] }]);
});

test("finds Ed attendance threads when the title is in nearby link context", () => {
  const links = [
    { label: "#565", context: "Week 7 International Students Attendance Codes #565", href: "https://edstem.org/au/courses/36340/discussion/3574203" }
  ];
  assert.deepEqual(edThreadLinks(links), ["https://edstem.org/au/courses/36340/discussion/3574203"]);
});

test("accepts five-letter attendance codes with no digits", () => {
  const items = [
    { course: "FIT2102", session: "Tutorial 09", time: "2:00 pm", attendanceDate: { iso: "2026-09-09", key: "9_Sep_26" } }
  ];
  const text = "Tutorial Wednesday, 9 Sep 09 2:00PM JKAHX";
  const [result] = matchCodesToAttendance(text, items);
  assert.equal(result.code, "JKAHX");
  assert.equal(result.confidence, "high");
});

test("matches the real FIT2102 Week 7 workshop and tutorial rows", () => {
  const items = [
    { course: "FIT2102", session: "Workshop 01", time: "4:00 pm", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" } },
    { course: "FIT2102", session: "Tutorial 09", time: "2:00 pm", attendanceDate: { iso: "2026-09-09", key: "9_Sep_26" } }
  ];
  const text = [
    "Workshop Tuesday, 8 Sep 01 4:00PM JY4H6",
    "Tutorial Wednesday, 9 Sep 01 8:00AM GTXUE",
    "Tutorial Wednesday, 9 Sep 02 10:00AM ND77R",
    "Tutorial Wednesday, 9 Sep 09 2:00PM JKAHX"
  ].join("\n");
  const [workshop, tutorial] = matchCodesToAttendance(text, items);
  assert.equal(workshop.code, "JY4H6");
  assert.equal(tutorial.code, "JKAHX");
});


test("matches a FIT2102 workshop row when OCR splits the visual row across lines", () => {
  const items = [
    { course: "FIT2102", session: "Workshop 01", time: "4:00 pm", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" } },
    { course: "FIT2102", session: "Tutorial 09", time: "2:00 pm", attendanceDate: { iso: "2026-09-09", key: "9_Sep_26" } }
  ];
  const text = [
    "Week 7 International Students Attendance Codes",
    "Workshop",
    "Tuesday, 8 Sep",
    "01",
    "4:00PM",
    "JY4H6",
    "Tutorial Wednesday, 9 Sep 09 2:00PM JKAHX"
  ].join("\n");
  const [workshop, tutorial] = matchCodesToAttendance(text, items);
  assert.equal(workshop.code, "JY4H6");
  assert.equal(workshop.confidence, "high");
  assert.equal(tutorial.code, "JKAHX");
});

test("can infer a Moodle teaching week from a date range around its Week heading", () => {
  const text = "Week 6 31 August - 6 September Week 7 7 September - 13 September Week 8 14 September - 20 September";
  const dates = [{ key: "8_Sep_26" }, { key: "9_Sep_26" }];
  assert.deepEqual(inferWeekNumbersFromText(text, dates), [7]);
});

test("Moodle fallback never scans an entire semester", () => {
  assert.deepEqual(pickWeekNumbers([1,2,3,4,5,6,7,8,9,10,11,12], []), [12,11,10,9,8]);
});


test("recovers a five-character code when OCR inserts whitespace inside it", () => {
  const items = [
    { course: "FIT2102", session: "Workshop 01", time: "4:00 pm", attendanceDate: { iso: "2026-09-08", key: "8_Sep_26" } }
  ];
  const text = "Workshop Tuesday, 8 Sep 01 4:00PM JY4 H6";
  const [result] = matchCodesToAttendance(text, items);
  assert.equal(result.code, "JY4H6");
  assert.equal(result.confidence, "high");
});


test("seven-day lookback includes the activity exactly seven days ago", () => {
  // 2026-09-14 is a Monday, so the window also extends forward through that week's Sunday
  // (2026-09-20) - Attendance can list a day's sessions before that day happens, and a class
  // later in the same week must not look like it vanished just because "now" hasn't reached it.
  const dates = recentAttendanceDates(new Date(2026, 8, 14, 20, 0, 0), 7);
  assert.equal(dates[0].iso, "2026-09-07");
  assert.equal(dates.at(-1).iso, "2026-09-20");
  assert.equal(dates.length, 14);
});

test("the lookback window extends forward through the end of the current week", () => {
  // 2026-09-16 is a Wednesday: Thursday and Friday of the same week are still ahead of today
  // but must still be in the window so their (possibly already-published) rows get read.
  const dates = recentAttendanceDates(new Date(2026, 8, 16, 12, 0, 0), 7);
  const isos = dates.map((date) => date.iso);
  assert.ok(isos.includes("2026-09-17"), "Thursday of the current week must be included");
  assert.ok(isos.includes("2026-09-20"), "Sunday of the current week must be included");
  assert.ok(!isos.includes("2026-09-21"), "the following Monday must not be included");
});

test("the lookback window does not extend forward when today is already Sunday", () => {
  const dates = recentAttendanceDates(new Date("2026-09-13T12:00:00+08:00"), 7);
  assert.equal(dates.at(-1).iso, "2026-09-13");
});

test("matches bare Applied activity labels as a session type", () => {
  const item = { course: "FIT2102", session: "Applied 01", time: "8:00 am", attendanceDate: { iso: "2026-09-07", key: "7_Sep_26" } };
  const text = "Applied Monday, 7 Sep 01 8:00AM AP1CD";
  const [matched] = matchCodesToAttendance(text, [item]);
  assert.equal(matched.code, "AP1CD");
});


test("matches a workshop row when Ed flattens several visual rows onto one physical line", () => {
  const text = "Passcode: 3PfFh8!t · Workshop Monday, 7 Sep 01 6:00PM TREW9 · Workshop Wednesday, 9 Sep 02 4:00PM SQP3R · Workshop Wednesday, 9 Sep 03_OnlineRealTime 4:00PM QQKZQ";
  const item = { course: "FIT2109", session: "Workshop 02", time: "4:00 pm", attendanceDate: { iso: "2026-09-09", key: "9_Sep_26" } };
  const [matched] = matchCodesToAttendance(text, [item]);
  assert.equal(matched.code, "SQP3R");
  assert.equal(matched.confidence, "high");
});

test("keeps exact tutorial groups separated even when Ed flattens them onto one line", () => {
  const text = "Tutorial Friday, 11 Sep 05 2:00PM ZS9CR · Tutorial Friday, 11 Sep 06 2:00PM X9JJB";
  const items = [
    { course: "FIT2109", session: "Tutorial 05", time: "2:00 pm", attendanceDate: { iso: "2026-09-11", key: "11_Sep_26" } },
    { course: "FIT2102", session: "Tutorial 06", time: "2:00 pm", attendanceDate: { iso: "2026-09-11", key: "11_Sep_26" } }
  ];
  const [tutorial05, tutorial06] = matchCodesToAttendance(text, items);
  assert.equal(tutorial05.code, "ZS9CR");
  assert.equal(tutorial06.code, "X9JJB");
});

test("course-scopes source pages before matching attendance rows", () => {
  const items = [
    { course: "FIT2102", session: "Tutorial 06", time: "2:00 pm", attendanceDate: { iso: "2026-09-11", key: "11_Sep_26" } },
    { course: "FIT2109", session: "Tutorial 05", time: "2:00 pm", attendanceDate: { iso: "2026-09-11", key: "11_Sep_26" } }
  ];
  const scoped = scopedAttendanceItems(items, ["fit2102"]);
  assert.deepEqual(scoped.map(({ index }) => index), [0]);
  const [matched] = matchCodesToAttendance("Tutorial Friday, 11 Sep 06 2:00PM X9JJB", scoped.map(({ item }) => item));
  assert.equal(matched.code, "X9JJB");
});

test("rejects a same-day same-time code from the wrong tutorial number", () => {
  const item = { course: "FIT2109", session: "Tutorial 05", time: "2:00 pm", attendanceDate: { iso: "2026-09-11", key: "11_Sep_26" } };
  const [matched] = matchCodesToAttendance("Tutorial Friday, 11 Sep 06 2:00PM X9JJB", [item]);
  assert.equal(matched.code, "");
  assert.equal(matched.confidence, "missing");
});

test("still accepts the exact tutorial number on the same date and time", () => {
  const item = { course: "FIT2102", session: "Tutorial 06", time: "2:00 pm", attendanceDate: { iso: "2026-09-11", key: "11_Sep_26" } };
  const [matched] = matchCodesToAttendance("Tutorial Friday, 11 Sep 06 2:00PM X9JJB", [item]);
  assert.equal(matched.code, "X9JJB");
  assert.equal(matched.confidence, "high");
});


test("extracts literal course ownership from an Ed page title", () => {
  assert.deepEqual(courseCodesInText("FIT2102 - Ed Discussion", ["FIT2102", "FIT2109"]), ["FIT2102"]);
  assert.deepEqual(courseCodesInText("No unit in title", ["FIT2102", "FIT2109"]), []);
});
