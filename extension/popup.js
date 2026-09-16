import { sendMessageWithTimeout, weekBucket } from "./shared.js";

const summary = document.querySelector("#summary");
const detail = document.querySelector("#detail");
const scanButton = document.querySelector("#scan");

function codeConfidence(item) {
  if (item.codeConfidence === "high" || item.codeConfidence === "review") return item.codeConfidence;
  if (item.code && (item.confidence === "high" || item.confidence === "review")) return item.confidence;
  return "missing";
}

function portalCompleted(item) {
  return Boolean(item?.completed)
    || item?.confidence === "completed"
    || /[?&]mah_completed=1(?:&|#|$)/.test(String(item?.entryUrl || ""));
}

async function refresh() {
  const { latestScan } = await chrome.storage.local.get("latestScan");
  if (!latestScan) {
    summary.textContent = "尚未检查本周签到码";
    detail.textContent = "到设定时间会自动检查，你也可以现在运行。";
    return;
  }
  const items = latestScan.items || [];
  const thisWeek = items.filter((item) => weekBucket(item) === "thisWeek");
  const pastWeeks = items.filter((item) => weekBucket(item) !== "thisWeek");
  const thisWeekFound = thisWeek.filter((item) => item.code && codeConfidence(item) === "high").length;
  const pastCompleted = pastWeeks.filter(portalCompleted).length;
  const finalised = latestScan.reconciliation?.status === "complete";
  // Keep this week's "still looking for the code" separate from last week's "already
  // attended" - both used to collapse into one "已签到 X 节" number, which made a perfectly
  // normal this-week wait look identical to an actual past-week gap.
  summary.textContent = `本周找到代码 ${thisWeekFound}/${thisWeek.length}${pastWeeks.length ? ` · 上周已签到 ${pastCompleted}/${pastWeeks.length}` : ""}`;
  detail.textContent = `上次检查：${new Date(latestScan.scannedAt).toLocaleString("zh-CN")}${finalised ? " · 最终核对完成" : " · 等待最终核对"}`;
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  scanButton.textContent = "正在查找…";
  let response;
  try {
    response = await sendMessageWithTimeout({ type: "SCAN_ALL" });
  } catch (error) {
    scanButton.disabled = false;
    scanButton.textContent = "超时，重试";
    detail.textContent = error.message;
    return;
  }
  if (!response?.ok) {
    scanButton.disabled = false;
    scanButton.textContent = "重试";
    await refresh();
    return;
  }
  scanButton.textContent = "正在核对…";
  let final;
  try {
    final = await sendMessageWithTimeout({ type: "RUN_FINAL_RECONCILIATION" });
  } catch (error) {
    // Do not call refresh() here: it would overwrite this message with the not-yet-
    // reconciled summary and hide the fact that the background work may still be running.
    scanButton.disabled = false;
    scanButton.textContent = "核对超时，重试";
    detail.textContent = error.message;
    return;
  }
  scanButton.disabled = false;
  scanButton.textContent = final?.ok ? "检查完成" : "核对失败，重试";
  await refresh();
  // refresh() overwrites detail with a generic summary; append the actual reason so a
  // reconciliation failure isn't silently indistinguishable from one that never ran.
  if (!final?.ok && final?.error) detail.textContent += ` · ${final.error}`;
});
document.querySelector("#review").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_REVIEW" }));
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.latestScan) refresh().catch(() => {});
});

refresh();
