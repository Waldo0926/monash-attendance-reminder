import Tesseract from "./vendor/tesseract.esm.min.js";
import { describeImageBlob, normaliseImageBlob } from "./ocr-image.js";

const { createWorker, PSM } = Tesseract;
const WORKER_INIT_TIMEOUT_MS = 30000;
const CODE_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

let workerPromise;
let workerInitError;

function describeError(error) {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

function createOcrWorker() {
  let rejectWorkerError;
  const workerError = new Promise((_, reject) => { rejectWorkerError = reject; });
  const creation = createWorker("eng", 1, {
    workerBlobURL: false,
    workerPath: chrome.runtime.getURL("vendor/worker.min.js"),
    corePath: chrome.runtime.getURL("vendor/tesseract-core-lstm.wasm.js"),
    langPath: chrome.runtime.getURL("vendor/lang"),
    errorHandler: (error) => {
      const detail = describeError(error);
      workerInitError = detail;
      rejectWorkerError(new Error(`Tesseract worker error: ${detail}`));
    }
  });
  return Promise.race([
    creation,
    workerError,
    timeoutAfter(WORKER_INIT_TIMEOUT_MS, `Tesseract initialization timed out after ${WORKER_INIT_TIMEOUT_MS / 1000}s${workerInitError ? `: ${workerInitError}` : ""}`)
  ]);
}

function getWorker() {
  if (!workerPromise) {
    workerInitError = "";
    workerPromise = createOcrWorker().catch((error) => {
      workerPromise = undefined;
      throw error;
    });
  }
  return workerPromise;
}

function fiveCharCodes(text) {
  return [...String(text || "").toUpperCase().matchAll(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5}\b/g)]
    .map((match) => match[0]);
}

function plausibleCode(code) {
  const value = String(code || "").toUpperCase();
  if (!/^(?=[A-Z0-9]{5}$)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5}$/.test(value)) return false;
  if (/^(FIT|ECE|ENG|MMA|TRC)\d$/i.test(value)) return false;
  // A right-column crop can graze the adjacent time column. "4:00PM" becomes
  // "400PM" under an alphanumeric whitelist and must never be treated as a code.
  if (/^\d{3,4}[AP]M$/i.test(value)) return false;
  return true;
}

function codeSequence(text) {
  const values = [];
  for (const line of String(text || "").toUpperCase().split(/\n+/)) {
    const direct = fiveCharCodes(line).filter(plausibleCode);
    if (direct.length) {
      values.push(...direct);
      continue;
    }
    const compact = line.replace(/[^A-Z0-9]/g, "");
    if (plausibleCode(compact)) values.push(compact);
  }
  return values;
}

function bestCodeSequence(...texts) {
  return texts.map(codeSequence).sort((a, b) => b.length - a.length)[0] || [];
}

