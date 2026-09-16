import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { weekBucket, weekPrefix } from "../extension/shared.js";

// "未找到" alone used to mean two very different things: "the teacher hasn't posted this
// week's code yet" (normal) and "a past class shows no code and no completed status" (worth
// investigating). Every status label must say which week it is talking about so the two are
// never confused with each other.
function itemOn(iso) {
  return { attendanceDate: { iso } };
}

test("a class dated within the current Monday-Sunday week is bucketed as thisWeek", () => {
  const wednesday = new Date(2026, 8, 16); // Wed 16 Sep 2026
  assert.equal(weekBucket(itemOn("2026-09-14"), wednesday), "thisWeek"); // Monday of this week
  assert.equal(weekBucket(itemOn("2026-09-16"), wednesday), "thisWeek"); // today
});

test("a class dated in the preceding Monday-Sunday week is bucketed as lastWeek", () => {
  const wednesday = new Date(2026, 8, 16);
  assert.equal(weekBucket(itemOn("2026-09-13"), wednesday), "lastWeek"); // Sunday just before
  assert.equal(weekBucket(itemOn("2026-09-07"), wednesday), "lastWeek"); // Monday of last week
});

test("anything older than last week is bucketed as earlier, not lastWeek", () => {
  const wednesday = new Date(2026, 8, 16);
  assert.equal(weekBucket(itemOn("2026-08-30"), wednesday), "earlier");
});

test("weekPrefix renders the Chinese label each bucket needs", () => {
  assert.equal(weekPrefix("thisWeek"), "本周");
  assert.equal(weekPrefix("lastWeek"), "上周");
  assert.equal(weekPrefix("earlier"), "更早");
  assert.equal(weekPrefix(""), "");
});

test("review and popup status/summary text is prefixed by week bucket", () => {
  const review = new URL("../extension/review.js", import.meta.url);
  const popup = new URL("../extension/popup.js", import.meta.url);
  const reviewSource = readFileSync(review, "utf8");
  const popupSource = readFileSync(popup, "utf8");
  assert.match(reviewSource, /weekPrefix\(weekBucket\(item\)\)/, "review status labels must carry the week prefix");
  assert.match(popupSource, /weekBucket\(item\) === "thisWeek"/, "popup summary must split this week from past weeks");
});
