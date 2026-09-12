import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the automatic attendance configuration surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Attendance Helper — 自动查码与确认/);
  assert.match(html, /到点查好签到码/);
  assert.match(html, /FIT3162/);
  assert.match(html, /FIT2102/);
  assert.match(html, /Malaysia/);
  assert.match(html, /FIT2109/);
  assert.match(html, /下载扩展配置/);
  assert.match(html, /确认后才提交/);
  assert.doesNotMatch(html, /macOS Attendance Reminder/);
});
