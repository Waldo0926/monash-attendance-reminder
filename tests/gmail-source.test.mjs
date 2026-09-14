import test from "node:test";
import assert from "node:assert/strict";
import { gmailSearchBounds, pickGmailBase, prioritiseGmailThreads } from "../extension/gmail-source.js";

test("prefers the active Gmail account instead of assuming u/0", () => {
  const tabs = [
    { url: "https://mail.google.com/mail/u/0/#inbox", active: false, lastAccessed: 100 },
    { url: "https://mail.google.com/mail/u/1/#search/Attendance", active: true, lastAccessed: 90 }
  ];
  assert.equal(pickGmailBase(tabs), "https://mail.google.com/mail/u/1/");
});

test("falls back to the most recently accessed Gmail account", () => {
  const tabs = [
    { url: "https://mail.google.com/mail/u/0/#inbox", active: false, lastAccessed: 100 },
    { url: "https://mail.google.com/mail/u/2/#inbox", active: false, lastAccessed: 250 }
  ];
  assert.equal(pickGmailBase(tabs), "https://mail.google.com/mail/u/2/");
});

test("searches far enough before class dates to catch early attendance-code announcements", () => {
  const items = [
    { attendanceDate: { iso: "2026-09-08" } },
    { attendanceDate: { iso: "2026-09-11" } }
  ];
  assert.deepEqual(gmailSearchBounds(items), {
    after: "2026/08/31",
    before: "2026/09/15"
  });
});

test("prioritises attendance-code mail and reserves candidates across courses", () => {
  const threads = [
    { id: "noise-1", label: "ENG2005 Week 8 unit information attendance reminder" },
    { id: "eng-code", label: "ENG2005 Week 7 Attendance Code (International students only)" },
    { id: "ece-form", label: "ECE2072 Week 7 Attendance Forms response" },
    { id: "mma-code", label: "MMA2004 Week 7 INTERNATIONAL STUDENT ATTENDANCE CODE" },
    { id: "trc-code", label: "TRC2001 Week 7 Attendance Code" },
    { id: "eng-recording", label: "ENG2005 Week 7 workshop recording attendance" }
  ];
  const result = prioritiseGmailThreads(threads, ["ENG2005", "ECE2072", "MMA2004", "TRC2001"], 4);
  assert.deepEqual(new Set(result.map((thread) => thread.id)), new Set(["eng-code", "ece-form", "mma-code", "trc-code"]));
});

test("deduplicates Gmail thread ids before applying the scan limit", () => {
  const threads = [
    { id: "same", label: "ENG2005 Attendance Code" },
    { id: "same", label: "ENG2005 Attendance Code duplicate DOM row" },
    { id: "other", label: "ENG2005 Attendance" }
  ];
  assert.deepEqual(prioritiseGmailThreads(threads, ["ENG2005"], 10).map((thread) => thread.id), ["same", "other"]);
});
