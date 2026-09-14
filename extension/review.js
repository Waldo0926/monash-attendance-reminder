const results = document.querySelector("#results");
const attended = document.querySelector("#attended");
const submit = document.querySelector("#submit");

function escapeHtml(value) { return String(value || "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }

async function render() {
  const { latestScan } = await chrome.storage.local.get("latestScan");
  if (!latestScan) {
    results.innerHTML = `<section class="card empty"><h2>还没有检查结果</h2><p>点击“重新查找”，扩展会打开已登录的课程页面并读取本周代码。</p></section>`;
    return;
  }
  document.querySelector("#title").textContent = latestScan.week ? `Week ${latestScan.week} 签到确认` : "过去一周签到确认";
  document.querySelector("#subtitle").textContent = `检查时间：${new Date(latestScan.scannedAt).toLocaleString("zh-CN")} · 扩展版本 v${chrome.runtime.getManifest().version}`;
  results.innerHTML = latestScan.items.map((item) => `
    <article class="card">
      <div class="row"><label><input class="pick" data-id="${escapeHtml(item.id)}" type="checkbox" ${item.code && item.confidence === "high" ? "checked" : ""} ${item.code ? "" : "disabled"}> ${escapeHtml(item.course)} · ${escapeHtml(item.session)}</label><span class="status ${item.confidence}">${item.confidence === "high" ? "高可信" : item.confidence === "review" ? "请核对" : "未找到"}</span></div>
      <div class="row"><p>${escapeHtml(item.day)} ${escapeHtml(item.time)}</p><span class="code">${escapeHtml(item.code || "—")}</span></div>
      ${item.context ? `<div class="context">${escapeHtml(item.context)}</div>` : `<p class="muted">来源页面没有匹配到这个班次，请手动打开来源检查。</p>`}
      <a href="${escapeHtml(item.sourceUrl)}" target="_blank">打开来源 ↗</a>
    </article>`).join("");

  const scans = latestScan.scans || [];
  const scanLog = document.querySelector("#scanLog");
  scanLog.hidden = !scans.length && !(latestScan.discoveryErrors || []).length;
  document.querySelector("#scanList").innerHTML = [
    ...(latestScan.discoveryErrors || []).map((error) => `<li class="scan-failed">Attendance：${escapeHtml(error)}</li>`),
    ...scans.map((scan) => `<li class="${scan.ok ? "scan-ok" : "scan-failed"}">${scan.ok ? "✓" : "✗"} <a href="${escapeHtml(scan.url)}" target="_blank">${escapeHtml(scan.url)}</a>${scan.ok
      ? ` · ${scan.textLength ?? 0} 字 · ${scan.linkCount ?? 0} 链接${scan.courses?.length ? ` · 课程 ${scan.courses.map((course) => escapeHtml(String(course).toUpperCase())).join("/")}` : ""}${scan.imageCount ? ` · ${scan.imageCount} 张候选图 / ${scan.ocrSelectedCount ?? 0} 张送入OCR（${scan.ocrLength ?? 0} 字）` : ""}${scan.ocrError ? ` · OCR失败：${escapeHtml(scan.ocrError)}` : ""}${scan.threadCount ? ` · ${scan.threadCount} 封邮件` : ""} · ${scan.codeLikeCount ?? 0} 个疑似代码${scan.excerpt ? ` <details><summary>查看抓到的文字</summary><pre class="excerpt">${escapeHtml(scan.excerpt)}</pre></details>` : ""}${scan.ocrDetails?.length ? ` <details><summary>查看逐图 OCR</summary>${scan.ocrDetails.map((detail) => `<pre class="excerpt">图片 ${detail.index}${detail.width || detail.height ? ` · ${detail.width || "?"}×${detail.height || "?"}` : ""}${detail.src ? ` · ${escapeHtml(detail.src)}` : ""}\n${escapeHtml(detail.text || detail.error || "（无文字）")}${detail.passes?.length ? `\n\n--- OCR passes ---\n${detail.passes.map((pass) => `[${escapeHtml(pass.label)}]\n${escapeHtml(pass.text || "（无文字）")}`).join("\n\n")}` : ""}</pre>`).join("")}</details>` : ""}`
      : ` · ${escapeHtml(scan.error || "失败")}`}</li>`)
  ].join("");
}

function updateSubmit() {
  submit.disabled = !attended.checked || !document.querySelector(".pick:checked");
}

attended.addEventListener("change", updateSubmit);
results.addEventListener("change", updateSubmit);
document.querySelector("#rescan").addEventListener("click", async () => {
  results.innerHTML = `<section class="card empty"><h2>正在查找…</h2><p>会短暂打开后台标签页。</p></section>`;
  await chrome.runtime.sendMessage({ type: "SCAN_ALL" });
  await render();
});
submit.addEventListener("click", async () => {
  const { latestScan } = await chrome.storage.local.get("latestScan");
  const selectedIds = new Set([...document.querySelectorAll(".pick:checked")].map((input) => input.dataset.id));
  const items = latestScan.items.filter((item) => selectedIds.has(item.id));
  submit.disabled = true;
  document.querySelector("#submitStatus").textContent = `正在提交 ${items.length} 条，请不要关闭新打开的 Attendance 标签页…`;
  const response = await chrome.runtime.sendMessage({ type: "SUBMIT_CODES", items });
  const successes = response.outcomes?.filter((item) => item.ok).length || 0;
  document.querySelector("#submitStatus").textContent = `已处理 ${successes}/${items.length} 条。请在 Attendance 页面核对成功提示和最终出勤率。`;
});
render();
