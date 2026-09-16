import { clearDebugLog, logDebug, readDebugLog, sendMessageWithTimeout, weekBucket, weekPrefix } from "./shared.js";

const results = document.querySelector("#results");
const attended = document.querySelector("#attended");
const submit = document.querySelector("#submit");

function escapeHtml(value) { return String(value || "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }

function portalCompleted(item) {
  return Boolean(item?.completed)
    || item?.confidence === "completed"
    || /[?&]mah_completed=1(?:&|#|$)/.test(String(item?.entryUrl || ""));
}

// Staff sometimes publish next week's code days ahead of the actual class - useful to know,
// but Attendance itself will not accept it until the session has actually happened, and
// clicking it into "high confidence, ready to submit" before then is actively misleading.
// A class whose scheduled start time is still ahead of now must show as not-yet-started
// regardless of whether a code was already found for it.
function sessionStart(item) {
  const iso = item?.attendanceDate?.iso;
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  const match = /(\d{1,2}):(\d{2})\s*([ap])/i.exec(String(item?.time || ""));
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "p") hour += 12;
  return new Date(year, month - 1, day, hour, Number(match[2]), 0);
}

function isUpcomingSession(item, now = new Date()) {
  if (item?.upcoming) return true;
  const start = sessionStart(item);
  return Boolean(start) && start.getTime() > now.getTime();
}

function itemStatus(item) {
  const prefix = weekPrefix(weekBucket(item));
  if (portalCompleted(item)) return { key: "completed", label: `${prefix}已签到` };
  // A recurring class that hasn't started yet has nothing meaningful to submit, even if a
  // code was already found or the day itself has nothing on Attendance to scan yet - keep
  // that visually and textually distinct from an already-started class with a real gap.
  if (isUpcomingSession(item)) return { key: "upcoming", label: `${prefix}未开始` };
  if (item.confidence === "high") return { key: "high", label: `${prefix}高可信` };
  if (item.confidence === "review") return { key: "review", label: `${prefix}请核对` };
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
    const upcoming = status.key === "upcoming";
    const bucket = weekBucket(item);
    const codeLevel = codeConfidence(item);
    // A code found ahead of the class happening is real information worth keeping visible,
    // but Attendance will not accept it until the session is over, so it must never look
    // "ready to submit" - never auto-check it and never let the checkbox be enabled.
    const autoChecked = !completed && !upcoming && item.code && codeLevel === "high";
    const checkboxDisabled = completed || upcoming || !item.code;
    const context = completed
      ? (item.context || "Monash Attendance 已显示完成，无需再次提交。")
      : upcoming
        ? (item.code
          ? `已提前找到签到码，但这节课还没开始 —— Attendance 通常要等课程结束、签到入口开放后才能提交，请到时候再回来确认并提交。${item.context ? `（${item.context}）` : ""}`
          : "")
        : item.context;
    const codeText = completed
      ? (item.code ? escapeHtml(item.code) : "✓ 已完成")
      : escapeHtml(item.code || "—");
    const codeTitle = completed && item.code
      ? "已签到；同时保留已找到的签到码"
      : upcoming && item.code
        ? "已提前找到签到码，但还不能提交"
        : "";
    // A non-this-week class that is still "未找到" is not the normal wait-for-the-teacher
    // case - it usually means Attendance itself hasn't shown it as completed, or the scan
    // couldn't reach it. Make that distinction explicit instead of using the same generic
    // hint for both situations.
    const missingHint = upcoming
      ? "这节课还没到上课时间，Attendance 通常要到课程结束、签到入口开放后才能提交，请到时候再查。"
      : bucket === "thisWeek"
        ? "来源页面没有匹配到这个班次，老师可能还没发布签到码，请稍后再查。"
        : "来源页面没有匹配到这个班次，且 Attendance 也没显示已完成 —— 请手动打开来源确认是否真的漏签。";
    return `
    <article class="card ${completed ? "completed-card" : ""}">
      <div class="row"><label><input class="pick" data-id="${escapeHtml(item.id)}" type="checkbox" ${autoChecked ? "checked" : ""} ${checkboxDisabled ? "disabled" : ""}> ${escapeHtml(item.course)} · ${escapeHtml(item.session)}</label><span class="status ${status.key}">${status.label}</span></div>
      <div class="row"><p>${escapeHtml(item.day)} ${escapeHtml(item.time)}</p><span class="code ${(completed && !item.code) || upcoming ? "completed-code" : ""}" title="${escapeHtml(codeTitle)}">${codeText}</span></div>
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

  const debugLog = await readDebugLog();
  document.querySelector("#debugLogText").textContent = debugLog.length
    ? debugLog.map((entry) => `${entry.at}  ${entry.message}${entry.data !== undefined ? `  ${JSON.stringify(entry.data)}` : ""}`).join("\n")
    : "（还没有日志）";
}

function updateSubmit() {
  submit.disabled = !attended.checked || !document.querySelector(".pick:not(:disabled):checked");
}

attended.addEventListener("change", updateSubmit);
results.addEventListener("change", updateSubmit);
document.querySelector("#rescan").addEventListener("click", async () => {
  results.innerHTML = `<section class="card empty"><h2>正在查找…</h2><p>扫描 Gmail / Ed / Moodle，再直接读取 Attendance 完成状态和 Moodle 表格，全部完成后才会显示结果。</p></section>`;
  let scan;
  try {
    // Scanning and final reconciliation used to be two separate messages this page had to
    // send back to back. That meant this page's own JS had to survive long enough to send
    // the second one - fine while this tab stays open, but the equivalent flow in popup.js
    // was destroyed the moment the popup closed, silently dropping reconciliation entirely.
    // The background now chains both steps inside one SCAN_ALL call, so this page (and the
    // popup) only need to make one request and only need to survive until it resolves.
    await logDebug("review.js sending SCAN_ALL");
    scan = await sendMessageWithTimeout({ type: "SCAN_ALL" });
    await logDebug("review.js got SCAN_ALL response", { ok: scan?.ok, reconciliation: scan?.result?.reconciliation });
  } catch (error) {
    await logDebug("review.js SCAN_ALL threw/timed out", { message: error?.message });
    results.innerHTML = `<section class="card empty"><h2>扫描超时</h2><p>${escapeHtml(error.message)}</p></section>`;
    return;
  }
  if (!scan?.ok) {
    results.innerHTML = `<section class="card empty"><h2>扫描失败</h2><p>${escapeHtml(scan?.error || "未知错误")}</p></section>`;
    return;
  }
  await render();
  // Surface exactly why the final reconciliation didn't complete instead of quietly
  // falling back to the pre-reconciliation list - that fallback previously looked like
  // completed/upcoming classes had "disappeared" with no indication anything went wrong.
  if (scan.result?.reconciliation?.status === "failed") {
    const banner = document.createElement("section");
    banner.className = "card empty";
    banner.innerHTML = `<h2>最终核对未完成</h2><p>${escapeHtml(scan.result.reconciliation.error || "未知原因，Attendance 完成状态和历史签到码未合并。")}</p>`;
    results.prepend(banner);
  }
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

document.querySelector("#clearDebugLog").addEventListener("click", async () => {
  await clearDebugLog();
  await render();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.latestScan) return;
  const next = changes.latestScan.newValue;
  if (next?.reason === "manual" && next?.mode === "attendance-discovery" && next?.reconciliation?.version !== 4) return;
  render().then(updateSubmit).catch(() => {});
});

render().then(updateSubmit);
