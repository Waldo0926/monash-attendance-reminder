(() => {
  if (location.hostname !== "attendance.monash.edu.my" || !/\/student\/Units\.aspx$/i.test(location.pathname)) return;

  const SYNTHETIC_ATTR = "data-mah-completed-session";
  const COURSE_RE = /\b[A-Z]{3}\d{4}\b/i;
  const TYPE_RE = /\b(workshop|tutorial|studio|applied(?:\s+class)?|practical|laboratory|lab|seminar)\b\s*0*(\d{1,2})?/i;
  const TIME_RE = /\b\d{1,2}:\d{2}\s*[ap]m\b/i;

  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function visible(node) {
    if (!(node instanceof Element)) return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && (node.getClientRects().length > 0 || node.offsetWidth > 0 || node.offsetHeight > 0);
  }

  function completionClue(value) {
    const clue = String(value || "").toLowerCase();
    if (/question|help|unknown|pending|incomplete/.test(clue)) return false;
    return /[✓✔☑]|(?:glyphicon|ui-icon|icon|fa|fas|far|fal|fab|bi)[-_ ]*(?:ok|check)(?:[-_ ]|\b)|\bcheck(?:ed|mark)?\b|\btick\b|\bcomplete(?:d)?\b|\bpresent\b|\bsuccess\b/.test(clue);
  }

  function selectedDateKey() {
    const hash = decodeURIComponent(location.hash || "").replace(/^#/, "").trim();
    return /^\d{1,2}_[A-Za-z]{3}_\d{2}$/.test(hash) ? hash : "";
  }

  function sessionDescriptor(text) {
    const course = COURSE_RE.exec(text)?.[0]?.toUpperCase() || "";
    const typeMatch = TYPE_RE.exec(text);
    const time = TIME_RE.exec(text)?.[0] || "";
    if (!course || !typeMatch || !time) return null;
    const number = typeMatch[2] ? Number(typeMatch[2]) : null;
    const type = typeMatch[1].replace(/\s+/g, " ");
    const session = `${type}${number !== null ? ` ${String(number).padStart(2, "0")}` : ""}`;
    return { course, session, time };
  }

  function rowClue(row) {
    const pieces = [row.innerText || row.textContent || ""];
    const descendants = row.querySelectorAll("[class],[data-icon],[title],[aria-label],img,svg,i,span");
    for (const node of [...descendants].slice(0, 80)) {
      pieces.push(
        node.getAttribute?.("class") || "",
        node.getAttribute?.("data-icon") || "",
        node.getAttribute?.("title") || "",
        node.getAttribute?.("aria-label") || "",
        node.getAttribute?.("alt") || "",
        node.getAttribute?.("src") || ""
      );
    }
    // jQuery Mobile frequently renders the green tick through class names / pseudo-elements;
    // keeping a bounded outerHTML slice catches those classes even when the icon has no text.
    pieces.push(String(row.outerHTML || "").slice(0, 6000));
    return compact(pieces.join(" "));
  }

  function candidateRows() {
    const selectors = [
      "li",
      "tr",
      "[role='listitem']",
      "[class*='ui-li']",
      "[class*='row']",
      "[class*='activity']"
    ];
    return [...new Set(document.querySelectorAll(selectors.join(",")))];
  }

  function injectCompletedSessions() {
    const dateKey = selectedDateKey();
    if (!dateKey) return;

    for (const existing of document.querySelectorAll(`a[${SYNTHETIC_ATTR}]`)) {
      if (existing.getAttribute(SYNTHETIC_ATTR) !== dateKey) existing.remove();
    }

    const already = new Set(
      [...document.querySelectorAll(`a[${SYNTHETIC_ATTR}='${CSS.escape(dateKey)}']`)]
        .map((anchor) => anchor.dataset.mahIdentity || "")
        .filter(Boolean)
    );

    for (const row of candidateRows()) {
      if (!visible(row)) continue;
      const text = compact(row.innerText || row.textContent);
      if (!text || text.length > 700) continue;
      const descriptor = sessionDescriptor(text);
      if (!descriptor) continue;

      // Pending Attendance rows already have their real Entry.aspx link. Never replace or
      // duplicate those; the synthetic link exists only to keep completed rows discoverable.
      if (row.querySelector("a[href*='Entry.aspx']")) continue;
      if (!completionClue(rowClue(row))) continue;

      const identity = `${descriptor.course}|${descriptor.session.toLowerCase()}|${descriptor.time.toLowerCase()}`;
      if (already.has(identity)) continue;

      const synthetic = document.createElement("a");
      const url = new URL(location.href);
      url.searchParams.set("d", dateKey);
      url.searchParams.set("mah_completed", "1");
      url.hash = "Entry.aspx-completed";
      synthetic.href = url.href;
      synthetic.textContent = `${descriptor.time} ${descriptor.course} ${descriptor.session}`;
      synthetic.setAttribute(SYNTHETIC_ATTR, dateKey);
      synthetic.dataset.mahIdentity = identity;
      synthetic.setAttribute("aria-hidden", "true");
      synthetic.tabIndex = -1;
      synthetic.style.display = "none";
      row.appendChild(synthetic);
      already.add(identity);
    }
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(injectCompletedSessions, 120);
  }

  schedule();
  window.addEventListener("hashchange", schedule, { passive: true });
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "aria-label", "title"] });
})();
