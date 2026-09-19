import { ATTENDANCE_URL, DEFAULT_SETTINGS, attendanceDate, courseCodesInText, detectWeekOneMonday, edThreadLinks, extractCandidates, findCourseLinks, hasUsableConfig, inferWeekNumbersFromText, loadSettings, logDebug, matchCodesToAttendance, moodleWeekLinks, parseDateKey, pickWeekNumbers, recentAttendanceDates, scopedAttendanceItems, teachingWeek } from "./shared.js";
import { gmailSearchBounds, pickGmailBase, prioritiseGmailThreads } from "./gmail-source.js";
import { EVIDENCE_CACHE_KEY, readAttendancePortal, reconcileAndStore } from "./reconciliation-v3.js";
import { buildCodeEvidenceCache, mergePortalAttendance, needsCodeEvidence, projectHistoricalSessions, restoreCodeEvidence } from "./reconciliation-core.js";

const PRIMARY_ALARM = "attendance-primary";
const BACKUP_ALARM = "attendance-backup";

// Groups an ISO date string by the Monday that starts its week, so automaticSourceScans can
// run one Gmail search per week instead of one across a whole semester export - see the
// comment above its weekBuckets loop for why that matters.
function weekBucketKey(iso) {
  const date = new Date(`${iso || ""}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

function nextAlarm(weekday, hour, minute) {
  const now = new Date();
  const target = new Date(now);
  const days = (weekday - now.getDay() + 7) % 7;
  target.setDate(now.getDate() + days);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target.getTime();
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function configureAlarms() {
  const settings = await loadSettings();
  await chrome.alarms.clearAll();
  if (!hasUsableConfig(settings)) return;

  await chrome.alarms.create(PRIMARY_ALARM, {
    when: nextAlarm(settings.reminder.weekday, settings.reminder.hour, settings.reminder.minute),
    periodInMinutes: 10080
  });
  if (settings.backup.enabled) {
    await chrome.alarms.create(BACKUP_ALARM, {
      when: nextAlarm(settings.backup.weekday, settings.backup.hour, settings.backup.minute),
      periodInMinutes: 10080
    });
  }
}

async function waitForLoaded(tabId, timeoutMs = 25000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === "complete") {
    await pause(1200);
    return;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("页面加载超时"));
    }, timeoutMs);
    const listener = (updatedId, info) => {
      if (updatedId === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1200);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function confidenceRank(confidence) {
  return confidence === "high" ? 2 : confidence === "review" ? 1 : 0;
}

// Match against each source page separately rather than one concatenated blob: joining texts
// together let a code found near the end of one page's content "see" course names from the
// start of the next page as nearby context, producing confident-looking matches that were
// really just two unrelated pages bleeding into each other. Shared by the normal weekly scan
// and the full-semester history export.
function mergeSourceScanCodes(items, sourceScans) {
  let result = items;
  for (const scan of sourceScans) {
    if (!scan.ok) continue;
    const scoped = safeScopedAttendanceItems(result, scan);
    if (!scoped.length) continue;
    const matched = matchCodesToAttendance(scan.text, scoped.map(({ item }) => item));
    const replacements = new Map();
    matched.forEach((candidate, scopedIndex) => {
      const index = scoped[scopedIndex].index;
      const item = result[index];
      if (candidate.code && confidenceRank(candidate.confidence) > confidenceRank(item.confidence)) {
        // codeConfidence must move together with confidence here. codeConfidenceOf() already
        // falls back to `confidence` when `code` is set, so the in-extension logic (needing
        // evidence, deciding what to cache) was never actually broken by this - but options.js's
        // CSV export reads `item.codeConfidence || item.confidence` directly, and every fresh
        // item starts life with codeConfidence: "missing" (see mergePortalAttendance). Leaving
        // that stale "missing" string in place after a code is matched here made the exported
        // history show "missing" for a row that clearly has a code in the very next column,
        // for any code found this way rather than restored from the evidence cache.
        replacements.set(index, { ...item, code: candidate.code, confidence: candidate.confidence, codeConfidence: candidate.confidence, context: candidate.context, sourceUrl: scan.url });
      }
    });
    result = result.map((item, index) => replacements.get(index) || item);
  }
  return result;
}

function unitScopedSource(url) {
  return /edstem\.org\/au\/courses\/\d+\//i.test(String(url || ""))
    || /learning\.monash\.edu\/course\/view\.php/i.test(String(url || ""));
}

function safeScopedAttendanceItems(items, page) {
  // A unit-specific Ed/Moodle page with unknown ownership is unsafe to match globally.
  // Gmail/search pages are intentionally allowed to span multiple units.
  if (unitScopedSource(page?.url) && !(page?.courses || []).length) return [];
  return scopedAttendanceItems(items, page?.courses);
}

function sessionName(label, course) {
  const withoutCourse = String(label || "").replace(new RegExp(course, "ig"), " ").replace(/\s+/g, " ").trim();
  const match = withoutCourse.match(/(workshop|tutorial|studio|applied(?: class)?|practical|laboratory|lab|seminar)[^|·,;]*/i);
  return (match?.[0] || withoutCourse || "Scheduled activity").trim();
}

// Opens a page in a background tab, lets content.js wait for it to finish rendering,
// and returns its visible text plus every link on it. Never throws.
async function readPage(url, { maxMs, waitFor, minMs } = {}) {
  // Reuse an already-open exact page whenever possible. Apart from being faster, this
  // stops a scan from creating a second copy of the Ed/Moodle tab the student is already
  // looking at. Only tabs created by the scanner are closed afterwards.
  const existing = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
  const tab = existing || await chrome.tabs.create({ url, active: false });
  const owned = !existing;
  try {
    await waitForLoaded(tab.id);
    let page;
    try {
      page = await chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", maxMs, waitFor, minMs });
    } catch (error) {
      // After an extension reload, tabs that were already open do not automatically get the
      // new content script. Inject it on demand before giving up on an otherwise usable tab.
      if (!/receiving end|could not establish connection/i.test(String(error?.message || error))) throw error;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await pause(100);
      page = await chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE", maxMs, waitFor, minMs });
    }
    if (page.loginRequired) throw new Error("需要重新登录");
    return { ok: true, url, title: page.title || "", text: page.text || "", links: page.links || [], images: page.images || [], gmailThreads: page.gmailThreads || [] };
  } catch (error) {
    return { ok: false, url, error: error.message, title: "", text: "", links: [], images: [], gmailThreads: [] };
  } finally {
    if (owned && tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function ensureOcrDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) return;
  await chrome.offscreen.createDocument({
    url: "ocr.html",
    reasons: ["WORKERS"],
    justification: "Read attendance-code tables that teaching staff publish as images."
  });
}

function imagePriority(image, page) {
  const imageClue = `${image.src || ""} ${image.alt || ""} ${image.context || ""}`.toLowerCase();
  const pageClue = `${page?.title || ""} ${page?.url || ""}`.toLowerCase();
  // These are common Moodle chrome/content images, not attendance tables. Never send them
  // to OCR: besides wasting minutes, YouTube/CDN thumbnails can generate CORS errors in the
  // extension error console.
  if (/img\.youtube\.com|ytimg\.com|teaching[-_ ]award|\bavatar\b|\bprofile\b|\bfavicon\b|\blogo\b|\bicon\b|\bbadge\b|emoji/.test(imageClue)) return -Infinity;
  if (!image.src) return -Infinity;

  const imageLooksRelevant = /attendance|code|workshop|tutorial|studio|applied|week\s*\d+/.test(imageClue);
  // automaticSourceScans only opens Ed detail threads that edThreadLinks() already selected
  // because their list-row title contains Attendance / Code / Week N. Ed's document.title,
  // however, is usually just "FIT2102 - Ed Discussion", so using page.title here caused
  // v1.3.5 to reject the very attendance-table image we had deliberately opened.
  const selectedEdThread = /edstem\.org\/au\/courses\/\d+\/discussion\/\d+/.test(page?.url || "");
  const moodlePage = /learning\.monash\.edu/i.test(page?.url || "");
  const minWidth = selectedEdThread ? 180 : 240;
  const minHeight = selectedEdThread ? 20 : 60;
  if (image.width < minWidth || image.height < minHeight) return -Infinity;

  // Moodle remains strict because a weekly section can contain dozens of lecture images and
  // YouTube thumbnails. A selected Ed attendance thread is already contextualised by its
  // thread title upstream, so allow its sizeable non-noise images even when alt/context is blank.
  if (moodlePage && !imageLooksRelevant) return -Infinity;
  if (!imageLooksRelevant && !selectedEdThread) return -Infinity;

  let score = imageLooksRelevant ? 20 : 8;
  if (/edusercontent\.com|pluginfile\.php/.test(imageClue)) score += 6;
  if (/attendance|codes?/.test(pageClue)) score += 8;
  if (image.width >= 500) score += 3;
  if (image.height >= 100) score += 2;
  if (selectedEdThread && image.width / Math.max(1, image.height) >= 4) score += 12;
  return score;
}

async function ocrPageImages(page) {
  const images = (page.images || [])
    .map((image) => ({ image, priority: imagePriority(image, page) }))
    .filter(({ priority }) => Number.isFinite(priority) && priority > 0)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)
    .map(({ image }) => image);
  if (!images.length) return page;
  try {
    await ensureOcrDocument();
    const response = await chrome.runtime.sendMessage({ target: "offscreen-ocr", type: "OCR_IMAGES", images });
    if (!response?.ok) throw new Error(response?.error || "OCR failed");
    const results = response.results || [];
    const ocrText = results.map((result) => result.text).filter(Boolean).join("\n");
    const imageErrors = results.map((result) => result.error).filter(Boolean);
    if (!ocrText && imageErrors.length) throw new Error(imageErrors.join(" | "));
    return {
      ...page,
      ocrText,
      ocrSelectedCount: images.length,
      ocrDetails: results.map((result, index) => ({
        index: index + 1,
        src: result.src || images[index]?.src || "",
        text: result.text || "",
        passes: result.passes || [],
        error: result.error || "",
        width: images[index]?.width || 0,
        height: images[index]?.height || 0
      })),
      ocrError: imageErrors.length ? imageErrors.join(" | ") : undefined,
      text: [page.text, ocrText].filter(Boolean).join("\n")
    };
  } catch (error) {
    return { ...page, ocrError: error.message };
  }
}

async function discoverAttendance(settings) {
  const dates = recentAttendanceDates(new Date(), Number(settings.lookbackDays) || 7);
  const isoWindow = new Set(dates.map((date) => date.iso));
  const items = [];
  const errors = [];
  for (const date of dates) {
    const url = new URL("Units.aspx", ATTENDANCE_URL);
    url.hash = date.key;
    const page = await readPage(url.href);
    if (!page.ok) {
      errors.push(`${date.iso}: ${page.error}`);
      continue;
    }
    for (const link of page.links.filter((link) => link.href.includes("Entry.aspx"))) {
      const course = link.label.match(/\b[A-Z]{3}\d{4}\b/i)?.[0]?.toUpperCase();
      if (!course) continue;
      // Units.aspx preloads several days of sessions into the DOM at once and only
      // expands the one matching the hash, so the real date lives in the link's own
      // "d=" query param, not in whichever date this tab happened to be opened for.
      const linkDate = parseDateKey(new URL(link.href).searchParams.get("d"));
      if (!linkDate || !isoWindow.has(linkDate.iso)) continue;
      const label = sessionName(link.label, course);
      const time = link.label.match(/\b\d{1,2}:\d{2}\s?[ap]m\b/i)?.[0] || "";
      items.push({
        id: `attendance:${linkDate.iso}:${link.href}`,
        courseId: course.toLowerCase(),
        course,
        sessionId: label.toLowerCase().replace(/\W+/g, "-"),
        session: label,
        attendanceLabel: link.label,
        day: new Date(`${linkDate.iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" }),
        time,
        week: null,
        code: "",
        confidence: "missing",
        context: "",
        entryUrl: link.href,
        sourceUrl: link.href,
        attendanceDate: linkDate
      });
    }
  }
  return { items: [...new Map(items.map((item) => [item.id, item])).values()], errors };
}

