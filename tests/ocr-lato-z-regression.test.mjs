import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { dateInfo, flagOcrDoubts, matchCodesToAttendance } from "../extension/shared.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Same trick as ocr-row-column-corroboration.test.mjs: ocr.js imports Tesseract, so pull the
// pure text helpers out of the real source and run them in a vm instead of copying them here.
function loadOcrHelpers() {
  const source = read("../extension/ocr.js");
  const names = ["fiveCharCodes", "plausibleCode", "codeSequence", "upperCaseCodeTokens", "hamming", "oneEditApart", "looseCodeTokens", "conflictingReadings", "sessionRows", "pairRowsWithCodeColumn"];
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
  vm.runInContext(`${bodies.join("\n\n")}\nthis.helpers = { ${names.join(", ")} };`, context);
  // Arrays made inside the vm have the vm's Array prototype, which deepStrictEqual rejects,
  // so every helper's result is copied back into this realm through JSON.
  return Object.fromEntries(Object.entries(context.helpers).map(([name, fn]) => [name, (...args) => JSON.parse(JSON.stringify(fn(...args)))]));
}

const item = (course, session, time, month, day) => ({
  course,
  session,
  time,
  attendanceDate: dateInfo(new Date(2026, month - 1, day, 12))
});

// Real OCR text of the FIT2109 Week 11 workshop table (Ed post #765), from the extension's
// own pipeline. The block pass already shows the fold to upper case; the sparse pass below it
// still reads the Workshop 02 code as "GU2zpP", which is how the raw passes looked.
const fit2109Week11Workshops = [
  "Workshop                                              Monday, 12 Oct       01                      6:00PM                         9URJW",
  "Workshop                                        Wednesday, 14       02                   4:00PM",
  "GU2ZP",
  "Oct",
  "Workshop                                        Wednesday, 14       03_OnlineReal TiM®OOPM",
  "Oct                                                                                        69GUM",
  "Workshop", "", "Monday, 12 Oct", "", "01", "", "6:00PM", "", "9URJW", "",
  "Workshop", "", "Wednesday, 14", "", "02", "", "4:00PM", "", "Oct", "", "GU2zpP", "",
  "Workshop", "", "Wednesday, 14", "", "03_OnlineReal TiM®OOPM", "", "Oct", "", "69GUM"
].join("\n");

test("a code read with a lowercase z is folded to upper case, plain words are not", () => {
  const { upperCaseCodeTokens } = loadOcrHelpers();
  assert.equal(upperCaseCodeTokens("Wednesday, 14 02 4:00PM\nGU2zP\nOct"), "Wednesday, 14 02 4:00PM\nGU2ZP\nOct");
  assert.equal(upperCaseCodeTokens("W4zVD"), "W4ZVD");
  assert.equal(upperCaseCodeTokens("FZluD"), "FZLUD");
  for (const word of ["Codes", "Thurs", "Week9", "Lab01", "hello"]) assert.equal(upperCaseCodeTokens(word), word);
  // The garbled Aug 18 strip fragment must stay garbled, see ocr-row-column-corroboration.
  assert.equal(upperCaseCodeTokens("4:00PM CcQlTé"), "4:00PM CcQlTé");
});

test("FIT2109 Week 11 Workshop 02 is found again from the real OCR text", () => {
  const [workshop02] = matchCodesToAttendance(
    `FIT2109 S2 2026 Malaysia - Ed Discussion\nAttendance code (International Students Only) & Workshop Recording - Week 11\nWorkshops:\n${fit2109Week11Workshops}`,
    [item("FIT2109", "Workshop 02", "4:00 pm", 10, 14)]
  );
  assert.equal(workshop02.code, "GU2ZP");
});

