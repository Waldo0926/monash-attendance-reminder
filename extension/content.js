function visibleText() {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll("script,style,noscript,svg").forEach((node) => node.remove());
  return clone.innerText || clone.textContent || "";
}

function setNativeValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(input.constructor.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findAttendanceInput() {
  const inputs = [...document.querySelectorAll("input")].filter((input) => {
    const type = (input.type || "text").toLowerCase();
    return !input.disabled && !input.readOnly && ["text", "search", "tel"].includes(type);
  });
  return inputs.find((input) => /attendance|code/i.test(`${input.placeholder} ${input.name} ${input.id}`)) || inputs[0];
}

function findSubmitButton(input) {
  const form = input.closest("form");
  const candidates = [...(form || document).querySelectorAll("button,input[type=submit],input[type=button],a")];
  return candidates.find((node) => /submit|enter|confirm|record|签到|提交/i.test(`${node.innerText || ""} ${node.value || ""} ${node.title || ""}`));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SCAN_SOURCE") {
    sendResponse({
      ok: true,
      title: document.title,
      url: location.href,
      text: visibleText().slice(0, 750000),
      loginRequired: /login|sign in|log in|okta/i.test(document.title + " " + location.href)
    });
    return;
  }

  if (message.type === "DISCOVER_ATTENDANCE_SESSIONS") {
    const links = [...document.querySelectorAll("a[href*='Entry.aspx']")].map((link) => ({
      label: (link.innerText || link.textContent || "").replace(/\s+/g, " ").trim(),
      href: link.href
    })).filter((item) => item.label && item.href);
    sendResponse({ ok: true, title: document.title, url: location.href, links });
    return;
  }

  if (message.type === "DISCOVER_COURSE_LINKS") {
    const codes = (message.courseCodes || []).map((item) => String(item).toLowerCase());
    const links = [...document.querySelectorAll("a[href]")].map((link) => ({
      label: (link.innerText || link.textContent || "").replace(/\s+/g, " ").trim(),
      href: link.href
    })).filter((item) => codes.some((code) => `${item.label} ${item.href}`.toLowerCase().includes(code)));
    sendResponse({ ok: true, links });
    return;
  }

  if (message.type === "FIND_ATTENDANCE_SESSION") {
    const targetCourse = String(message.course || "").toLowerCase();
    const targetSession = String(message.attendanceLabel || message.session || "").toLowerCase().replace(/\b0+(\d+)\b/g, "$1");
    const links = [...document.querySelectorAll("a[href*='Entry.aspx']")];
    const match = links.find((link) => {
      const text = (link.innerText || link.textContent || "").toLowerCase().replace(/\b0+(\d+)\b/g, "$1");
      return text.includes(targetCourse) && text.includes(targetSession);
    });
    sendResponse(match
      ? { ok: true, href: match.href, label: match.innerText || match.textContent }
      : { ok: false, error: `找不到 ${message.course} ${message.session} 的 Attendance 班次` });
    return;
  }

  if (message.type === "FILL_ATTENDANCE_CODE") {
    const input = findAttendanceInput();
    if (!input) {
      sendResponse({ ok: false, error: "找不到签到码输入框" });
      return;
    }
    input.focus();
    setNativeValue(input, message.code);
    const button = findSubmitButton(input);
    if (!button) {
      sendResponse({ ok: false, error: "已填入代码，但找不到提交按钮", filled: true });
      return;
    }
    if (message.commit === true) button.click();
    sendResponse({ ok: true, filled: true, submitted: message.commit === true });
    return;
  }
});
