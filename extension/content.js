// Must be read off the live, rendered body. innerText only produces line breaks for
// blocks and tabs between table cells when the element is actually laid out; on a
// detached clone it silently degrades to textContent, which glues every cell and
// paragraph together ("WorkshopWednesday, 9 Sep024:00PMSQP3R") and no code survives.
// Script/style/noscript aren't rendered, so innerText already excludes them.
function visibleText() {
  return document.body.innerText || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ed, Moodle and Attendance are all client-rendered apps: "tab finished loading" fires
// long before the page's own JS has fetched and rendered its actual content. Rather than
// betting on one fixed sleep that's either too short for a slow render or wastefully long
// for a fast one, poll the page's text length until it stops changing (or give up after
// maxMs) before reading anything out of the DOM.
async function waitForStablePage({ maxMs = 8000, stableMs = 700, intervalMs = 200, waitFor = "", minMs = 0 } = {}) {
  const start = Date.now();
  // "Text stopped changing" is also true while a spinner is spinning. When the caller
  // knows what the page's real content looks like (Gmail rows, Moodle unit cards, Ed
  // thread links), wait for that to exist first, then wait for the text to settle.
  if (waitFor) {
    while (Date.now() - start < maxMs && !document.querySelector(waitFor)) await sleep(intervalMs);
  }
  let last = null;
  let stableSince = Date.now();
  while (Date.now() - start < maxMs) {
    const current = document.body.innerText.length;
    if (current === last) {
      if (Date.now() - stableSince >= stableMs && Date.now() - start >= minMs) return;
    } else {
      last = current;
      stableSince = Date.now();
    }
    await sleep(intervalMs);
  }
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
  if (message.type === "READ_PAGE") {
    waitForStablePage({ maxMs: message.maxMs || 8000, waitFor: message.waitFor || "", minMs: message.minMs || 0 }).then(() => {
      const links = [...document.querySelectorAll("a[href]")].map((link) => ({
        label: (link.innerText || link.textContent || "").replace(/\s+/g, " ").trim(),
        href: link.href
      })).filter((item) => item.label && item.href);
      // Gmail's message list has no <a href> per message; each row carries the thread id
      // as a data attribute instead, and that id is enough to open the thread by URL.
      const gmailThreads = location.hostname === "mail.google.com"
        ? [...document.querySelectorAll("[data-legacy-thread-id],[data-thread-id]")].map((node) => {
          // Either the hex legacy id, or "#thread-f:<decimal>" which is the same number in base 10.
          const legacy = node.getAttribute("data-legacy-thread-id");
          const decimal = node.getAttribute("data-thread-id")?.match(/(\d{15,})/)?.[1];
          const id = legacy || (decimal ? BigInt(decimal).toString(16) : "");
          return { id, label: (node.closest("tr")?.innerText || node.innerText || "").replace(/\s+/g, " ").trim() };
        }).filter((thread) => thread.id)
        : [];
      sendResponse({
        ok: true,
        title: document.title,
        url: location.href,
        text: visibleText().slice(0, 750000),
        links,
        gmailThreads,
        loginRequired: /login|sign in|log in|okta/i.test(document.title + " " + location.href)
      });
    });
    return true;
  }

  if (message.type === "FIND_ATTENDANCE_SESSION") {
    waitForStablePage().then(() => {
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
    });
    return true;
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
