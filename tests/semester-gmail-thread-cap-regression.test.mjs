import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prioritiseGmailThreads } from "../extension/gmail-source.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// buildSemesterHistory() reuses automaticSourceScans() - and therefore
// prioritiseGmailThreads() - unchanged from the normal weekly scan. A flat 4-per-course /
// 24-total cap was sized for a single week's worth of sessions; left flat over a full
// semester with several units, it silently returned only some units' codes while others
// (whichever lost out once the round-robin's leftover slots ran out) showed "missing" for
// every week, even though the emails were sitting right there in the Gmail search results
// the whole time.
test("a flat 24-total cap drops emails once several courses each have many weekly threads", () => {
  const threads = [];
  for (const course of ["FIT2102", "FIT2109", "FIT3162"]) {
    for (let week = 1; week <= 10; week += 1) {
      threads.push({ id: `${course}-week-${week}`, label: `${course} Week ${week} Attendance Code` });
    }
  }
  // 30 real attendance-code emails across the semester, but the old call site fixed the
  // total at 24 regardless of how many courses or weeks were actually being searched for.
  const oldFlatCaps = prioritiseGmailThreads(threads, ["FIT2102", "FIT2109", "FIT3162"], 24, 4);
  assert.ok(oldFlatCaps.length < 30, "the old flat 24 total cap cannot fit one thread per week for 3 courses");

  const coursesWithAllTheirThreads = new Set(oldFlatCaps.map((thread) => thread.id.split("-week-")[0]));
  assert.ok(
    coursesWithAllTheirThreads.size < 3
      || ["FIT2102", "FIT2109", "FIT3162"].some((course) => oldFlatCaps.filter((t) => t.id.startsWith(course)).length < 10),
    "at least one course loses weeks worth of emails to the flat cap"
  );

  // Scaled the way service-worker.js now computes it: perCourseThreadLimit = max(4, 10 + 2),
  // totalThreadLimit = max(24, 3 * perCourseThreadLimit).
  const scaled = prioritiseGmailThreads(threads, ["FIT2102", "FIT2109", "FIT3162"], 36, 12);
  assert.equal(scaled.length, 30, "every course must get every week's attendance-code email once the caps scale with the actual session count");
});

test("automaticSourceScans scales both Gmail thread caps with the number of sessions being searched for, not a flat weekly-scan number", () => {
  const serviceWorker = read("../extension/service-worker.js");

  assert.doesNotMatch(
    serviceWorker,
    /prioritiseGmailThreads\(search\.gmailThreads,\s*codes,\s*24\)/,
    "must not call prioritiseGmailThreads with the old hardcoded weekly-scan limit of 24"
  );

  const fn = serviceWorker.slice(serviceWorker.indexOf("async function automaticSourceScans"));
  const callSite = fn.slice(0, fn.indexOf("prioritiseGmailThreads(search.gmailThreads") + 200);

  assert.match(
    callSite,
    /sessionsPerCourse/,
    "must derive the thread cap from how many sessions per course are actually in `items`"
  );
  assert.match(
    callSite,
    /prioritiseGmailThreads\(search\.gmailThreads,\s*codes,\s*totalThreadLimit,\s*perCourseThreadLimit\)/,
    "must pass a dynamically computed total and per-course limit into prioritiseGmailThreads"
  );
});
