const summary = document.querySelector("#summary");
const detail = document.querySelector("#detail");
const scanButton = document.querySelector("#scan");

async function refresh() {
  const { latestScan } = await chrome.storage.local.get("latestScan");
  if (!latestScan) {
    summary.textContent = "尚未检查本周签到码";
    detail.textContent = "到设定时间会自动检查，你也可以现在运行。";
    return;
  }
  const found = latestScan.items.filter((item) => item.code).length;
  summary.textContent = `Week ${latestScan.week ?? "—"} · 找到 ${found}/${latestScan.items.length} 个`;
  detail.textContent = `上次检查：${new Date(latestScan.scannedAt).toLocaleString("zh-CN")}`;
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  scanButton.textContent = "正在查找…";
  const response = await chrome.runtime.sendMessage({ type: "SCAN_ALL" });
  scanButton.disabled = false;
  scanButton.textContent = response.ok ? "检查完成" : "重试";
  await refresh();
});
document.querySelector("#review").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_REVIEW" }));
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.latestScan) refresh().catch(() => {});
});

refresh();
