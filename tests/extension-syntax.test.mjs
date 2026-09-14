import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const files = [
  new URL("../extension/reconciliation-v2.js", import.meta.url),
  new URL("../extension/reconciliation-core.js", import.meta.url),
  new URL("../extension/review.js", import.meta.url),
  new URL("../extension/service-worker-wrapper.js", import.meta.url)
];

test("new reconciliation runtime modules are valid JavaScript", () => {
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", fileURLToPath(file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file.pathname}\n${result.stderr || result.stdout}`);
  }
});
