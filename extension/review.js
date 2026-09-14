const results = document.querySelector("#results");
const attended = document.querySelector("#attended");
const submit = document.querySelector("#submit");

function escapeHtml(value) { return String(value || "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }

function itemStatus(item) {
  if (item.completed || item.confidence === "completed") return { key: "completed", label: "已签到" };
  if (item.confidence === "high") return { key: "high", label: "高可信" };
  if (item.confidence === "review") return { key: "review", label: "请核对" };
  return { key: "missing", label: "未找到" };
}

async function render() {
  const { latestScan } = await chrome.storage.local.get("latestScan");
  if (!latestScan) {
    results.innerHTML = `<section class="card empty"><h2>还没有检查结果</h2><p>点击“重新查找”，扩展会打开已登录的课程页面并读取本周代码。</p></section>`;
    return;
  }
  document.querySelector("#title").textContent = latestScan.week ? `Week ${latestScan.week} 签到确认` : "过去一周签到确认";
  const completedCount = (latestScan.items || []).filter((item) => item.completed || item.confidence === "completed").length;
  let reconciliationNote = "";
  if (latestScan.reconciliation?.status === "complete") {
    reconciliationNote = ` · 已签到 ${completedCount} 节 · 最终核对完成`;
  } else if (latestScan.reconciliation?.status === "failed") {
    reconciliationNote = ` · 最终核对失败：${latestScan.reconciliation.error || "未知错误"}`;
  }
  document.querySelector("#subtitle").textContent = `检查时间：${new Date(latestScan.scannedAt).toLocaleString("zh-CN")} · 扩展版本 v${chrome.runtime.getManifest().version}${reconciliationNote}`;
  results.innerHTML = latestScan.items.map((item) => {
    const status = itemStatus(item);
    const completed = status.key === "completed";
    const autoChecked = item.code && item.confidence === "high";
    const checkboxDisabled = completed || !item.code;
    const context = completed
      ? (item.context || "Monash Attendance 已显示完成，无需再次提交。")
      : item.context;
    const sourceLink = item.sourceUrl
      ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank">打开来源 ↗</a>`
      : "";
    return `
    <article class="card ${completed ? "completed-card" : ""}">
      <div class="row"><label><input class="pick" data-id="${escapeHtml(item.id)}" type="checkbox" ${autoChecked && !completed ? "checked" : ""} ${checkboxDisabled ? "disabled" : ""}> ${escapeHtml(item.course)} · ${escapeHtml(item.session)}</label><span class="status ${status.key}">${status.label}</span></div>
      <div class="row"><p>${escapeHtml(item.day)} ${escapeHtml(item.time)}</p><span class="code ${completed ? "completed-code" : ""}">${completed ? "✓ 已完成" : escapeHtml(item.code || "—")}</span></div>
      ${context ? `<div class="context">${escapeHtml(context)}</div>` : `<p class="muted">来源页面没有匹配到这个班次，请手动打开来源检查。</p>`}
      ${sourceLink}
    </article>`;
  }).join("");

  const scans = latestScan.scans || [];
  const scanLog = document.querySelector("#scanLog");
  scanLog.hidden = !scans.length && !(latestScan.discoveryErrors || []).length;
  document.querySelector("#scanList").innerHTML = [
    ...(latestScan.discoveryErrors || []).map((error) => `<li class="scan-failed">Attendance：${escapeHtml(error)}</li>`),
    ...scans.map((scan) => `<li class="${scan.ok ? "scan-ok" : "scan-failed"}">${scan.ok ? "✓" : "✗"} <a href="${escapeHtml(scan.url)}" target="_blank">${escapeHtml(scan.url)}</a>${scan.ok
      ? ` · ${scan.textLength ?? 0} 字 · ${scan.linkCount ?? 0} 链接${scan.courses?.length ? ` · 课程 ${scan.courses.map((course) => escapeHtml(String(course).toUpperCase())).join("/")}` : ""}${scan.structuredRowCount ? ` · ${scan.structuredRowCount} 条结构化签到记录` : ""}${scan.imageCount ? ` · ${scan.imageCount} 张候选图 / ${scan.ocrSelectedCount ?? 0} 张送入OCR（${scan.ocrLength ?? 0} 字）` : ""}${scan.ocrError ? ` · OCR失败：${escapeHtml(scan.ocrError)}` : ""}${scan.threadCount ? ` · ${scan.threadCount} 封邮件` : ""} · ${scan.codeLikeCount ?? 0} 个疑似代码${scan.excerpt ? ` <details><summary>查看抓到的文字</summary><pre class="excerpt">${escapeHtml(scan.excerpt)}</pre></details>` : ""}${scan.ocrDetails?.length ? ` <details><summary>查看逐图 OCR</summary>${scan.ocrDetails.map((detail) => `<pre class="excerpt">图片 ${detail.index}${detail.width || detail.height ? ` · ${detail.width || "?"}×${detail.height || "?"}` : ""}${detail.src ? ` · ${escapeHtml(detail.src)}` : ""}\n${escapeHtml(detail.text || detail.error || "（无文字）")}${detail.passes?.length ? `\n\n--- OCR passes ---\n${detail.passes.map((pass) => `[${escapeHtml(pass.label)}]\n${escapeHtml(pass.text || "（无文字）")}`).join("\n\n")}` : ""}</pre>`).join("")}</details>` : ""}`
      : ` · ${escapeHtml(scan.error || "失败")}`}</li>`)
  ].join("");
}

function updateSubmit() {
  submit.disabled = !attended.checked || !document.querySelector(".pick:not(:disabled):checked");
}

attended.addEventListener("change", updateSubmit);
results.addEventListener("change", updateSubmit);
document.querySelector("#rescan").addEventListener("click", async () => {
  results.innerHTML = `<section class="card empty"><h2>正在查找…</h2><p>先扫描 Gmail / Ed / Moodle，再直接读取 Attendance 完成状态和 Moodle 表格。完成最终核对后才会显示结果。</p></section>`;
  const scan = await chrome.runtime.sendMessage({ type: "SCAN_ALL" });
  if (!scan?.ok) {
    results.innerHTML = `<section class="card empty"><h2>扫描失败</h2><p>${escapeHtml(scan?.error || "未知错误")}</p></section>`;
    return;
  }
  results.innerHTML = `<section class="card empty"><h2>正在做最终核对…</h2><p>正在核对已签到课程，并按日期 / 班号 / 时间读取 Moodle Attendance 表格。</p></section>`;
  const final = await chrome.runtime.sendMessage({ type: "RUN_FINAL_RECONCILIATION" });
  if (!final?.ok) {
    await render();
    updateSubmit();
    return;
  }
  await render();
  updateSubmit();
});
submit.addEventListener("click", async () => {
  const { latestScan } = await chrome.storage.local.get("latestScan");
  const selectedIds = new Set([...document.querySelectorAll(".pick:not(:disabled):checked")].map((input) => input.dataset.id));
  const items = latestScan.items.filter((item) => !item.completed && item.confidence !== "completed" && selectedIds.has(item.id));
  if (!items.length) {
    document.querySelector("#submitStatus").textContent = "没有需要提交的签到记录。已签到课程不会重复提交。";
    updateSubmit();
    return;
  }
  submit.disabled = true;
  document.querySelector("#submitStatus").textContent = `正在提交 ${items.length} 条，请不要关闭新打开的 Attendance 标签页…`;
  const response = await chrome.runtime.sendMessage({ type: "SUBMIT_CODES", items });
  const successes = response.outcomes?.filter((item) => item.ok).length || 0;
  document.querySelector("#submitStatus").textContent = `已处理 ${successes}/${items.length} 条。请在 Attendance 页面核对成功提示和最终出勤率。`;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.latestScan) return;
  const next = changes.latestScan.newValue;
  // During a manual scan, do not replace the explicit "正在最终核对" state with the
  // intermediate one-code result. The rescan handler renders only after v2 finishes.
  if (next?.reason === "manual" && next?.mode === "attendance-discovery" && next?.reconciliation?.version !== 2) return;
  render().then(updateSubmit).catch(() => {});
});

render().then(updateSubmit);
