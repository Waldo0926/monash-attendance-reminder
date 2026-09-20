import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { matchCodesToAttendance } from "../extension/shared.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// The v1.3.45 fix to pairRowsWithCodeColumn never actually ran for the real FIT2102
// Workshop 01 (Aug 18) row it was written for. That row's block/line pass misread the code
// cell as garbage ("CcQlTe" plus an accented character), and that garbage still happened to
// contain a run of 5 plain A-Z0-9 characters once uppercased. In the wideShort branch, that
// fake "code" was enough to satisfy the old "did the block pass already find as many codes as
// rows" gate, so the dedicated, whitelisted code-column crop pass - the one that actually
// reads this column reliably - never even ran, and pairRowsWithCodeColumn's fix never got a
// chance to matter. This asserts that gate is gone: the crop pass in the wideShort branch now
// runs whenever the image is croppable at all, not only once the counts already look short.
test("ocr.js runs the wideShort code-column crop unconditionally, not only when the count-based gate looks short a code", () => {
  const source = read("../extension/ocr.js");
  const wideShortBranch = source.slice(source.indexOf("if (normalized.wideShort) {"), source.indexOf("  } else {"));
  assert.match(wideShortBranch, /runPass\(normalized\.codeBlob, PSM\.SPARSE_TEXT, "wide-code-zone"/);
  assert.ok(
    !/rowsNeedCodeRescue/.test(wideShortBranch),
    "the old rows-vs-codes count comparison must be gone - a fake code that only looks complete must not block the crop pass"
  );
});

// End-to-end reproduction using the real, exported matchCodesToAttendance (no chrome
// dependency, so it can be imported directly): feed it the same text the fixed OCR pipeline
// would now produce for the real FIT2102 Workshop 01 image - the garbled block reading, with
// the crop-derived code appended by pairRowsWithCodeColumn - and confirm the real matching
// logic surfaces that code for the row instead of leaving it unmatched.
test("the real matching logic recovers a code for the previously-blank FIT2102 Workshop 01 row once the crop code is appended", () => {
  const text = "Workshop Tuesday, 18 Aug 01 4:00PM CcQlTé CQIT6";
  const attendanceItems = [{ course: "FIT2102", session: "Workshop 01", date: "2026-08-18", time: "4:00 pm" }];
  const [match] = matchCodesToAttendance(text, attendanceItems);
  assert.ok(match, "a match must be produced for this row");
  assert.equal(match.code, "CQIT6");
});
