import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Traced against the real Ed attendance posts for FIT2102 Workshop 01 (Aug 18) and
// FIT2109 Workshop 02 (Aug 19, Sep 2): one entire row of the table - the metadata text
// and its code together, not just the code cell - was silently dropped by the SINGLE_BLOCK
// pass while every other row in the same image read fine. Because both "codes found" and
// "rows found" dropped together, the old rescue gate (only running the sparse pass or the
// code-zone crop once codes.length < rows.length) never noticed anything was missing, so the
// row that most needed a second pass never got one. The fix runs the sparse pass and the
// code-zone crop unconditionally, gated only on the image's own shape rather than on a
// count comparison, so a fully-dropped row still gets a chance to be recovered.
const ocrSource = read("../extension/ocr.js");
const nonWideShortBranch = ocrSource.slice(
  ocrSource.indexOf("} else {"),
  ocrSource.indexOf("// Nearby Ed text is useful only as context")
);

test("ocr.js runs the full-image sparse pass without gating on a codes-vs-rows count mismatch", () => {
  assert.match(nonWideShortBranch, /runPass\(normalized\.blob, PSM\.SPARSE_TEXT, "full-sparse"\)/);
  // The old gate compared codes.length against rows.length before deciding to rescue; that
  // comparison must be gone from this branch, since a dropped row keeps both counts in
  // lockstep and never trips it.
  assert.ok(
    !/codes\.length < rows\.length/.test(nonWideShortBranch),
    "the sparse pass must not be gated behind a codes-vs-rows mismatch check that a fully-dropped row can never trigger"
  );
});

test("ocr.js runs the dedicated code-zone crop for any table-shaped image, not only when a mismatch was already detected", () => {
  assert.match(nonWideShortBranch, /runPass\(normalized\.codeBlob, PSM\.SPARSE_TEXT, "code-zone"/);
  assert.match(nonWideShortBranch, /normalized\.width \/ Math\.max\(1, normalized\.height\) >= 2\.2/);
});

test("a newly-found code from the code-zone crop is folded into the recovered codes so a rescued row is not silently dropped again", () => {
  assert.match(nonWideShortBranch, /hasNewCode/);
  assert.match(nonWideShortBranch, /codes = \[\.\.\.new Set\(\[\.\.\.codes, \.\.\.imageCodes\]\)\]/);
});