test("cells that the OCR passes spell differently are grouped, most voted clean code first", () => {
  const { conflictingReadings, looseCodeTokens } = loadOcrHelpers();
  // FIT2102 Week 10 Workshop 01 is W4ZVD. Big renders read W47VD, smaller ones W4zVD.
  const readings = ["W47VD", "W47VD", "W47VD", "W4ZVD", "W4ZVD", ...looseCodeTokens("W427VD"), "EV6FA", "EV6FA"];
  assert.deepEqual(conflictingReadings(readings), [["W47VD", "W4ZVD", "W427VD"]]);
  // A near miss alone ("JTLT") still marks the clean reading as doubtful.
  assert.deepEqual(conflictingReadings(["JTOLT", "JTOLT", "JTLT"]), [["JTOLT", "JTLT"]]);
  // Different codes in one table are never merged.
  assert.deepEqual(conflictingReadings(["AP3YP", "YC592", "A24XS", "GG6PS", "TYNRP", "592QJ"]), []);
  // Time cells grazed by the crop are not votes.
  assert.deepEqual(looseCodeTokens("1000AM 400PM"), []);
});

test("a crop reading one character away from the row's own reading is not stitched on as a second code", () => {
  const { pairRowsWithCodeColumn } = loadOcrHelpers();
  const rowText = "Workshop Monday, 12 Oct 01 6:00PM 9URJW\nWorkshop Wednesday, 14 02 4:00PM GU2ZP Oct\nWorkshop Wednesday, 14 03 4:00PM Oct 69GUM";
  assert.deepEqual(pairRowsWithCodeColumn(rowText, ["9URJW", "GU27P", "69GUM"]), []);
});

test("a code the OCR passes disagree on drops to review and lists the other spellings", () => {
  const items = [item("FIT2102", "Workshop 01", "4:00 pm", 10, 6)];
  const matched = matchCodesToAttendance("FIT2102 - Ed Discussion\nWeek 10 Attendance Codes\nWorkshop Tuesday, 6 Oct 01 4:00PM W47VD", items);
  assert.equal(matched[0].confidence, "high");
  const [flagged] = flagOcrDoubts(matched, [["W47VD", "W4ZVD", "W427VD"]]);
  assert.equal(flagged.code, "W47VD");
  assert.equal(flagged.confidence, "review");
  assert.match(flagged.context, /^OCR 读法不一致：W47VD \/ W4ZVD \/ W427VD/);
  // Codes nobody disagreed on are left alone.
  assert.deepEqual(flagOcrDoubts(matched, [["GU2ZP", "GU27P"]]), matched);
});

test("ocr.js adds unwhitelisted and multi-size votes on the code column and reports the doubts", () => {
  const source = read("../extension/ocr.js");
  assert.match(source, /"wide-code-zone-plain"/);
  assert.match(source, /"code-zone-plain"/);
  assert.match(source, /normalized\.codeVoteBlobs/);
  assert.match(source, /uncertain: conflictingReadings\(readings\)/);
  const worker = read("../extension/service-worker.js");
  assert.match(worker, /ocrDoubts: results\.flatMap\(\(result\) => result\.uncertain \|\| \[\]\)/);
  assert.equal((worker.match(/flagOcrDoubts\(matchCodesToAttendance\(/g) || []).length, 2);
});

// The FIT3162 Studio 01 row was "found" with code MCS21, which is the project team's name in an
// email to the supervisor. The email named FIT3162, Thursday 15 October and a numbered list,
// which was enough score without the row ever saying Studio or 5:00 PM.
test("a team name in an email is not taken as the studio's attendance code", () => {
  const email = [
    "Formal Complaint - Team Member Participation, FIT3162 Team MCS21",
    "Dear Dr. Soo,",
    "I am writing to formally raise a concern about the participation of a teammate in our FIT3162 project team, MCS21, and to submit a record of it together with the supporting evidence.",
    "Our final group presentation and software demonstration will take place on Thursday 15 October 2026. As of 10 October 2026 at 18:00, they have not posted in our team group chat.",
    "Attached to this e-mail:",
    "1. Formal complaint letter (signed)"
  ].join("\n");
  const [studio] = matchCodesToAttendance(email, [item("FIT3162", "Studio 01", "5:00 pm", 10, 15)]);
  assert.equal(studio.code, "");
  assert.equal(studio.confidence, "missing");

  const [real] = matchCodesToAttendance(`${email}\nStudio Thursday, 15 Oct 01 5:00PM K7Q2M`, [item("FIT3162", "Studio 01", "5:00 pm", 10, 15)]);
  assert.equal(real.code, "K7Q2M");
});
