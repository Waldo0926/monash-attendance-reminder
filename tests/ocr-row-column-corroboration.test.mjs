import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// pairRowsWithCodeColumn (and the helpers it calls) are pure text logic with no chrome or
// Tesseract dependency, but ocr.js as a whole imports the bundled Tesseract module and is
// meant to run inside the extension's offscreen document, so it cannot be imported directly
// into a plain node:test run. Extract just those pure functions out of the real source and
// run them in an isolated vm context, so this test exercises the actual shipped logic rather
// than a hand-copied re-implementation that could quietly drift from it.
function loadPureHelpers() {
  const source = read("../extension/ocr.js");
  const names = ["fiveCharCodes", "plausibleCode", "codeSequence", "sessionRows", "pairRowsWithCodeColumn"];
  const bodies = names.map((name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} must still exist in ocr.js`);
    let depth = 0;
    let end = source.indexOf("{", start);
    for (let index = end; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) { end = index + 1; break; }
      }
    }
    return source.slice(start, end);
  });
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${bodies.join("\n\n")}\nthis.pairRowsWithCodeColumn = pairRowsWithCodeColumn;`, context);
  return context.pairRowsWithCodeColumn;
}

// Traced against the real Ed post for FIT2102 Workshop 01, Aug 18: that row is published as
// its own tiny 841x42 image strip. Even after the extension's own upscaling, Tesseract read
// the code cell as "CcQlTe" (an actual, reproduced OCR misread, not a hypothetical one) while
// the dedicated whitelisted code-column crop of the exact same image correctly read a 5-char
// candidate from that column. "CcQlTe", once uppercased, still happens to contain a run of 5
// plain A-Z0-9 characters ("CCQLT") purely because the accented trailing character acts as a
// word boundary for the \b-based matcher - not because the block pass actually read a code.
// The old gate in pairRowsWithCodeColumn treated any such pattern-shaped fragment as proof
// the row already had its own code and silently discarded the far more reliable, whitelisted
// crop result for that same row - which is exactly why this row exported as blank rather than
// as a real (if occasionally imperfect) candidate.
test("a garbled block-pass fragment that merely looks code-shaped does not block the whitelisted crop's code", () => {
  const pairRowsWithCodeColumn = loadPureHelpers();
  const rowText =
    "Workshop                                                             Tuesday, 18 Aug         01                             4:00PM                                    CcQlTeé\n";
  const cropCodes = ["CQIT6"];
  const stitched = pairRowsWithCodeColumn(rowText, cropCodes);
  assert.equal(stitched.length, 1, "the crop-derived code must still be attached to the row");
  assert.match(stitched[0], /CQIT6/);
});

// When the block pass's own reading genuinely agrees with a crop-derived code, that
// agreement is real corroboration and the row must not be duplicated with a second copy of
// the same code.
test("a row whose own reading agrees with a crop-derived code is not duplicated", () => {
  const pairRowsWithCodeColumn = loadPureHelpers();
  const rowText = "Workshop Monday, 17 Aug 01 6:00PM TQDDM\n";
  // The vm sandbox's Array is a different realm than this test's, so compare structurally
  // via a plain copy rather than assert.deepEqual, which trips on the prototype mismatch.
  const stitched = [...pairRowsWithCodeColumn(rowText, ["TQDDM"])];
  assert.equal(stitched.length, 0);
});