function confidentlyResolvedCourses(scans, items) {
  const best = items.map((item) => ({ ...item }));
  for (const page of scans) {
    if (!page?.ok || !page.text) continue;
    const scoped = safeScopedAttendanceItems(best, page);
    if (!scoped.length) continue;
    const matched = matchCodesToAttendance(page.text, scoped.map(({ item }) => item));
    matched.forEach((candidate, scopedIndex) => {
      const index = scoped[scopedIndex].index;
      if (candidate.code && confidenceRank(candidate.confidence) > confidenceRank(best[index].confidence)) {
        best[index] = candidate;
      }
    });
  }
  const byCourse = new Map();
  best.forEach((item) => {
    const key = String(item.course || "").toLowerCase();
    if (!key) return;
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key).push(item);
  });
  return new Set([...byCourse.entries()]
    .filter(([, courseItems]) => courseItems.length && courseItems.every((item) => item.code && item.confidence === "high"))
    .map(([course]) => course));
}

// Codes are never on the landing pages. Ed puts them inside an announcement thread,
// Moodle inside the current week's section page, and Ed's own notification emails carry
// the full announcement body. So this walks:
//   Gmail search -> each matching email (staff post to Ed, Ed emails it out)
//   Ed dashboard -> each unit's discussion list -> threads titled attendance/code/week N
//   Moodle "My units" -> each unit's home page -> the section pages for this week ±1
// scanning every page it opens along the way.
async function automaticSourceScans(items, settings) {
  const codes = [...new Set(items.map((item) => item.course).filter(Boolean))];
  if (!codes.length) return [];
  const scans = [];
  const visited = new Set();
  const weekHints = new Set();
  const scan = async (url, options = {}) => {
    if (!url || visited.has(url)) return null;
    visited.add(url);
    const { courses: explicitCourses = [], ...readOptions } = options || {};
    let page = await readPage(url, readOptions);
    // Confirmed by hand against a real FIT2109 announcement: some staff paste the code table
    // into Ed as a screenshot rather than typing it, and Ed's email notification carries that
    // same image through to Gmail - the "Workshops:"/"Tutorials:" headers arrive as real text
    // but every code sits inside a <img> the announcement pasted in, invisible to
    // matchCodesToAttendance no matter how the text-matching regex is tuned. content.js already
    // collects large-enough images from every page, Gmail included, but this gate used to only
    // ever send Ed/Moodle pages on to OCR - an opened Gmail message with the exact same
    // screenshot never got OCR'd, so its codes were silently unreachable.
    const isCodePage = /edstem\.org\/au\/courses\/\d+\/discussion\/\d+/.test(url)
      || /learning\.monash\.edu\/course\/view\.php.*(?:[?&]section=|#section-)/.test(url)
      || /mail\.google\.com\/mail\/u\/\d+\/#all\//.test(url);
    if (page.ok && page.images?.length && isCodePage) page = await ocrPageImages(page);
    const titleCourses = courseCodesInText(page.title || "", codes);
    const inferredCourses = courseCodesInText(page.text || "", codes);
    // Page titles such as "FIT2102 - Ed Discussion" are a stronger ownership signal than
    // broad sidebar/list context. `courseCodesInText` extracts literal FITxxxx tokens rather
    // than building a dynamic word-boundary regex, avoiding the old `\b`/backspace bug.
    // A unit-specific page with no resolved owner is later skipped rather than matched globally.
    const ownerCourses = titleCourses.length === 1
      ? titleCourses
      : (explicitCourses.length ? explicitCourses : inferredCourses);
    page.courses = [...new Set(ownerCourses.map((value) => String(value).toLowerCase()))];
    scans.push(page);
    // Temporary diagnostic: a semester export can come back with a code missing even when
    // the source email is confirmed to exist and to contain the code in plain sight, with no
    // obvious reason from reading the matching code alone. Logging what this actually
    // extracted from each Gmail page is the fastest way to tell whether the thread was even
    // opened, and whether the code survived being flattened from an HTML table into plain
    // text, without guessing further from static code. Safe to remove once that's resolved.
    if (/mail\.google\.com/i.test(url)) {
      await logDebug(`gmail scan ${url}`, { ok: page.ok, title: page.title, courses: page.courses, textExcerpt: (page.text || "").slice(0, 3000) });
    }
    return page;
  };

  // Gmail can have several signed-in accounts open at once. Prefer the active/recent account
  // instead of blindly using /u/0, and search before the actual class dates because many
  // units publish Week N attendance codes several days in advance.
  const gmailTabs = await chrome.tabs.query({ url: "https://mail.google.com/*" });
  const gmailBase = pickGmailBase(gmailTabs);

  // Gmail's own search results list is virtualised: it renders roughly one page's worth of
  // conversation rows, and this only ever reads whatever is already sitting in that DOM - it
  // never scrolls or clicks through to a second page. A normal weekly scan's date range is
  // narrow enough that every relevant email already fits on that first page, so this limit was
  // never visible there. buildSemesterHistory() reused this exact function unchanged but with
  // `items` spanning the whole semester in one search; a query that wide can easily match far
  // more conversations across a couple of months than Gmail renders at once, and which weeks
  // survive onto that first page depends on how much other mail exists around them, not on
  // anything this code controls. Raising prioritiseGmailThreads' selection cap (see below) does
  // nothing for a week whose email was never even in the scraped list to begin with - which is
  // exactly why a FIT2109 week that a normal weekly scan finds without any trouble could still
  // come back blank here even after that cap was widened. Running one Gmail search per week
  // keeps every individual query exactly as narrow as a normal weekly scan's, so nothing this
  // reads from Gmail ever needs a second page - the cost is one Gmail search per week instead
  // of one for the whole export, which is the right trade for a feature that already warns it
  // can take several minutes.
  const weekBuckets = new Map();
  items.forEach((item) => {
    const key = weekBucketKey(item?.attendanceDate?.iso);
    if (!weekBuckets.has(key)) weekBuckets.set(key, []);
    weekBuckets.get(key).push(item);
  });

  for (const weekItems of weekBuckets.values()) {
    const weekCodes = [...new Set(weekItems.map((item) => item.course).filter(Boolean))];
    if (!weekCodes.length) continue;
    const { after, before } = gmailSearchBounds(weekItems);
    const query = `(${weekCodes.join(" OR ")}) attendance${after && before ? ` after:${after} before:${before}` : " newer_than:21d"}`;
    const search = await scan(`${gmailBase}#search/${encodeURIComponent(query)}`, { maxMs: 25000, waitFor: "tr.zA, [data-legacy-thread-id]", minMs: 2000 });
    if (!search?.ok) continue;

    // The old eight-message cap was enough for one or two FIT units, but it starved other
    // courses on accounts with many engineering attendance announcements. Rank exact code
    // messages first, reserve candidates across every detected course, then stop as soon as
    // every Attendance row for this week is confidently resolved. Scaling with how many
    // sessions actually fall in this one week (rather than the whole semester) is what keeps
    // each individual search this narrow in the first place - the two fixes work together.
    const sessionsPerCourse = new Map();
    weekItems.forEach((item) => {
      const key = String(item.course || "").toLowerCase();
      if (!key) return;
      sessionsPerCourse.set(key, (sessionsPerCourse.get(key) || 0) + 1);
    });
    const maxSessionsForOneCourse = Math.max(0, ...sessionsPerCourse.values());
    // +2 spare candidates per course covers a unit resending a correction or splitting one
    // week's announcement into two threads, same margin the old flat cap of 4 gave a 1-2
    // session weekly scan.
    const perCourseThreadLimit = Math.max(4, maxSessionsForOneCourse + 2);
    const totalThreadLimit = Math.max(24, weekCodes.length * perCourseThreadLimit);
    const threads = prioritiseGmailThreads(search.gmailThreads, weekCodes, totalThreadLimit, perCourseThreadLimit);
    // Temporary diagnostic, see the note above scans.push(page) for why. This shows exactly
    // which of the threads Gmail actually rendered for this week's search got selected to be
    // opened, vs. discarded before ever being read.
    await logDebug(`gmail week bucket ${query}`, {
      weekCodes,
      rawThreadCount: (search.gmailThreads || []).length,
      selectedThreadCount: threads.length,
      selectedThreads: threads.map((thread) => ({ id: thread.id, label: thread.label }))
    });
    for (const thread of threads) {
      const resolved = confidentlyResolvedCourses(scans, weekItems);
      if (resolved.size >= weekCodes.length) break;
      const threadCourses = courseCodesInText(thread.label || "", weekCodes).map((code) => code.toLowerCase());
      if (threadCourses.length && threadCourses.every((course) => resolved.has(course))) continue;
      await scan(`${gmailBase}#all/${thread.id}`, {
        maxMs: 20000,
        waitFor: "div[role='listitem'], .a3s",
        minMs: 1500,
        courses: threadCourses
      });
    }
  }

  const gmailResolved = confidentlyResolvedCourses(scans, items);
  if (gmailResolved.size >= codes.length) return scans;
  const edCodes = codes.filter((code) => !gmailResolved.has(code.toLowerCase()));

  const edDashboard = await scan("https://edstem.org/au/dashboard", { waitFor: "a[href*='/courses/']" });
  // Open Ed tabs are useful fallback hints: their titles often contain FITxxxx even when
  // the dashboard's clickable anchor contains only an icon or a short course nickname.
  const openEdTabs = await chrome.tabs.query({ url: "https://edstem.org/au/courses/*" });
  const edHints = openEdTabs.map((tab) => ({ label: tab.title || "", context: tab.title || "", href: tab.url || "" }));
  const edCourses = findCourseLinks([...(edDashboard?.links || []), ...edHints], edCodes, {
    hrefPattern: /\/courses\/\d+/,
    normaliseHref: (href) => href.replace(/(\/courses\/\d+).*$/, "$1/discussion")
  });
  for (const course of edCourses.slice(0, 8)) {
    const list = await scan(course.href, { waitFor: "a[href*='/discussion/']", courses: course.courses });
    if (!list?.ok) continue;
    // The thread body renders after the list; give it a floor so we don't read a page
    // that has the sidebar painted but the post itself still loading. Keep the week number
    // from the selected attendance-thread title as a strong hint for Moodle later.
    for (const threadUrl of edThreadLinks(list.links)) {
      const meta = list.links.find((link) => String(link.href || "").split("#")[0] === threadUrl);
      const week = Number(/\bweek\s*(\d{1,2})\b/i.exec(`${meta?.label || ""} ${meta?.context || ""}`)?.[1] || 0);
      if (week) weekHints.add(week);
      await scan(threadUrl, { maxMs: 12000, minMs: 3000, courses: course.courses });
    }
  }

  // If Gmail/Ed already found every Attendance row for a unit with high confidence, there
  // is no reason to open that unit in Moodle at all. This is what prevents FIT2109 from
  // repeatedly appearing after SQP3R has already been found on Ed.
  const resolvedCourses = confidentlyResolvedCourses(scans, items);
  const unresolvedCodes = codes.filter((code) => !resolvedCourses.has(code.toLowerCase()));
  if (!unresolvedCodes.length) return scans;

  const myUnits = await scan("https://learning.monash.edu/my/courses.php", { maxMs: 15000, waitFor: "a[href*='course/view.php?id=']" });
  const moodleCourses = findCourseLinks(myUnits?.links, unresolvedCodes, {
    hrefPattern: /\/course\/view\.php\?id=\d+/,
    normaliseHref: (href) => href.replace(/(\/course\/view\.php\?id=\d+).*$/, "$1")
  });
  for (const course of moodleCourses.slice(0, 8)) {
    const home = await scan(course.href, { waitFor: "a[href*='section']", courses: course.courses });
    if (!home?.ok) continue;
    const weekOneMonday = settings.weekOneMonday || detectWeekOneMonday(home.text);
    const courseItems = items.filter((item) => course.courses.includes(String(item.course || "").toLowerCase()));
    const courseDates = courseItems.map((item) => item.attendanceDate).filter(Boolean);
    let targetWeeks = weekOneMonday
      ? [...new Set(courseDates.map((date) => teachingWeek({ weekOneMonday }, new Date(`${date.iso}T12:00:00`))).filter(Number.isFinite))]
      : inferWeekNumbersFromText(home.text, courseDates);
    if (!targetWeeks.length && weekHints.size) targetWeeks = [...weekHints];

    const weekLinks = moodleWeekLinks(home.links);
    const availableWeeks = [...weekLinks.keys()];
    // Exact weeks are safe when they came from Attendance dates, Moodle date ranges or an
    // Ed attendance-thread title. Only the no-hint path uses a bounded fallback.
    const exact = targetWeeks.length ? availableWeeks.filter((week) => targetWeeks.includes(week)) : [];
    const selectedWeeks = exact.length ? exact : pickWeekNumbers(availableWeeks, []);
    for (const week of selectedWeeks) await scan(weekLinks.get(week), { courses: course.courses });
  }

  return scans;
}

async function scanCourse(course, week) {
  const page = await readPage(course.url);
  if (page.ok) return { courseId: course.id, ok: true, items: extractCandidates(page.text, course, week) };
  return {
    courseId: course.id,
    ok: false,
    error: page.error,
    items: (course.sessions || []).map((session) => ({
      id: `${course.id}:${session.id}:w${week}`,
      courseId: course.id,
      course: course.name,
      sessionId: session.id,
      session: session.label,
      day: session.day,
      time: session.time,
      week,
      code: "",
      confidence: "missing",
      context: "",
      sourceUrl: course.url
    }))
  };
}

async function scanAll(reason = "manual") {
  const settings = await loadSettings();
  if (!hasUsableConfig(settings)) {
    const result = { reason, week: null, scannedAt: new Date().toISOString(), items: [], scans: [], notConfigured: true };
    await chrome.storage.local.set({ latestScan: result });
    await chrome.notifications.create("attendance-scan", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Attendance Helper 尚未配置",
      message: "请先设置有效提醒时间；课程可由 Attendance 自动识别。",
      priority: 1
    });
    return result;
  }

  if (settings.autoDiscover !== false) {
    const discovered = await discoverAttendance(settings);
    const sourceScans = await automaticSourceScans(discovered.items, settings);
    const items = mergeSourceScanCodes(discovered.items, sourceScans);
    // Keep only a summary of each scan: full page text for a dozen pages would blow past
    // chrome.storage.local's quota and make the whole save fail silently.
    const scans = sourceScans.map(({ ok, url, error, text, links, images, ocrText, ocrSelectedCount, ocrDetails, ocrError, gmailThreads, courses }) => ({
      ok,
      url,
      courses,
      error,
      textLength: (text || "").length,
      linkCount: (links || []).length,
      imageCount: (images || []).length,
      ocrLength: (ocrText || "").length,
      ocrSelectedCount: ocrSelectedCount || 0,
      ocrDetails: (ocrDetails || []).map((detail) => ({
        index: detail.index,
        src: detail.src,
        text: String(detail.text || "").slice(0, 6000),
        passes: (detail.passes || []).slice(0, 12).map((pass) => ({
          label: String(pass.label || "").slice(0, 80),
          text: String(pass.text || "").slice(0, 2200)
        })),
        error: String(detail.error || "").slice(0, 1200),
        width: detail.width || 0,
        height: detail.height || 0
      })),
      ocrError,
      threadCount: (gmailThreads || []).length,
      // How many 5-char letter+digit tokens the page had at all: zero on a page that
      // visibly shows a code table means the table isn't text (image, canvas, iframe).
      codeLikeCount: ((text || "").match(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5}\b/g) || []).length,
      excerpt: (text || "").slice(0, 20000)
    }));
    const result = { reason, mode: "attendance-discovery", week: null, scannedAt: new Date().toISOString(), items, scans, discoveryErrors: discovered.errors };
    await logDebug("scanAll storing latestScan", { reason: result.reason, mode: result.mode, itemCount: result.items.length });
    await chrome.storage.local.set({ latestScan: result });
    const found = items.filter((item) => item.code).length;
    await chrome.notifications.create("attendance-scan", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "过去一周 Attendance 已检查",
      message: items.length ? `识别到 ${items.length} 节课，找到 ${found} 个代码。点击核对。` : "Attendance 过去一周没有显示可填写的课程，或当前账号需要重新登录。",
      priority: 2,
      requireInteraction: true
    });
    return result;
  }

  const week = teachingWeek(settings);
  if (!Number.isFinite(week)) throw new Error("Week 1 日期无效，请检查扩展设置。");

  const scans = [];
  for (const course of settings.courses.filter((item) => item.enabled !== false && item.url && item.sessions?.length)) {
    scans.push(await scanCourse(course, week));
  }
  const items = scans.flatMap((scan) => scan.items).map((item) => ({
    ...item,
    attendanceDate: attendanceDate(settings, week, item.day)
  }));
  const result = { reason, week, scannedAt: new Date().toISOString(), items, scans };
  await chrome.storage.local.set({ latestScan: result });
  const found = items.filter((item) => item.code).length;
  const missing = items.length - found;
  await chrome.notifications.create("attendance-scan", {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `Week ${week} 签到码已检查`,
    message: found
      ? `找到 ${found} 个，${missing ? `${missing} 个需人工核对。` : "全部找到。"} 点击查看并确认。`
      : "暂时没有找到代码。请确认已登录 Moodle/Ed，或稍后重试。",
    priority: 2,
    requireInteraction: true
  });
  return result;
}

