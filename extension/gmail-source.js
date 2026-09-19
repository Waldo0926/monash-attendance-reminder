function gmailBaseFromUrl(url) {
  const match = String(url || "").match(/^https:\/\/mail\.google\.com\/mail\/u\/(\d+)\//i);
  return match ? `https://mail.google.com/mail/u/${match[1]}/` : "";
}

export function pickGmailBase(tabs = []) {
  const candidates = (tabs || []).map((tab, index) => ({
    base: gmailBaseFromUrl(tab?.url),
    active: Boolean(tab?.active),
    lastAccessed: Number(tab?.lastAccessed) || 0,
    index
  })).filter((item) => item.base);

  candidates.sort((a, b) => {
    if (a.active !== b.active) return Number(b.active) - Number(a.active);
    if (a.lastAccessed !== b.lastAccessed) return b.lastAccessed - a.lastAccessed;
    return a.index - b.index;
  });

  return candidates[0]?.base || "https://mail.google.com/mail/u/0/";
}

function shiftIsoDate(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function gmailSearchBounds(items = [], daysBefore = 8, daysAfter = 4) {
  const dates = [...new Set((items || []).map((item) => item?.attendanceDate?.iso).filter(Boolean))].sort();
  if (!dates.length) return { after: "", before: "" };
  return {
    after: shiftIsoDate(dates[0], -Math.max(0, Number(daysBefore) || 0)),
    before: shiftIsoDate(dates.at(-1), Math.max(1, Number(daysAfter) || 1))
  };
}

function threadPriority(thread, courseCodes) {
  const label = String(thread?.label || "");
  const lower = label.toLowerCase();
  let score = 0;

  if (/attendance\s+codes?\b/i.test(label)) score += 100;
  else if (/\battendance\b/i.test(label)) score += 45;
  if (/international\s+students?/i.test(label)) score += 30;
  if (/\bannouncement\b/i.test(label)) score += 15;
  if (/\bweek\s*\d{1,2}\b/i.test(label)) score += 15;
  if (/forms?\s+response/i.test(label)) score += 8;
  if (/recording|consultation|reminder|discord/i.test(lower) && !/attendance\s+codes?/i.test(label)) score -= 20;

  const matchedCourses = (courseCodes || []).filter((code) => lower.includes(String(code).toLowerCase()));
  score += matchedCourses.length * 35;
  return { score, matchedCourses };
}

export function prioritiseGmailThreads(threads = [], courseCodes = [], limit = 24, perCourseLimit = 4) {
  const unique = [];
  const seen = new Set();
  for (const thread of threads || []) {
    const id = String(thread?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ranked = threadPriority(thread, courseCodes);
    unique.push({ ...thread, _score: ranked.score, _courses: ranked.matchedCourses });
  }

  unique.sort((a, b) => b._score - a._score);
  const selected = [];
  const selectedIds = new Set();
  const add = (thread) => {
    if (!thread || selectedIds.has(thread.id) || selected.length >= limit) return;
    selectedIds.add(thread.id);
    selected.push(thread);
  };

  // Fairness matters more than a pure global ranking: when several units share one Gmail
  // account, one noisy unit must not consume every slot before another unit's attendance
  // code email is opened. Round-robin the best four candidates for each course first, so a
  // small global limit still gives every detected course a chance.
  const perCourse = new Map((courseCodes || []).map((code) => [
    code,
    unique.filter((thread) => thread._courses.includes(code)).slice(0, perCourseLimit)
  ]));
  for (let round = 0; round < perCourseLimit && selected.length < limit; round += 1) {
    for (const code of courseCodes || []) {
      add(perCourse.get(code)?.[round]);
      if (selected.length >= limit) break;
    }
  }
  unique.forEach(add);

  return selected.map(({ _score, _courses, ...thread }) => thread);
}
