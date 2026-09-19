import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Traced by hand against the real FIT2109 "Announcement 2 of 2" email: its Workshops/Tutorials
// headings are real text, but the two DIVs holding every actual code are <img> screenshots (a
// live check on the opened Gmail message found tableCount:2 with only 5 <td> total, next to 3
// <img> elements sized 1255x160 and 1228x349 - the code table itself was never text at all).
// content.js already collects large-enough images off ANY page, Gmail included, but
// automaticSourceScans' isCodePage gate only ever sent Ed discussion threads and Moodle section
// pages on to OCR. An opened Gmail message with the exact same screenshot never got OCR'd, so no
// amount of tuning matchCodesToAttendance's text regex could ever have found FIT2109's codes -
// they were never text for it to find. This is the actual root cause of the "the email is right
// there but the code never gets found" complaint, separate from anything the semester-export
// fixes touched.
test("automaticSourceScans sends opened Gmail messages to OCR, not just Ed/Moodle pages", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const scanFn = serviceWorker.slice(serviceWorker.indexOf("const scan = async (url, options = {})"), serviceWorker.indexOf("const titleCourses = courseCodesInText"));
  assert.match(scanFn, /isCodePage\s*=\s*\/edstem\\\.org/, "must still OCR Ed discussion threads");
  assert.match(scanFn, /learning\\\.monash\\\.edu/, "must still OCR Moodle section pages");
  assert.match(scanFn, /mail\\\.google\\\.com\\\/mail\\\/u\\\/\\d\+\\\/#all\\\//, "must also OCR an opened Gmail message - that is where a screenshot-table code lives");
  assert.match(scanFn, /if \(page\.ok && page\.images\?\.length && isCodePage\) page = await ocrPageImages\(page\)/);
});

test("the Gmail OCR gate only matches an opened single message (#all/), not the search results list", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const scanFn = serviceWorker.slice(serviceWorker.indexOf("const scan = async (url, options = {})"), serviceWorker.indexOf("const titleCourses = courseCodesInText"));
  const gmailGateLine = scanFn.split("\n").find((line) => line.includes("mail") && line.includes("google") && line.includes("#all"));
  assert.ok(gmailGateLine, "the Gmail OCR condition must exist");
  assert.ok(!gmailGateLine.includes("#search"), "must not also match the search list page - OCR-ing dozens of inbox row thumbnails would be pure waste");
});
