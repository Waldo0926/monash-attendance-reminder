import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { attendanceFileLinks, imageSize, readAttendanceDocx, readDocx } from "../extension/docx.js";

// ETW1001 uploads "Attendance Code.docx" to the Moodle week page and BTW1042 emails the same
// kind of file via a Moodle forum post. Both are a title line plus screenshots of the code
// table, so the file has to be fetched, unzipped and its images OCR'd - never opened in a tab.
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(data);
    const packed = deflateRawSync(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(raw), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.concat([header, nameBytes, packed]);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc32(raw), 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, nameBytes]));
    parts.push(entry);
    offset += entry.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, centralBuf, end]));
}

function png(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}

const docx = () => zip({
  "word/document.xml": "<w:document><w:p><w:r><w:t>Attendance Code: Students</w:t></w:r></w:p><w:p><w:r><w:t>Date: 29 Sept to 2 Oct 2026</w:t></w:r></w:p></w:document>",
  "word/media/image1.png": png(2442, 926),
  "word/media/image2.png": png(2450, 964),
  "word/media/image10.png": png(2420, 454)
});

test("readDocx returns the title text and the screenshots in document order", async () => {
  const result = await readDocx(docx());
  assert.equal(result.text, "Attendance Code: Students\nDate: 29 Sept to 2 Oct 2026");
  assert.deepEqual(result.images.map((image) => `${image.name} ${image.width}x${image.height}`), [
    "word/media/image1.png 2442x926", "word/media/image2.png 2450x964", "word/media/image10.png 2420x454"
  ]);
});

test("imageSize reads PNG dimensions and falls back for other formats", () => {
  assert.deepEqual(imageSize(png(10, 20)), { width: 10, height: 20 });
  assert.deepEqual(imageSize(new Uint8Array([0xff, 0xd8, 0xff])), { width: 1200, height: 600 });
});

test("only attendance/code Word files on Moodle are selected, by their own name", () => {
  const picked = attendanceFileLinks([
    { label: "Attendance Code DOCX", href: "https://learning.monash.edu/mod/resource/view.php?id=7" },
    { label: "Attendance Code DOCX", href: "https://learning.monash.edu/mod/resource/view.php?id=7#again" },
    { label: "Quiz 5 Week 9", href: "https://learning.monash.edu/mod/quiz/view.php?id=1" },
    { label: "W9 Solution", href: "https://learning.monash.edu/mod/folder/view.php?id=2" },
    { label: "BTW1042- WEEK 9 - ATTENDANCE CODE.docx", href: `https://www.google.com/url?q=${encodeURIComponent("https://learning.monash.edu/pluginfile.php/1/mod_forum/attachment/2/BTW1042-%20WEEK%209%20-%20ATTENDANCE%20CODE.docx?forcedownload=1")}` },
    { label: "slides.pdf", href: "https://learning.monash.edu/pluginfile.php/1/mod_resource/content/1/slides.pdf" },
    { label: "Code of conduct.docx", href: "https://learning.monash.edu/pluginfile.php/1/mod_resource/content/1/Code%20of%20conduct.docx" },
    { label: "Attendance Code", href: "https://example.com/mod/resource/view.php?id=7" }
  ]);
  assert.deepEqual(picked.map((file) => file.name), ["Attendance Code DOCX", "BTW1042- WEEK 9 - ATTENDANCE CODE.docx"]);
});

