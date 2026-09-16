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
  const reconciliationStatus = latestScan.reconciliation?.status;
  // Keep this week's "still looking for the code" separate from last week's "already
  // attended" - both used to collapse into one "已签到 X 节" number, which made a perfectly
  // normal this-week wait look identical to an actual past-week gap.
  summary.textContent = `本周找到代码 ${thisWeekFound}/${thisWeek.length}${pastWeeks.length ? ` · 上周已签到 ${pastCompleted}/${pastWeeks.length}` : ""}`;
  // The popup closes and forgets everything the moment you click away, so a failure reason
  // shown only during the live scan click was gone forever the next time you reopened it.
  // Read it back from storage instead of collapsing "failed" into the same "等待最终核对"
  // text as "hasn't run yet".
  const reconciliationText = reconciliationStatus === "complete"
    ? "最终核对完成"
    : reconciliationStatus === "failed"
      ? `最终核对失败：${latestScan.reconciliation.error || "未知错误"}`
      : "等待最终核对";
  detail.textContent = `上次检查：${new Date(latestScan.scannedAt).toLocaleString("zh-CN")} · ${reconciliationText}`;
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  scanButton.textContent = "正在查找并核对…";
  let response;
  try {
    // This used to be two separate messages - scan, then a follow-up "run final
    // reconciliation" - sent back to back from this same click handler. The popup's script
    // is destroyed the instant the popup closes (clicking away, opening another tab, the
    // OS switching focus), which silently dropped that second message before it was ever
    // sent: the scan itself still finished and notified normally in the background, so it
    // looked like reconciliation had simply stopped merging completed classes back in. The
    // background now does both steps inside one SCAN_ALL call, so a closed popup can no
    // longer strand the second half of the work.
    response = await sendMessageWithTimeout({ type: "SCAN_ALL" });
  } catch (error) {
    scanButton.disabled = false;
    scanButton.textContent = "超时，重试";
    detail.textContent = error.message;
    return;
  }
  scanButton.disabled = false;
  scanButton.textContent = response?.ok ? "检查完成" : "重试";
  // refresh() reads the persisted status/failure reason straight from storage, so it
  // survives the popup being closed and reopened.
  await refresh();
});
document.querySelector("#review").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_REVIEW" }));
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.latestScan) refresh().catch(() => {});
});

refresh();
