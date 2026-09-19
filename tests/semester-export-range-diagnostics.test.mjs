import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { logDebug, readDebugLog } from "../extension/shared.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Every test run in this bug report showed the semester export CSV starting weeks later than
// Week 1, and separately the confirm page's debug log came back completely empty after running
// it. Neither symptom pointed at Gmail, which the three earlier fixes all targeted - a wrong
// Week 1 date and the Attendance portal quietly not rendering old dates both just make the
// export start "somewhere later than expected", with nothing to tell them apart. These tests
// lock in the fix: the actual requested-vs-returned date range is always visible on screen, and
// logDebug can no longer lose entries to a concurrent caller.
test("buildSemesterHistory logs the raw Week 1 setting before any validation can throw", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const fn = serviceWorker.slice(serviceWorker.indexOf("async function buildSemesterHistory"));
  const firstThrow = fn.indexOf("throw new Error");
  const firstLog = fn.indexOf("logDebug(");
  assert.ok(firstLog > -1 && firstLog < firstThrow, "a logDebug call must run before the first possible throw, or a bad setting leaves zero trace in the log");
  assert.match(fn.slice(0, firstThrow), /weekOneMonday:\s*settings\?\.weekOneMonday/, "must log the actual stored value, not just that export was requested");
});

test("buildSemesterHistory logs and returns how much of the requested range Attendance actually returned sessions for", () => {
  const serviceWorker = read("../extension/service-worker.js");
  assert.match(serviceWorker, /datesWithAnySessionRow/, "must compare requested days against days that actually produced session rows");
  assert.match(serviceWorker, /earliestDateWithSessions/);
  assert.match(serviceWorker, /return\s*\{\s*items:\s*sorted,\s*range:\s*\{/, "must return the computed range alongside the items so the caller can show it without reading the debug log");
});

test("the EXPORT_SEMESTER_HISTORY handler logs receipt of the message and forwards the range to the response", () => {
  const serviceWorker = read("../extension/service-worker.js");
  const handler = serviceWorker.slice(serviceWorker.indexOf('message.type === "EXPORT_SEMESTER_HISTORY"'));
  const handlerBlock = handler.slice(0, handler.indexOf("if (message.type ===", 10) === -1 ? 900 : handler.indexOf("if (message.type ===", 10));
  assert.match(handlerBlock, /logDebug\("EXPORT_SEMESTER_HISTORY received"\)/, "must log that the button click actually reached the background, separately from anything buildSemesterHistory itself logs");
  assert.match(handlerBlock, /const \{ items, range \} = await buildSemesterHistory\(settings\)/);
  assert.match(handlerBlock, /sendResponse\(\{ ok: true, items, range \}\)/);
});

test("options.js shows the requested-vs-actual date range next to the export result, not only in the debug log", () => {
  const options = read("../extension/options.js");
  assert.match(options, /range\.earliestDateWithSessions/, "the on-screen status must surface what Attendance actually returned");
  assert.match(options, /range\.lookbackDays/, "the on-screen status must surface what was actually requested, so the two can be compared without opening the debug log");
});

test("logDebug serialises concurrent writers instead of racing on a read-modify-write of the same storage key", () => {
  const shared = read("../extension/shared.js");
  assert.match(shared, /let logChain = Promise\.resolve\(\)/, "must chain writes through a single promise so two concurrent scans cannot lose each other's entries");
  assert.match(shared, /logChain = logChain\.then\(/);
});

test("logDebug actually preserves every entry when called concurrently (no lost updates)", async (t) => {
  const store = {};
  global.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (obj) => Object.assign(store, obj)
      }
    }
  };
  t.after(() => { delete global.chrome; });

  // Fire many logDebug calls "at once" (no sequential await between them) the way two
  // independent async flows (a semester export and a concurrently-firing alarm scan) would
  // interleave in the real service worker.
  await Promise.all(Array.from({ length: 25 }, (_, index) => logDebug(`entry ${index}`)));

  const log = await readDebugLog();
  assert.equal(log.length, 25, "every concurrent logDebug call must land in the stored log, none silently overwritten");
});
