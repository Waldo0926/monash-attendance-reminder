import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const extension = new URL("../extension/", import.meta.url);

async function text(name) {
  return readFile(new URL(name, extension), "utf8");
}

test("bundles every local Tesseract asset needed by the offscreen OCR worker", async () => {
  for (const asset of [
    "vendor/tesseract.esm.min.js",
    "vendor/worker.min.js",
    "vendor/tesseract-core-lstm.wasm.js",
    "vendor/lang/eng.traineddata.gz"
  ]) {
    const info = await stat(new URL(asset, extension));
    assert.ok(info.size > 1000, `${asset} should be bundled and non-empty`);
  }
});

test("disables Tesseract's blob worker so the OCR worker satisfies the MV3 CSP", async () => {
  const source = await text("ocr.js");
  assert.match(source, /workerBlobURL:\s*false/);
  assert.match(source, /chrome\.runtime\.getURL\("vendor\/worker\.min\.js"\)/);
  assert.match(source, /chrome\.runtime\.getURL\("vendor\/tesseract-core-lstm\.wasm\.js"\)/);
  assert.match(source, /chrome\.runtime\.getURL\("vendor\/lang"\)/);
});

test("normalizes browser-readable image formats to PNG before Tesseract", async () => {
  const ocr = await text("ocr.js");
  const image = await text("ocr-image.js");
  assert.match(ocr, /normaliseImageBlob\(blob\)/);
  assert.match(ocr, /runPass\(normalized\.blob, PSM\.SINGLE_BLOCK/);
  assert.doesNotMatch(ocr, /worker\.recognize\(blob\)/);
  assert.match(image, /createImageBitmap\(blob\)/);
  assert.match(image, /canvas\.toBlob/);
  assert.match(image, /"image\/png"/);
});

test("captures live blob URL pixels before the source tab is closed", async () => {
  const source = await text("content.js");
  assert.match(source, /snapshotImageAsPng/);
  assert.match(source, /src\.startsWith\("blob:"\)\s*\?\s*snapshotImageAsPng\(image\)/);
});

test("reports image content type, byte length and magic bytes when decoding fails", async () => {
  const ocr = await text("ocr.js");
  const image = await text("ocr-image.js");
  assert.match(ocr, /describeImageBlob/);
  assert.match(image, /content-type=/);
  assert.match(image, /size=/);
  assert.match(image, /magic=/);
});

test("manifest keeps OCR in an offscreen document with local workers and WebAssembly enabled", async () => {
  const manifest = JSON.parse(await text("manifest.json"));
  assert.equal(manifest.version, "1.3.41");
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
  assert.match(manifest.content_security_policy.extension_pages, /worker-src 'self'/);
});


test("uses two OCR page-segmentation passes for attendance tables", async () => {
  const source = await text("ocr.js");
  assert.match(source, /PSM\.SINGLE_BLOCK/);
  assert.match(source, /PSM\.SPARSE_TEXT/);
  assert.match(source, /worker\.setParameters/);
});

test("source scanner skips known non-code images and reuses already-open exact tabs", async () => {
  const source = await text("service-worker.js");
  assert.match(source, /img\\\.youtube/);
  assert.match(source, /confidentlyResolvedCourses/);
  assert.match(source, /candidate\.url === url/);
  assert.match(source, /chrome\.scripting\.executeScript/);
  assert.match(source, /unresolvedCodes/);
});


test("v1.3.6 keeps credential-free CDN fetches and OCRs a top-band rescue image", async () => {
  const ocr = await readFile(new URL("../extension/ocr.js", import.meta.url), "utf8");
  const worker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const image = await readFile(new URL("../extension/ocr-image.js", import.meta.url), "utf8");
  assert.match(ocr, /credentials: remote \? "omit" : "same-origin"/);
  assert.match(ocr, /runPass\(normalized\.topBlob, PSM\.SINGLE_BLOCK/);
  assert.match(image, /topBlob/);
  assert.match(worker, /moodlePage && !imageLooksRelevant/);
  assert.match(worker, /img\\\.youtube/);
});


test("v1.3.6 restores selected Ed-thread OCR while keeping Moodle filtering strict", async () => {
  const worker = await text("service-worker.js");
  assert.match(worker, /const selectedEdThread = \/edstem\\\.org/);
  assert.match(worker, /moodlePage && !imageLooksRelevant/);
  assert.match(worker, /!imageLooksRelevant && !selectedEdThread/);
  assert.match(worker, /ocrDetails/);
});


test("v1.3.7 rescues the first Ed table row with detected row crops", async () => {
  const ocr = await text("ocr.js");
  const image = await text("ocr-image.js");
  const worker = await text("service-worker.js");
  const review = await text("review.js");
  assert.match(image, /const rowBlobs = \[\]/);
  assert.match(image, /getImageData/);
  assert.match(ocr, /PSM\.SINGLE_LINE/);
  assert.doesNotMatch(ocr, /normalized\.rowBlobs/);
  assert.match(ocr, /passes/);
  assert.match(worker, /passes: result\.passes/);
  assert.match(review, /OCR passes/);
});


test("v1.3.8 isolates and reattaches the right-side attendance-code column", async () => {
  const image = await readFile(new URL("../extension/ocr-image.js", import.meta.url), "utf8");
  const ocr = await readFile(new URL("../extension/ocr.js", import.meta.url), "utf8");
  assert.match(image, /rightCodeCrop/);
  assert.match(image, /codeThresholdBlob/);
  assert.match(ocr, /CODE_WHITELIST/);
  assert.match(ocr, /code-zone-threshold/);
  assert.match(ocr, /syntheticRows/);
  assert.match(ocr, /single-line/);
});


test("v1.3.9 aligns a multi-row code column and scopes source pages by course", async () => {
  const ocr = await text("ocr.js");
  const worker = await text("service-worker.js");
  const shared = await text("shared.js");
  assert.match(ocr, /pairRowsWithCodeColumn/);
  assert.match(ocr, /bestCodeSequence/);
  assert.match(ocr, /normalized\.codeBlob, PSM\.SPARSE_TEXT/);
  assert.match(worker, /courses: course\.courses/);
  assert.match(worker, /scopedAttendanceItems/);
  assert.match(shared, /export function scopedAttendanceItems/);
});


test("v1.3.10 keeps ultra-wide short Ed attachments and trusts a unique page-title course owner", async () => {
  const content = await text("content.js");
  const image = await text("ocr-image.js");
  const ocr = await text("ocr.js");
  const worker = await text("service-worker.js");
  assert.match(content, /edDiscussionPage/);
  assert.match(content, /minImageHeight = edDiscussionPage \? 20 : 60/);
  assert.match(content, /edusercontent\.com\/files/);
  assert.match(image, /const wideShort = width \/ Math\.max\(1, height\) >= 4/);
  assert.match(ocr, /wide-single-line/);
  assert.match(worker, /titleCourses\.length === 1/);
  assert.match(worker, /ocrSelectedCount/);
});

test("v1.3.12 isolates the local session slice before class-number validation", async () => {
  const source = await text("shared.js");
  assert.match(source, /flattens several visual table rows onto one/);
  assert.match(source, /rowBlock\(lineIndex, match\.index \?\? -1\)/);
  assert.match(source, /current\.slice\(start, end\)/);
});

test("v1.3.11 hardens course ownership, group-number matching, and review safety", async () => {
  const worker = await text("service-worker.js");
  const shared = await text("shared.js");
  const ocr = await text("ocr.js");
  const review = await text("review.js");
  assert.match(worker, /courseCodesInText/);
  assert.match(worker, /safeScopedAttendanceItems/);
  assert.match(worker, /unitScopedSource/);
  assert.match(shared, /explicitRowSessionNumbers/);
  assert.match(shared, /numberConflict/);
  assert.match(ocr, /if \(normalized\.wideShort\)/);
  assert.match(ocr, /old unconditional per-row loop was noisy and expensive/);
  assert.match(review, /item\.code && codeConfidence\(item\) === "high"/);
});


test("v1.3.13 preserves multi-row wide Ed workshop images while keeping one-row rescue", async () => {
  const ocr = await text("ocr.js");
  assert.match(ocr, /if \(normalized\.wideShort\)/);
  assert.match(ocr, /PSM\.SINGLE_BLOCK, "wide-block"/);
  assert.match(ocr, /PSM\.SINGLE_LINE, "wide-single-line"/);
  assert.match(ocr, /const blockRows = sessionRows\(block\)/);
  assert.match(ocr, /rowsNeedCodeRescue/);
  assert.match(ocr, /lineCodes\.length \|\| sessionRows\(line\)\.length/);
});
