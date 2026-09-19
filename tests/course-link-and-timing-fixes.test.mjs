import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { findCourseLinks } from "../extension/shared.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Traced by hand against the real Ed dashboard (chrome dev tools, live account): the "context"
// content.js climbs a few parents up from each course link is meant for pages where the course
// code sits beside the anchor rather than inside it, but on the dashboard that climb lands on a
// shared sidebar container whose text is every enrolled unit's name concatenated together. That
// made findCourseLinks tag every single course card with every requested course code, including
// an unrelated course the student was not even asking about (FIT3143). The label text Ed puts
// inside the anchor itself already names the one course that link is actually for, so matching
// against the label first (falling back to the wider context only when the label names none of
// the requested courses) fixes this without touching the DOM-scraping side of content.js.
test("findCourseLinks only tags a course link with courses its own label names, not every code in shared sidebar context", () => {
  const links = [
    {
      label: "FIT2102 1 Programming paradigms",
      context: "FIT2102 1 Programming paradigms FIT2109 S2 2026 Malaysia Computer science workshop FIT3143/MUM 35 FIT3143 Parallel computing - MUM FIT3162/FIT3164 MUM S2 2026 FIT3162 - FIT3164 COMPUTER & DATA SCIENCE PROJECT 2 - MUM S2 2026",
      href: "https://edstem.org/au/courses/36340"
    },
    {
      label: "FIT2109 S2 2026 Malaysia Computer science workshop",
      context: "FIT2102 1 Programming paradigms FIT2109 S2 2026 Malaysia Computer science workshop FIT3143/MUM 35 FIT3143 Parallel computing - MUM FIT3162/FIT3164 MUM S2 2026 FIT3162 - FIT3164 COMPUTER & DATA SCIENCE PROJECT 2 - MUM S2 2026",
      href: "https://edstem.org/au/courses/39026"
    },
    {
      label: "FIT3143/MUM 35 FIT3143 Parallel computing - MUM",
      context: "FIT2102 1 Programming paradigms FIT2109 S2 2026 Malaysia Computer science workshop FIT3143/MUM 35 FIT3143 Parallel computing - MUM FIT3162/FIT3164 MUM S2 2026 FIT3162 - FIT3164 COMPUTER & DATA SCIENCE PROJECT 2 - MUM S2 2026",
      href: "https://edstem.org/au/courses/40001"
    },
    {
      label: "FIT3162/FIT3164 MUM S2 2026 FIT3162 - FIT3164 COMPUTER & DATA SCIENCE PROJECT 2 - MUM S2 2026",
      context: "FIT2102 1 Programming paradigms FIT2109 S2 2026 Malaysia Computer science workshop FIT3143/MUM 35 FIT3143 Parallel computing - MUM FIT3162/FIT3164 MUM S2 2026 FIT3162 - FIT3164 COMPUTER & DATA SCIENCE PROJECT 2 - MUM S2 2026",
      href: "https://edstem.org/au/courses/44555"
    }
  ];

  const matches = findCourseLinks(links, ["fit3162", "fit2102", "fit2109"], { hrefPattern: /\/courses\/\d+/ });
  const byHref = new Map(matches.map((match) => [match.href, match.courses]));

  assert.deepEqual(byHref.get("https://edstem.org/au/courses/36340"), ["fit2102"]);
  assert.deepEqual(byHref.get("https://edstem.org/au/courses/39026"), ["fit2109"]);
  assert.deepEqual(byHref.get("https://edstem.org/au/courses/44555"), ["fit3162"]);
  // FIT3143 was never requested, and its own label does not name any requested course, so it
  // must not appear at all - the old bug tagged it with all three requested codes anyway.
  assert.ok(!byHref.has("https://edstem.org/au/courses/40001"), "an unrelated course must not be matched via shared sidebar context");
});

test("findCourseLinks still falls back to context when a link's own label names no course", () => {
  const links = [
    { label: "Week 3 Attendance Codes", context: "FIT2102 course page Week 3 Attendance Codes", href: "https://edstem.org/au/courses/36340/discussion/1003" }
  ];
  const matches = findCourseLinks(links, ["fit2102"], { hrefPattern: /\/discussion\/\d+/ });
  assert.deepEqual(matches, [{ href: "https://edstem.org/au/courses/36340/discussion/1003", courses: ["fit2102"] }]);
});

// Timed by hand against the real Moodle "My units" page with nothing else competing for the
// tab: its course cards did not exist in the DOM until 17.4 seconds after navigation, already
// past the old 15000ms wait budget on its own. That is why the real debug log's
// "moodle my-units scan" entry showed moodleCoursesFound: [] every time - the wait gave up
// before a single course link had rendered, so the whole Moodle fallback never even started.
test("the Moodle my-units scan waits long enough for the real page's slow hydration", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const match = /const myUnits = await scan\("https:\/\/learning\.monash\.edu\/my\/courses\.php", \{ maxMs: (\d+),/.exec(serviceWorker);
  assert.ok(match, "the myUnits scan call must still exist with an explicit maxMs");
  assert.ok(Number(match[1]) >= 30000, `myUnits maxMs (${match[1]}) must comfortably clear the observed 17.4s real load time`);
});

// Confirmed by hand against the real FIT2102 Ed course: with nothing clicked, the discussion
// list only ever has its ~30 most recent threads in the DOM, so weeks 1-6's attendance threads
// were never present for edThreadLinks to even consider. Clicking "Load more" (Ed's own button)
// repeatedly before the page's links are captured is what actually makes those threads exist to
// scan in the first place.
test("content.js expands Ed's discussion list before capturing links, the same way it handles Gmail's sort dropdown", () => {
  const contentScript = read("../extension/content.js");
  assert.match(contentScript, /function expandEdDiscussionList/);
  assert.match(contentScript, /加载更多|load\\s\*more/i);
  const handler = contentScript.slice(contentScript.indexOf("chrome.runtime.onMessage.addListener"));
  const gmailIndex = handler.indexOf("preferGmailMostRecent()");
  const edIndex = handler.indexOf("expandEdDiscussionList()");
  const linksIndex = handler.indexOf("document.querySelectorAll(\"a[href]\")");
  assert.ok(gmailIndex >= 0 && edIndex >= 0 && linksIndex >= 0, "handler must call both expansion steps before capturing links");
  assert.ok(edIndex > gmailIndex, "Ed expansion should be attempted alongside/after the Gmail sort fix");
  assert.ok(edIndex < linksIndex, "Ed discussion list must be expanded before links are captured, or newly-loaded threads are missed");
});