const SEMESTER_EXPORT_MAX_WEEKS = 20;

// Attendance itself only accepts a submission up to about a week back, so a student who
// forgot to fill one in earlier this semester has no way to fix it there. This does not try
// to submit anything - it just rebuilds the whole semester's attendance/code picture (reusing
// the exact same discovery pipeline as the weekly scan, just over a much wider date range) so
// the student has a record they can download, e.g. to send their unit coordinator when asking
// for a manual correction.
async function buildSemesterHistory(settings) {
  // Log the raw setting before any validation can throw - a thrown error before this point
  // used to leave the debug log completely empty, which made "did the button click even
  // reach the background?" and "is Week 1's date actually what I think it is?" impossible to
  // tell apart from the confirm page alone.
  await logDebug("semester history: export requested", { weekOneMonday: settings?.weekOneMonday, today: new Date().toISOString().slice(0, 10) });
  if (!settings?.weekOneMonday) {
    throw new Error("请先在设置里填写 Week 1 的星期一日期，才能计算本学期的范围。");
  }
  const weekOneMonday = new Date(`${settings.weekOneMonday}T00:00:00`);
  if (Number.isNaN(weekOneMonday.getTime())) {
    throw new Error("Week 1 星期一的日期格式不对，请在设置里重新选择一次。");
  }
  const today = new Date();
  const lookbackDays = Math.max(7, Math.round((today - weekOneMonday) / 86400000));
  if (lookbackDays > SEMESTER_EXPORT_MAX_WEEKS * 7) {
    throw new Error(`时间跨度超过 ${SEMESTER_EXPORT_MAX_WEEKS} 周，暂不支持一次性导出，请检查 Week 1 日期是否填错了。`);
  }

  await logDebug("semester history: reading Attendance portal", { weekOneMonday: settings.weekOneMonday, lookbackDays });
  const portal = await readAttendancePortal(lookbackDays);
  let items = mergePortalAttendance([], portal.sessions);

  // The date range we asked for and the range Attendance actually handed back can silently
  // diverge - a wrong Week 1 date only shrinks lookbackDays, but the portal itself could also
  // just not have rendered anything for the older dates even though we did ask for them. Log
  // both so the two failure modes are never confused with each other again.
  const scannedDates = portal.scans.filter((scan) => scan.ok).map((scan) => scan.url.split("#")[1]).filter(Boolean);
  const datesWithSessions = [...new Set(items.filter((item) => item.attendanceDate?.iso).map((item) => item.attendanceDate.iso))].sort();
  await logDebug("semester history: portal scan coverage", {
    requestedLookbackDays: lookbackDays,
    datesRequested: scannedDates.length,
    datesWithAnySessionRow: datesWithSessions.length,
    earliestDateWithSessions: datesWithSessions[0] || null,
    latestDateWithSessions: datesWithSessions[datesWithSessions.length - 1] || null,
    failedDateCount: portal.scans.filter((scan) => !scan.ok).length
  });

  // Attendance's own UI only ever renders roughly the last couple of weeks no matter what date
  // is requested - that platform limit is the whole reason this export exists (a student who
  // missed a code six weeks ago has no way to even see that class in Attendance any more, let
  // alone find its code there). Fill every earlier week the portal left blank by repeating the
  // recurring (course, session, weekday, time) pattern the portal DID confirm for its visible
  // window - the timetable does not change week to week, so a class real enough to see this
  // week almost certainly ran the same way in week 3. Filled rows are flagged
  // outOfPortalRange so the CSV never claims "未签到" for a class Attendance was simply never
  // asked to confirm either way.
  const beforeProjection = items.length;
  items = projectHistoricalSessions(items, settings.weekOneMonday, today);
  await logDebug("semester history: projected sessions for weeks Attendance's UI can no longer show", {
    beforeProjection,
    afterProjection: items.length,
    addedCount: items.length - beforeProjection
  });

  // Codes already found by an earlier normal weekly scan are cached - restoring them first
  // means this only has to go searching Gmail/Ed/Moodle for whatever the cache doesn't
  // already have, instead of re-finding everything from scratch every time.
  const stored = await chrome.storage.local.get(EVIDENCE_CACHE_KEY);
  items = restoreCodeEvidence(items, stored[EVIDENCE_CACHE_KEY] || {});

  const stillMissing = items.filter(needsCodeEvidence).length;
  await logDebug("semester history: searching sources for remaining codes", { itemCount: items.length, stillMissing });
  if (stillMissing) {
    const sourceScans = await automaticSourceScans(items.filter(needsCodeEvidence), settings);
    items = mergeSourceScanCodes(items, sourceScans);
  }

  const cache = buildCodeEvidenceCache(items, stored[EVIDENCE_CACHE_KEY] || {});
  await chrome.storage.local.set({ [EVIDENCE_CACHE_KEY]: cache });

  const sorted = items.sort((a, b) =>
    String(a.attendanceDate?.iso || "").localeCompare(String(b.attendanceDate?.iso || ""))
    || String(a.course || "").localeCompare(String(b.course || ""))
  );
  return {
    items: sorted,
    range: {
      weekOneMonday: settings.weekOneMonday,
      lookbackDays,
      earliestDateWithSessions: datesWithSessions[0] || null,
      latestDateWithSessions: datesWithSessions[datesWithSessions.length - 1] || null,
      projectedCount: items.filter((item) => item.outOfPortalRange).length
    }
  };
}