function bestCodeToken(...texts) {
  const counts = new Map();
  for (const text of texts) {
    for (const code of codeSequence(text)) counts.set(code, (counts.get(code) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function sessionRows(text) {
  const clean = String(text || "").replace(/\r/g, "\n");
  const chunks = clean
    .split(/(?=\b(?:Workshop|Tutorial|Studio|Applied(?: Class)?|Practical|Laboratory|Lab|Seminar)\b)/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => /\b(?:Workshop|Tutorial|Studio|Applied(?: Class)?|Practical|Laboratory|Lab|Seminar)\b/i.test(part) && /\b\d{1,2}:\d{2}\s*[AP]\.?M\.?\b/i.test(part));
  return chunks;
}

function pairRowsWithCodeColumn(rowText, codes) {
  const rows = sessionRows(rowText);
  if (!rows.length || !codes.length) return [];

  // Use codes already visible in OCR as alignment anchors. This prevents an omitted
  // visual row from shifting every code onto the next session. When no anchor exists,
  // only assume zero offset if counts are close and the first metadata row is present.
  const offsets = new Map();
  rows.forEach((row, rowIndex) => {
    for (const code of fiveCharCodes(row).filter(plausibleCode)) {
      codes.forEach((candidate, codeIndex) => {
        if (candidate !== code) return;
        const offset = codeIndex - rowIndex;
        offsets.set(offset, (offsets.get(offset) || 0) + 1);
      });
    }
  });
  let offset = [...offsets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (offset === undefined) {
    if (Math.abs(codes.length - rows.length) > 1) return [];
    offset = 0;
  }

  // Confirmed against the real FIT2102 Aug 18 Workshop post: that row is published as its
  // own tiny 841x42 strip, and the whole-row pass read the code as "CcQlTe" (garbled). That
  // garbled tail still happens to look like a plausible 5-character code ("CCQLT") once
  // uppercased, purely because it sits next to a non-ASCII character that regex \b treats as
  // a boundary - it is not a real reading of the code cell. Skipping this row here on that
  // basis threw away the far more reliable code the whitelisted crop pass found for the same
  // cell. A row's own reading should only pre-empt the crop-derived code when the two agree;
  // agreement is exactly what the anchor pass above already requires, so apply the same bar
  // here instead of accepting any pattern-shaped fragment on its own.
  const stitched = [];
  rows.forEach((row, rowIndex) => {
    const ownCodes = fiveCharCodes(row).filter(plausibleCode);
    if (ownCodes.some((code) => codes.includes(code))) return;
    const code = codes[rowIndex + offset];
    if (code) stitched.push(`${row} ${code}`);
  });
  return stitched;
}

async function recognise(image) {
  const worker = await getWorker();
  const source = image.dataUrl || image.src;
  let response;
  try {
    const remote = /^https?:/i.test(source);
    response = await fetch(source, { credentials: remote ? "omit" : "same-origin", cache: "no-store" });
    const privateFirstParty = /^https:\/\/(?:learning\.monash\.edu|edstem\.org)\//i.test(source);
    const type = response.headers.get("content-type") || "";
    if (privateFirstParty && (response.status === 401 || response.status === 403 || /text\/html/i.test(type))) {
      response = await fetch(source, { credentials: "include", cache: "no-store" });
    }
  } catch (error) {
    throw new Error(`Image fetch failed for ${image.src}: ${describeError(error)}`);
  }
  if (!response.ok) throw new Error(`Image HTTP ${response.status}: ${image.src}`);

  const blob = await response.blob();
  const contentType = response.headers.get("content-type") || blob.type || "";
  let normalized;
  try {
    normalized = await normaliseImageBlob(blob);
  } catch (error) {
    const diagnostic = await describeImageBlob(blob, contentType).catch(() => `content-type=${contentType || "unknown"}, size=${blob.size}`);
    throw new Error(`Image decode failed for ${image.src}: ${describeError(error)} [${diagnostic}]`);
  }

  const passes = [];
  const generalTexts = [];
  const syntheticRows = [];

  const runPass = async (blobToRead, mode, label, { whitelist = "", collect = true } = {}) => {
    if (!blobToRead) return "";
    await worker.setParameters({
      tessedit_pageseg_mode: mode,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_char_whitelist: whitelist
    });
    const result = await worker.recognize(blobToRead);
    const value = (result?.data?.text || "").trim();
    passes.push({ label, text: value });
    if (collect && value) generalTexts.push(value);
    return value;
  };

  // A very wide, short Ed attachment is *not necessarily one row*. FIT2102 posts its
  // Workshop 01 as a one-row strip, while FIT2109 uses a similarly shaped image for three
  // Workshop rows. v1.3.11/1.3.12 treated every wide-short image as SINGLE_LINE and therefore
  // destroyed the FIT2109 table (SQP3R disappeared). Run both layout hypotheses cheaply:
  // SINGLE_BLOCK preserves multi-row tables; SINGLE_LINE rescues true one-row strips.
  if (normalized.wideShort) {
    const block = await runPass(normalized.blob, PSM.SINGLE_BLOCK, "wide-block");
    const line = await runPass(normalized.blob, PSM.SINGLE_LINE, "wide-single-line", { collect: false });

    const blockRows = sessionRows(block);
    const blockCodes = codeSequence(block);
    const lineCodes = codeSequence(line);

    // Keep SINGLE_LINE only when it actually looks useful. On a multi-row strip Tesseract
    // may otherwise emit nonsense such as "woe moe . on or", which should never pollute the
    // candidate pool or hide the good SINGLE_BLOCK result.
    if (line && (lineCodes.length || sessionRows(line).length)) syntheticRows.push(line);

    // This used to only run the dedicated code-column crop below once the block/line pass
    // already looked short a code (fewer codes found than rows found). Traced against the
    // real FIT2102 Workshop 01 (Aug 18) Ed post: that single-row strip's block pass read the
    // code cell as garbage ("CcQlTe" plus an accented character), and that garbage happened
    // to contain a run of 5 plain A-Z0-9 characters once uppercased - for the same reason
    // documented on pairRowsWithCodeColumn below, the accented character reads as a word
    // boundary to the regex, not because a real code was found. That fake "code" made the
    // count look complete (1 code for 1 row), so the crop pass - the one actually built to
    // read this column reliably - never even ran, and the row exported blank. Running the
    // crop unconditionally, gated only on the image being croppable at all, and letting
    // pairRowsWithCodeColumn's own agreement check (not a count) decide which reading to
    // trust, closes that gap.
    const combinedCodes = [...new Set([...blockCodes, ...lineCodes])];
    const codeNormal = await runPass(normalized.codeBlob, PSM.SPARSE_TEXT, "wide-code-zone", { whitelist: CODE_WHITELIST, collect: false });
    const codeBinary = await runPass(normalized.codeThresholdBlob, PSM.SPARSE_TEXT, "wide-code-zone-threshold", { whitelist: CODE_WHITELIST, collect: false });
    const imageCodes = bestCodeSequence(codeNormal, codeBinary);
    if (imageCodes.length) {
      syntheticRows.push(...pairRowsWithCodeColumn(block || line, imageCodes));
      if (imageCodes.length === 1 && !combinedCodes.length) {
        syntheticRows.push(`${line || block || image.context || image.alt || ""} ${imageCodes[0]}`.trim());
      }
    }
  } else {
    const fullBlock = await runPass(normalized.blob, PSM.SINGLE_BLOCK, "full-block");
    let workingText = fullBlock;

    // A single block pass can drop an entire row - metadata line and code together, not
    // just the code cell - when that row's spacing or shading confuses Tesseract's own
    // layout analysis. Confirmed against the real FIT2102/FIT2109 Ed attendance posts: one
    // Workshop row's whole line vanished from the block pass while every other row read
    // fine, and comparing "codes found" against "rows found" stayed balanced (both dropped
    // together) so the old rescue gate below never even fired. Running SPARSE_TEXT
    // unconditionally, rather than only once the block pass already looks short a code,
    // reads each text region independently and is what actually has a chance of catching a
    // row the block pass silently lost.
    if (normalized.height >= 260) {
      const sparse = await runPass(normalized.blob, PSM.SPARSE_TEXT, "full-sparse");
      workingText = [workingText, sparse].filter(Boolean).join("\n");
    }

    let codes = codeSequence(workingText);

    // Same blind spot applies to the dedicated code-column crop below: a fully-dropped row
    // never shows up as a codes/rows mismatch, so gating this rescue on that mismatch missed
    // exactly the rows that most needed it. This crop only ever reads the whitelisted right
    // column, so running it whenever the image is shaped like a real code table (wide
    // relative to its height) costs one more OCR pass but is what recovers that row's code.
    if (normalized.width / Math.max(1, normalized.height) >= 2.2) {
      const codeNormal = await runPass(normalized.codeBlob, PSM.SPARSE_TEXT, "code-zone", { whitelist: CODE_WHITELIST, collect: false });
      const codeBinary = await runPass(normalized.codeThresholdBlob, PSM.SPARSE_TEXT, "code-zone-threshold", { whitelist: CODE_WHITELIST, collect: false });
      const imageCodes = bestCodeSequence(codeNormal, codeBinary);
      const hasNewCode = imageCodes.some((code) => !codes.includes(code));
      if (hasNewCode) {
        syntheticRows.push(...pairRowsWithCodeColumn(workingText, imageCodes));
        if (imageCodes.length === 1 && !codes.length) syntheticRows.push(`${workingText} ${imageCodes[0]}`.trim());
      }
      codes = [...new Set([...codes, ...imageCodes])];
    }

    // Last-resort top-band OCR is retained only when the preceding passes found no code
    // whatsoever.  The old unconditional per-row loop was noisy and expensive.
    if (!codes.length && normalized.height >= 180) {
      const topBlock = await runPass(normalized.topBlob, PSM.SINGLE_BLOCK, "top-block");
      const topCodeA = await runPass(normalized.topCodeBlob, PSM.SINGLE_WORD, "top-code-zone", { whitelist: CODE_WHITELIST, collect: false });
      const topCodeB = await runPass(normalized.topCodeThresholdBlob, PSM.SINGLE_WORD, "top-code-zone-threshold", { whitelist: CODE_WHITELIST, collect: false });
      const topCode = bestCodeToken(topCodeA, topCodeB);
      if (topCode) syntheticRows.push(`${topBlock || image.context || ""} ${topCode}`.trim());
    }
  }

  // Nearby Ed text is useful only as context for an image code already found above; it
  // should never inject unrelated tokens into the OCR result on its own.
  const text = [...new Set([...syntheticRows, ...generalTexts].map((value) => value.trim()).filter(Boolean))].join("\n");
  return {
    src: image.src,
    text,
    passes,
    imageType: normalized.originalType,
    normalizedType: normalized.blob.type,
    width: normalized.width,
    height: normalized.height
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen-ocr" || message.type !== "OCR_IMAGES") return;
  (async () => {
    const results = [];
    for (const image of message.images || []) {
      try {
        results.push(await recognise(image));
      } catch (error) {
        results.push({ src: image.src, text: "", error: describeError(error) });
      }
    }
    sendResponse({ ok: true, results });
  })().catch((error) => sendResponse({ ok: false, error: describeError(error) }));
  return true;
});
