import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { codeConfidenceOf } from "../extension/reconciliation-core.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Every freshly scraped attendance row starts life with codeConfidence: "missing" (a plain
// truthy string) and only ever gets overwritten by a restore from the evidence cache. A code
// matched fresh during a scan (mergeSourceScanCodes) used to update `confidence` but leave
// `codeConfidence` stuck on that stale "missing" string. options.js's CSV export read
// `item.codeConfidence || item.confidence`, so it printed "missing" in the 可信度 column for a
// row that had a real, high-confidence code sitting right next to it in the 签到码 column -
// this only stayed hidden for codes restored from the cache, which set both fields correctly.
test("codeConfidenceOf resolves a row whose codeConfidence field is stale but confidence + code are correct", () => {
  const staleRow = { code: "TYBZR", codeConfidence: "missing", confidence: "high" };
  assert.equal(codeConfidenceOf(staleRow), "high", "a matched code with high confidence must not read back as missing");
});

test("mergeSourceScanCodes keeps codeConfidence in sync with confidence when a code is matched", () => {
  const serviceWorker = read("../extension/service-worker.js");
  assert.match(
    serviceWorker,
    /confidence:\s*candidate\.confidence,\s*codeConfidence:\s*candidate\.confidence/,
    "must set codeConfidence alongside confidence, not just confidence"
  );
});

test("the semester-history CSV export reads confidence through codeConfidenceOf rather than a raw field", () => {
  const options = read("../extension/options.js");
  assert.match(options, /import\s*\{[^}]*\bcodeConfidenceOf\b[^}]*\}\s*from\s*"\.\/reconciliation-core\.js"/);
  assert.doesNotMatch(
    options,
    /item\.codeConfidence\s*\|\|\s*item\.confidence\s*\|\|\s*""/,
    "must not read the raw codeConfidence field directly - it can be stale even when the row has a real code"
  );
  assert.match(options, /codeConfidenceOf\(item\)/, "the CSV row builder must call codeConfidenceOf(item) for the 可信度 column");
});
