import { sendMessageWithTimeout, weekBucket, weekPrefix } from "./shared.js";

const results = document.querySelector("#results");
const attended = document.querySelector("#attended");
const submit = document.querySelector("#submit");

function escapeHtml(value) { return String(value || "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }

function portalCompleted(item) {
  return Boolean(item?.completed)
    || item?.confidence === "completed"
    || /[?&]mah_completed=1(?:&|#|$)/.test(String(item?.entryUrl || ""));
}

function itemStatus(item) {
  const prefix = weekPrefix(weekBucket(item));
  if (portalCompleted(item)) return { key: "completed", label: `${prefix}已签到` };
  if (item.confidence === "high") return { key: "high", label: `${prefix}高可信` };
  if (item.confidence === "review") return { key: "review", label: `${prefix}请核对` };
  // A recurring class whose day this week hasn't arrived yet has nothing to scan - it isn't
  // missing, it just doesn't exist on Attendance yet. Keep that visually and textually
  // distinct from a day that already passed with nothing found for it.
  if (item.upcoming) return { key: "upcoming", label: `${prefix}未开始` };
  return { key: "missing", label: `${prefix}未找到` };
}

function codeConfidence(item) {
  if (item.codeConfidence === "high" || item.codeConfidence === "review") return item.codeConfidence;
  if (item.code && (item.confidence === "high" || item.confidence === "review")) return item.confidence;
  return "missing";
}

function attendanceSource(item) {
  if (item.attendanceSourceUrl) return item.attendanceSourceUrl;
  if (portalCompleted(item) && item.attendanceDate?.key) {
    return `https://attendance.monash.edu.my/student/Units.aspx#${encodeURIComponent(item.attendanceDate.key)}`;
  }
  return "";
}

function sourceLinks(item, completed) {
  const links = [];
  const seen = new Set();
  const add = (url, label) => {
    const value = String(url || "");
    if (!value || seen.has(value)) return;
    seen.add(value);
    links.push(`<a href="${escapeHtml(value)}" target="_blank">${label} ↗</a>`);
  };
  if (completed) add(attendanceSource(item), "打开 Attendance");
  add(item.codeSourceUrl, "打开代码来源");
  if (!links.length) add(item.sourceUrl, completed ? "打开 Attendance" : "打开来源");
  return links.length ? `<div class="source-links">${links.join(" · ")}</div>` : "";
}

async function render() {
  const { latestScan } = await chrome.storage.local.get("latestScan");
  if (!latestScan) {
    results.innerHTML = `<section class="card empty"><h2>还没有检查结果</h2><p>点击“重新查找”，扩展会打开已登录的课程页面并读取本周代码。</p></section>`;
    return;
  }
  document.querySelector("#title").textContent = latestScan.week ? `Week ${latestScan.week} 签到确认` : "过去一周签到确认";
  const items = latestScan.items || [];
  const completedCount = items.filter(portalCompleted).length;
  const foundCodeCount = items.filter((item) => item.code && codeConfidence(item) === "high").length;
  let reconciliationNote = "";
  if (latestScan.reconciliation?.status === "complete") {
    reconciliationNote = ` · 已签到 ${completedCount} 节 · 已找到代码 ${foundCodeCount}/${items.length} · 最终核对完成`;
  } else if (latestScan.reconciliation?.status === "failed") {
    reconciliationNote = ` · 最终核对失败：${latestScan.reconciliation.error || "未知错误"}`;
  }
  document.querySelector("#subtitle").textContent = `检查时间：${new Date(latestScan.scannedAt).toLocaleString("zh-CN")} · 扩展版本 v${chrome.runtime.getManifest().version}${reconciliationNote}`;
  results.innerHTML = items.map((item) => {
    const status = itemStatus(item);
    const completed = status.key === "completed";
    const bucket = weekBucket(item);
    const codeLevel = codeConfidence(item);
    const autoChecked = !completed && item.code && codeLevel === "high";
    const checkboxDisabled = completed || !item.code;
    const context = completed
      ? (item.context || "Monash Attendance 已显示完成，无需再次提交。")
      : item.context;
    const codeText = completed
      ? (item.code ? escapeHtml(item.code) : "✓ 已完成")
      : escapeHtml(item.code || "—");
    const codeTitle = completed && item.code ? "已签到；同时保留已找到的签到码" : "";
    // A non-this-week class that is still "未找到" is not the normal wait-for-the-teacher
    // case - it usually means Attendance itself hasn't shown it as completed, or the scan
    // couldn't reach it. Make that distinction explicit instead of using the same generic
    // hint for both situations.
    const missingHint = item.upcoming
      ? "这节课本周还没到上课时间，Attendance 通常要到上课当天才会显示签到入口，请等到那天之后再查。"
      : bucket === "thisWeek"
        ? "来源页面没有匹配到这个班次，老师可能还没发布签到码，请稍后再查。"
        : "来源页面没有匹配到这个班次，且 Attendance 也没显示已完成 —— 请手动打开来源确认是否真的漏签。";
    return `
    <article class="card ${completed ? "completed-card" : ""}">
      <div class="row"><label><input class="pick" data-id="${escapeHtml(item.id)}" type="checkbox" ${autoChecked ? "checked" : ""} ${checkboxDisabled ? "disabled" : ""}> ${escapeHtml(item.course)} · ${escapeHtml(item.session)}</label><span class="status ${status.key}">${status.label}</span></div>
      <div class="row"><p>${escapeHtml(item.day)} ${escapeHtml(item.time)}</p><span class="code ${completed && !item.code ? "completed-code" : ""}" title="${escapeHtml(codeTitle)}">${codeText}</span></div>
      ${context ? `<div class="context">${escapeHtml(context)}</div>` : `<p class="muted">${missingHint}</p>`}
      ${sourceLinks(item, completed)}
    </article>`;
  }).join("");

  const scans = latestScan.scans || [];
  const scanLog = document.querySelector("#scanLog");
  scanLog.hidden = !scans.length && !(latestScan.discoveryErrors || []).length;
  document.querySelector("#scanList").innerHTML = [
    ...(latestScan.discoveryErrors || []).map((error) => `<li class="scan-failed">Attendance：${escapeHtml(error)}</li>`),
    ...scans.map((scan) => `<li class="${scan.ok ? "scan-ok" : "scan-failed"}">${scan.ok ? "✓" : "✗"} <a href="${escapeHtml(scan.url)}" target="_blank">${escapeHtml(scan.url)}</a>${scan.ok
      ? ` · ${scan.textLength ?? 0} 字 · ${scan.linkCount ?? 0} 链接${scan.courses?.length ? ` · 课程 ${scan.courses.map((course) => escapeHtml(String(course).toUpperCase())).join("/")}` : ""}${scan.structuredRowCount ? ` · ${scan.structuredRowCount} 条结构化签到记录` : ""}${scan.completedRowCount ? ` · ${scan.completedRowCount} 条已签到` : ""}${scan.imageCount ? ` · ${scan.imageCount} 张候选图 / ${scan.ocrSelectedCount ?? 0} 张送入OCR（${scan.ocrLength ?? 0} 字）` : ""}${scan.ocrError ? ` · OCR失败：${escapeHtml(scan.ocrError)}` : ""}${scan.threadCount ? ` · ${scan.threadCount} 封邮件` : ""} · ${scan.codeLikeCount ?? 0} 个疑似代码${scan.excerpt ? ` <details><summary>查看抓到的文字</summary><pre class="excerpt">${escapeHtml(scan.excerpt)}</pre></details>` : ""}${scan.ocrDetails?.length ? ` <details><summary>查看逐图 OCR</summary>${scan.ocrDetails.map((detail) => `<pre class="excerpt">图片 ${detail.index}${detail.width || detail.height ? ` · ${detail.width || "?"}×${detail.height || "?"}` : ""}${detail.src ? ` · ${escapeHtml(detail.src)}` : ""}\n${escapeHtml(detail.text || detail.error || "（无文字）")}${detail.passes?.length ? `\n\n--- OCR passes ---\n${detail.passes.map((pass) => `[${escapeHtml(pass.label)}]\n${escapeHtml(pass.text || "（无文字）")}`).join("\n\n")}` : ""}</pre>`).join("")}</details>` : ""}`
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
  let scan;
  try {
    scan = await sendMessageWithTimeout({ type: "SCAN_ALL" });
  } catch (error) {
    results.innerHTML = `<section class="card empty"><h2>扫描超时</h2><p>${escapeHtml(error.message)}</p></section>`;
    return;
  }
  if (!scan?.ok) {
    results.innerHTML = `<section class="card empty"><h2>扫描失败</h2><p>${escapeHtml(scan?.error || "未知错误")}</p></section>`;
    return;
  }
  results.innerHTML = `<section class="card empty"><h2>正在做最终核对…</h2><p>正在核对已签到课程，并按日期 / 班号 / 时间补充历史签到码。</p></section>`;
  let final;
  try {
    final = await sendMessageWithTimeout({ type: "RUN_FINAL_RECONCILIATION" });
  } catch (error) {
    // The background reconciliation may still be running even though the client gave up
    // waiting on it; re-rendering here would silently overwrite this message with the
    // not-yet-reconciled data and make the timeout invisible. Leave it on screen instead -
    // the user can re-open this page (or click 重新查找 again) once it has had time to finish.
    results.innerHTML = `<section class="card empty"><h2>最终核对超时</h2><p>${escapeHtml(error.message)}。后台可能仍在继续核对，请稍等片刻后重新打开本页面，或再次点击"重新查找"。</p></section>`;
    return;
  }
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
  const items = latestScan.items.filter((item) => !portalCompleted(item) && selectedIds.has(item.id));
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
  if (next?.reason === "manual" && next?.mode === "attendance-discovery" && next?.reconciliation?.version !== 4) return;
  render().then(updateSubmit).catch(() => {});
});

render().then(updateSubmit);
