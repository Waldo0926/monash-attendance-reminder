import { sendMessageWithTimeout } from "./shared.js";

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
  const found = items.filter((item) => item.code && codeConfidence(item) === "high").length;
  const completed = items.filter(portalCompleted).length;
  const finalised = latestScan.reconciliation?.status === "complete";
  summary.textContent = `过去 7 天 · 已签到 ${completed} 节 · 找到代码 ${found}/${items.length}`;
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
    scanButton.disabled = false;
    scanButton.textContent = "核对超时，重试";
    detail.textContent = error.message;
    await refresh();
    return;
  }
  scanButton.disabled = false;
  scanButton.textContent = final?.ok ? "检查完成" : "核对失败，重试";
  await refresh();
});
document.querySelector("#review").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_REVIEW" }));
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.latestScan) refresh().catch(() => {});
});

refresh();