test("readAttendanceDocx fetches with the session, skips login pages and non-docx, and yields OCR images", async () => {
  const bytes = docx();
  const calls = [];
  const fetchFn = async (href, options) => {
    calls.push([href, options.credentials]);
    if (href.includes("id=1")) return { ok: true, url: "https://monashuni.okta.com/login", headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(0) };
    if (href.includes("id=2")) return { ok: true, url: href, headers: { get: () => "text/html" }, arrayBuffer: async () => new TextEncoder().encode("<html>").buffer };
    return { ok: true, url: href, headers: { get: () => "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  const result = await readAttendanceDocx([
    { label: "Attendance Code", href: "https://learning.monash.edu/mod/resource/view.php?id=1" },
    { label: "Attendance Code", href: "https://learning.monash.edu/mod/resource/view.php?id=2" },
    { label: "Attendance Code DOCX", href: "https://learning.monash.edu/mod/resource/view.php?id=3" }
  ], { fetchFn });
  assert.ok(calls.every(([, credentials]) => credentials === "include"));
  assert.match(result.text, /Moodle attendance file: Attendance Code DOCX\nAttendance Code: Students\nDate: 29 Sept/);
  assert.equal(result.images.length, 3);
  assert.ok(result.images.every((image) => image.fromDocx && image.dataUrl.startsWith("data:image/png;base64,") && /attendance/.test(image.context)));
  assert.deepEqual([result.images[0].width, result.images[0].height], [2442, 926]);
});

test("the scan reads docx attachments on Moodle/Gmail code pages before OCR, and OCRs every docx image", () => {
  const worker = readFileSync(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const read = worker.indexOf("readAttendanceDocx(page.links");
  const ocr = worker.indexOf("page = await ocrPageImages(page)");
  assert.ok(read > 0 && ocr > read, "docx must be read before the page goes to OCR");
  assert.match(worker, /fromDocx/);
});

test("fileLinkClues reports file-like links for the debug log without query strings", async () => {
  const { fileLinkClues } = await import("../extension/docx.js");
  const clues = fileLinkClues([
    { label: "Reply", href: "https://mail.google.com/mail/u/8/#inbox" },
    { label: "BTW1042- WEEK 9 - ATTENDANCE CODE.docx", href: "https://mail.google.com/mail/u/8?ui=2&attid=0.1&disp=safe&view=att#x" },
    { label: "Download", href: "https://learning.monash.edu/pluginfile.php/1/a.docx?token=SECRET" }
  ]);
  assert.equal(clues.length, 2);
  assert.ok(clues.every((clue) => !/SECRET|token/.test(clue.href)));
});

test("links in the main region win over the course-index drawer's other-week files", () => {
  const picked = attendanceFileLinks([
    { label: "Attendance Codes W1", href: "https://learning.monash.edu/mod/resource/view.php?id=11", inMain: false },
    { label: "Attendance Codes W2", href: "https://learning.monash.edu/mod/resource/view.php?id=12", inMain: false },
    { label: "Attendance Code DOCX", href: "https://learning.monash.edu/mod/resource/view.php?id=19", inMain: true }
  ]);
  assert.deepEqual(picked.map((file) => file.name), ["Attendance Code DOCX"]);
  // Pages whose links carry no region info (older content script) still work.
  assert.equal(attendanceFileLinks([{ label: "Attendance Code", href: "https://learning.monash.edu/mod/resource/view.php?id=19" }]).length, 1);
});

test("the content script marks main-region links, and the manifest lets the worker follow Moodle's CloudFront redirect", () => {
  const content = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.match(content, /inMain: Boolean\(link\.closest/);
  // Moodle redirects pluginfile.php/mod/resource downloads to this signed CloudFront host; without
  // a host permission fetch() fails with "Failed to fetch" on the cross-site redirect.
  assert.ok(manifest.host_permissions.includes("https://d25zr1xy094zys.cloudfront.net/*"));
});

// Real OCR of the ETW1001 week 9 .docx: the Wednesday rows' dates wrap ("Wednesday, 30" / "Sep")
// and tesseract read one wrapped month as "ep", which left Tutorial 09 without a date.
test("a wrapped month that OCR clipped to its last two letters is still restored", async () => {
  const { matchCodesToAttendance } = await import("../extension/shared.js");
  const text = [
    "Moodle attendance file: Attendance Code File",
    "Tutorial Tuesday, 29 Sep 16 2:00PM ST8CT",
    "Tutorial Wednesday, 30 02 8:00AM", "PP9MD", "Sep",
    "Tutorial Wednesday, 30 09 8:00AM", "5 H8465", "ep",
    "Tutorial"
  ].join("\n");
  const item = (session, time, iso, key) => ({ course: "ETW1001", session, time, attendanceDate: { iso, key } });
  const [t16, t02, t09] = matchCodesToAttendance(text, [
    item("Tutorial 16", "2:00 pm", "2026-09-29", "29_Sep_26"),
    item("Tutorial 02", "8:00 am", "2026-09-30", "30_Sep_26"),
    item("Tutorial 09", "8:00 am", "2026-09-30", "30_Sep_26")
  ]);
  assert.deepEqual([t16.code, t02.code, t09.code], ["ST8CT", "PP9MD", "H8465"]);
  assert.ok([t16, t02, t09].every((result) => result.confidence === "high"));
  // The wrong month must still not match: "ep" is September, never donated from elsewhere.
  const [october] = matchCodesToAttendance(text, [item("Tutorial 09", "8:00 am", "2026-10-30", "30_Oct_26")]);
  assert.ok(!october.code);
});
