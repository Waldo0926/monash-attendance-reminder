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

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// Gmail Search can default to "Most relevant", which is a bad fit for attendance codes:
// we normally want the latest Week N announcement first, then exact date matching decides
// whether it belongs to the Attendance row. This is deliberately best-effort because Gmail
// changes its DOM frequently; failure simply leaves the existing ranking logic in place.
async function preferGmailMostRecent() {
  if (location.hostname !== "mail.google.com" || !/#search\//i.test(location.hash)) return false;
  const bodyText = compactText(document.body.innerText);
  if (/showing\s+most\s+recent|\bmost\s+recent\b/i.test(bodyText) && !/showing\s+most\s+relevant/i.test(bodyText)) return false;

  const controls = [...document.querySelectorAll("[role='button'], button, [aria-haspopup='menu']")];
  const dropdown = controls.find((node) => {
    const text = compactText(`${node.innerText || node.textContent || ""} ${node.getAttribute?.("aria-label") || ""}`);
    return /showing\s+most\s+relevant|\bmost\s+relevant\b|最相关/i.test(text);
  });
  if (!dropdown) return false;

  try {
    dropdown.click();
    await sleep(300);
    const options = [...document.querySelectorAll("[role='menuitem'], [role='menuitemradio'], [role='option']")];
    const recent = options.find((node) => /\bmost\s+recent\b|最新/i.test(compactText(node.innerText || node.textContent)));
    if (!recent) return false;
    recent.click();
    await sleep(700);
    return true;
  } catch {
    return false;
  }
}

// Ed's discussion list only renders its ~30 most recent threads by default and hides the
// rest behind a "加载更多" ("Load more") button. Confirmed by hand against the real FIT2102
// course: with nothing clicked, weeks 1-6's "Attendance Codes" threads simply do not exist
// in the DOM at all - no amount of fixing which links get selected afterwards can find a
// thread that was never scraped. Clicking that button repeatedly pages in the course's full
// history (verified: 9 clicks took one real course from 24 to 278 discussion links and
// surfaced every one of Week 1 through Week 8's attendance threads). Bounded well past what
// a normal semester needs so this can't spin forever on a course with unusually deep history.
async function expandEdDiscussionList() {
  if (location.hostname !== "edstem.org" || !/\/courses\/\d+\/discussion(\/|$)/.test(location.pathname)) return false;
  let clicked = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const button = [...document.querySelectorAll("button")].find((node) => /加载更多|load\s*more/i.test(node.innerText || node.textContent || ""));
    if (!button) break;
    try {
      button.click();
      clicked = true;
      await sleep(700);
    } catch {
      break;
    }
  }
  return clicked;
}

function moodleAttendanceLinkCandidates(links) {
  if (location.hostname !== "learning.monash.edu") return [];
  const seen = new Map();
  for (const link of links || []) {
    let url;
    try {
      url = new URL(link.href, location.href);
    } catch {
      continue;
    }
    if (url.origin !== location.origin || !/\/mod\//i.test(url.pathname)) continue;
    const clue = compactText(`${link.label || ""} ${link.context || ""}`);
    if (!/attendance/i.test(clue)) continue;

    let score = 10;
    if (/attendance\s+codes?|attendance\s+code/i.test(clue)) score += 100;
    if (/international\s+student/i.test(clue)) score += 30;
    if (/\bweek\s*\d{1,2}\b/i.test(clue)) score += 15;
    if (/policy|requirement|guideline/i.test(clue) && !/codes?/i.test(clue)) score -= 25;
    const href = url.href.split("#")[0];
    const previous = seen.get(href);
    if (!previous || score > previous.score) seen.set(href, { href, score, clue });
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 3);
}

function readableDetachedDocument(doc) {
  const lines = [];
  const seen = new Set();
  const add = (value) => {
    const text = compactText(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push(text);
  };

  add(doc.title);
  for (const node of doc.querySelectorAll("h1,h2,h3,h4,p,li,tr")) {
    if (node.tagName === "TR") {
      const cells = [...node.querySelectorAll(":scope > th, :scope > td")].map((cell) => compactText(cell.textContent)).filter(Boolean);
      if (cells.length) add(cells.join(" | "));
      else add(node.textContent);
    } else {
      add(node.textContent);
    }
    if (lines.join("\n").length >= 120000) break;
  }
  return lines.join("\n").slice(0, 120000);
}

// Some Moodle units (TRC2001 is a real example) put no code on the weekly section itself.
// The bottom of Week N instead contains an "International Student Attendance Codes" forum
// link; the actual Workshop/Lab table is one click deeper. Follow only same-origin Moodle
// activity links whose surrounding text says Attendance, and append their structured text to
// the current page so the normal strict date/time/session matcher can process it safely.
async function fetchMoodleAttendancePages(links) {
  const candidates = moodleAttendanceLinkCandidates(links);
  if (!candidates.length) return "";
  const pages = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.href, { credentials: "include", redirect: "follow" });
      if (!response.ok || /login|saml|okta/i.test(response.url)) continue;
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const text = readableDetachedDocument(doc);
      if (text) pages.push(`Moodle linked attendance source: ${candidate.href}\n${text}`);
    } catch {
      // A linked activity can be unavailable or client-rendered. Do not fail the whole scan;
      // the service worker will still continue with Ed/Moodle fallbacks and manual review.
    }
  }
  return pages.join("\n").slice(0, 240000);
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

