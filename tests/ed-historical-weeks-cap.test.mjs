import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { edThreadLinks } from "../extension/shared.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Traced by hand against the real FIT2102 Ed course discussion list: it does not keep one
// persistent "Attendance Codes" thread that gets edited in place, it posts a brand new
// thread every single week ("Week 8 Attendance Codes", "Week 7 International Students
// Attendance Codes", ...). The old flat `.slice(0, 2)` cap was sized for a single weekly
// scan and silently starved every week beyond the top two once buildSemesterHistory reused
// the same function across a whole semester's worth of missing weeks.
test("edThreadLinks opens one thread per still-needed week instead of a flat top-2 cap", () => {
  const links = [
    { label: "Week 8 Attendance Codes", href: "https://edstem.org/au/courses/36340/discussion/1008" },
    { label: "Week 7 International Students Attendance Codes", href: "https://edstem.org/au/courses/36340/discussion/1007" },
    { label: "Week 3 Attendance Codes", href: "https://edstem.org/au/courses/36340/discussion/1003" },
    { label: "Week 1 Attendance Codes", href: "https://edstem.org/au/courses/36340/discussion/1001" },
    { label: "Workshop 8", href: "https://edstem.org/au/courses/36340/discussion/1099" }
  ];

  // A normal weekly scan only ever needs the current week - unchanged flat-cap behaviour.
  assert.deepEqual(edThreadLinks(links), [
    "https://edstem.org/au/courses/36340/discussion/1008",
    "https://edstem.org/au/courses/36340/discussion/1007"
  ]);

  // A semester export needs weeks 1, 3, 7 and 8 - every one of those threads must open,
  // not just whichever two rank highest overall.
  const forExport = edThreadLinks(links, [1, 3, 7, 8]);
  assert.ok(forExport.includes("https://edstem.org/au/courses/36340/discussion/1001"), "week 1 thread must be included");
  assert.ok(forExport.includes("https://edstem.org/au/courses/36340/discussion/1003"), "week 3 thread must be included");
  assert.ok(forExport.includes("https://edstem.org/au/courses/36340/discussion/1007"), "week 7 thread must be included");
  assert.ok(forExport.includes("https://edstem.org/au/courses/36340/discussion/1008"), "week 8 thread must be included");
  assert.equal(forExport.length, 4);
});

test("edThreadLinks still includes a general never-numbered thread alongside weekly ones", () => {
  const links = [
    { label: "Week 2 Attendance Codes", href: "https://edstem.org/au/courses/1/discussion/2" },
    { label: "Attendance Codes", href: "https://edstem.org/au/courses/1/discussion/999" }
  ];
  const result = edThreadLinks(links, [2]);
  assert.ok(result.includes("https://edstem.org/au/courses/1/discussion/2"));
  assert.ok(result.includes("https://edstem.org/au/courses/1/discussion/999"));
});

test("a week with no matching thread is simply skipped, never crashes or duplicates", () => {
  const links = [
    { label: "Week 5 Attendance Codes", href: "https://edstem.org/au/courses/1/discussion/5" }
  ];
  assert.deepEqual(edThreadLinks(links, [4, 5, 6]), ["https://edstem.org/au/courses/1/discussion/5"]);
});

test("automaticSourceScans derives the missing teaching weeks for a course and passes them to edThreadLinks", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const edSection = serviceWorker.slice(
    serviceWorker.indexOf("for (const course of edCourses.slice(0, 8))"),
    serviceWorker.indexOf("const resolvedCourses = confidentlyResolvedCourses(scans, items);")
  );
  assert.match(edSection, /const courseItems = items\.filter/, "must scope items down to this course before deriving weeks");
  assert.match(edSection, /teachingWeek\(\{\s*weekOneMonday:\s*settings\.weekOneMonday\s*\}/, "must derive teaching weeks the same way the Moodle fallback does");
  assert.match(edSection, /edThreadLinks\(list\.links,\s*edTargetWeeks\)/, "must actually pass the derived weeks through to edThreadLinks");
});