async function submitOne(item, settings) {
  if (item.entryUrl) {
    const tab = await chrome.tabs.create({ url: item.entryUrl, active: true });
    await waitForLoaded(tab.id);
    const outcome = await chrome.tabs.sendMessage(tab.id, {
      type: "FILL_ATTENDANCE_CODE",
      code: item.code,
      commit: true
    });
    return { ...outcome, tabId: tab.id };
  }

  const date = item.attendanceDate || attendanceDate(settings, item.week, item.day);
  if (!date) return { ok: false, error: "无法计算签到日期，请检查 Week 1 和班次星期设置。" };
  const unitsUrl = new URL("Units.aspx", ATTENDANCE_URL);
  unitsUrl.hash = date.key;
  const tab = await chrome.tabs.create({ url: unitsUrl.href, active: true });
  await waitForLoaded(tab.id);
  const session = await chrome.tabs.sendMessage(tab.id, {
    type: "FIND_ATTENDANCE_SESSION",
    course: item.course,
    session: item.session,
    attendanceLabel: item.attendanceLabel
  });
  if (!session.ok) return { ...session, tabId: tab.id };
  await chrome.tabs.update(tab.id, { url: session.href });
  await waitForLoaded(tab.id);
  const outcome = await chrome.tabs.sendMessage(tab.id, {
    type: "FILL_ATTENDANCE_CODE",
    code: item.code,
    commit: true
  });
  return { ...outcome, tabId: tab.id };
}

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  await configureAlarms();
});