function snapshotImageAsPng(image) {
  try {
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return "";
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return "";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    // This intentionally throws for a cross-origin image without CORS permission. That is
    // fine: ocr.js will then fetch the URL and use Chromium to decode/convert it there.
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "READ_PAGE") {
    (async () => {
      await waitForStablePage({ maxMs: message.maxMs || 8000, waitFor: message.waitFor || "", minMs: message.minMs || 0 });
      if (await preferGmailMostRecent()) {
        await waitForStablePage({ maxMs: 5000, stableMs: 600, intervalMs: 200, minMs: 500 });
      }
      if (await expandEdDiscussionList()) {
        await waitForStablePage({ maxMs: 5000, stableMs: 600, intervalMs: 200, minMs: 300 });
      }
      const links = [...document.querySelectorAll("a[href]")].map((link) => {
        const label = (link.innerText || link.textContent || "").replace(/\s+/g, " ").trim();
        let context = label;
        let parent = link.parentElement;
        // Ed sometimes renders the course/thread title beside the clickable anchor rather
        // than inside it. Keep a short nearby DOM context so discovery can still associate
        // the URL with FITxxxx / "Attendance Codes" without swallowing the whole sidebar.
        for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
          const text = (parent.innerText || parent.textContent || "").replace(/\s+/g, " ").trim();
          if (text && text.length <= 420) {
            context = text;
            if (text.length > label.length + 8) break;
          }
        }
        return { label, context, href: link.href };
      }).filter((item) => item.label && item.href);
      const linkedMoodleAttendanceText = await fetchMoodleAttendancePages(links);
      const edDiscussionPage = location.hostname === "edstem.org" && /\/courses\/\d+\/discussion\/\d+/.test(location.pathname);
      const minImageHeight = edDiscussionPage ? 20 : 60;
      const minImageWidth = edDiscussionPage ? 180 : 240;
      const images = [...document.images]
        .filter((image) => (image.naturalWidth || image.width || 0) >= minImageWidth && (image.naturalHeight || image.height || 0) >= minImageHeight)
        .map((image) => {
          const src = image.currentSrc || image.src;
          let context = image.alt || "";
          let parent = image.parentElement;
          for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
            const text = (parent.innerText || parent.textContent || "").replace(/\s+/g, " ").trim();
            if (text && text.length <= 360) {
              context = text;
              if (/attendance|code|workshop|tutorial|studio|week\s*\d+/i.test(text)) break;
            }
          }
          return {
            src,
            alt: image.alt || "",
            context,
            width: image.naturalWidth || image.width || 0,
            height: image.naturalHeight || image.height || 0,
            // blob: URLs are tied to the live Ed page and may be unusable after readPage
            // closes its background tab. Snapshot those ephemeral images before closing.
            dataUrl: src.startsWith("blob:") ? snapshotImageAsPng(image) : ""
          };
        }).filter((image) => image.src);
      // Ed can render a very short one-row attachment (for example the FIT2102 Workshop
      // row) in a wrapper where the <img> is lazy/undersized while the attachment href is
      // already present. Add direct edusercontent attachment links as OCR fallbacks so a
      // single-line code image cannot disappear merely because its rendered thumbnail is
      // shorter than the general image threshold.
      if (edDiscussionPage) {
        const known = new Set(images.map((image) => image.src));
        for (const anchor of document.querySelectorAll("a[href*='edusercontent.com/files/']")) {
          const src = anchor.href;
          if (!src || known.has(src)) continue;
          const text = (anchor.closest("article, [role='article'], div")?.innerText || anchor.innerText || "").replace(/\s+/g, " ").trim().slice(0, 360);
          images.push({ src, alt: anchor.getAttribute("aria-label") || "", context: text, width: 1200, height: 40, dataUrl: "", attachmentFallback: true });
          known.add(src);
        }
      }
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
        text: [visibleText(), linkedMoodleAttendanceText].filter(Boolean).join("\n").slice(0, 750000),
        links,
        images,
        gmailThreads,
        linkedMoodleAttendance: Boolean(linkedMoodleAttendanceText),
        loginRequired: /login|sign in|log in|okta/i.test(document.title + " " + location.href)
      });
    })();
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