chrome.runtime.onStartup.addListener(configureAlarms);
chrome.alarms.onAlarm.addListener((alarm) => {
  if ([PRIMARY_ALARM, BACKUP_ALARM].includes(alarm.name)) scanAll(alarm.name);
});
chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("review.html") }));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SCAN_ALL") {
    // Final reconciliation used to be a second message the caller (popup.js or review.js)
    // had to send after this one resolved. A popup's script is destroyed the instant the
    // popup closes, so a user clicking away while the (often slow) scan was still running
    // silently killed that second call before it was ever sent - the scan itself still
    // finished and notified normally, which made it look like reconciliation had simply
    // stopped working. Chain it here instead, inside the one message handler that is
    // guaranteed to run to completion regardless of what any caller's UI does afterwards.
    (async () => {
      try {
        const result = await scanAll("manual");
        const reconciled = result?.mode === "attendance-discovery" ? await reconcileAndStore(result) : result;
        sendResponse({ ok: true, result: reconciled });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
  if (message.type === "SETTINGS_CHANGED") {
    configureAlarms().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "OPEN_REVIEW") {
    chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "SUBMIT_CODES") {
    (async () => {
      const settings = await loadSettings();
      const { lastSubmission } = await chrome.storage.local.get("lastSubmission");
      const completed = new Set((lastSubmission?.outcomes || []).filter((item) => item.ok).map((item) => item.id));
      const outcomes = [];
      for (const item of message.items) {
        if (completed.has(item.id)) {
          outcomes.push({ id: item.id, code: item.code, ok: true, skipped: true, message: "本机已记录为提交成功，已跳过去重" });
          continue;
        }
        try {
          outcomes.push({ id: item.id, code: item.code, ...(await submitOne(item, settings)) });
        } catch (error) {
          outcomes.push({ id: item.id, code: item.code, ok: false, error: error.message });
        }
      }
      await chrome.storage.local.set({ lastSubmission: { at: new Date().toISOString(), outcomes: [...(lastSubmission?.outcomes || []), ...outcomes] } });
      sendResponse({ ok: outcomes.every((item) => item.ok), outcomes });
    })();
    return true;
  }
  if (message.type === "EXPORT_SEMESTER_HISTORY") {
    (async () => {
      try {
        await logDebug("EXPORT_SEMESTER_HISTORY received");
        const settings = await loadSettings();
        const { items, range } = await buildSemesterHistory(settings);
        sendResponse({ ok: true, items, range });
      } catch (error) {
        await logDebug("EXPORT_SEMESTER_HISTORY failed", { message: error?.message });
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
});