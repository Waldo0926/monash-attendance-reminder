// Some units post the attendance codes as a Word file: ETW1001 uploads "Attendance Code.docx"
// into the week's Wrap-up section, and BTW1042 emails the same kind of file through a Moodle
// forum post. The file is just a title line plus screenshots of the code table, so there is no
// text to match - the screenshots have to go through the normal OCR path. Opening such a link
// in a tab only makes Chrome save the file, so these are fetched as bytes instead, unzipped
// here, and handed on as text + images.

const DOCX_TYPE = /wordprocessingml\.document/i;
const MAX_DOCX_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES_PER_DOCX = 8;

function unwrapGoogleRedirect(href) {
  try {
    const url = new URL(href);
    if (/(^|\.)google\.com$/i.test(url.hostname) && url.pathname === "/url") return url.searchParams.get("q") || url.searchParams.get("url") || href;
  } catch {
    // Not a URL; fall through.
  }
  return href;
}

function fileNameOf(url) {
  try {
    return decodeURIComponent(url.pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

// Picks Moodle file links worth reading. Only the link's own text and file name count: the
// surrounding block of a Moodle week section says "Attendance" for almost every file in it.
export function attendanceFileLinks(links, limit = 4) {
  const found = new Map();
  // The section page's course-index drawer repeats "Attendance Codes W1", "... W2" for every
  // week; those must not use up the few files read per page.
  const pool = (links || []).some((link) => link.inMain) ? links.filter((link) => link.inMain) : links || [];
  for (const link of pool) {
    let url;
    try {
      url = new URL(unwrapGoogleRedirect(link.href));
    } catch {
      continue;
    }
    if (url.hostname !== "learning.monash.edu") continue;
    const isResource = /\/mod\/resource\/view\.php/i.test(url.pathname);
    const isPluginFile = /\/pluginfile\.php\//i.test(url.pathname);
    if (!isResource && !isPluginFile) continue;
    const name = fileNameOf(url);
    if (isPluginFile && !/\.docx$/i.test(name)) continue;
    const label = String(link.label || "").replace(/\s+/g, " ").trim();
    const title = `${label} ${isPluginFile ? name : ""}`;
    if (!/attendance|\bcodes?\b/i.test(title) || /conduct|integrity|policy|syllabus/i.test(title)) continue;
    url.hash = "";
    // pluginfile.php links differ only by ?forcedownload=1 / ?token=; the path is the file.
    const key = isResource ? url.href : url.origin + url.pathname;
    if (!found.has(key)) found.set(key, { href: url.href, name: (isPluginFile && name) || label || name });
  }
  return [...found.values()].slice(0, limit);
}

// Diagnostic only: what file-like links a page offered, so a missed attachment can be traced
// from the debug log (is it a different host? a redirect? not a link at all?).
export function fileLinkClues(links, limit = 6) {
  const clues = [];
  for (const link of links || []) {
    const href = String(link.href || "");
    const label = String(link.label || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!/\.docx|attendance|\bcodes?\b/i.test(`${label} ${decodeURIComponent(href.split("?")[0].split("/").pop() || "")}`)) continue;
    clues.push({ label, href: href.split("?")[0].slice(0, 200) });
    if (clues.length >= limit) break;
  }
  return clues;
}

export function looksLikeDocx(contentType, bytes) {
  const zipped = bytes?.[0] === 0x50 && bytes?.[1] === 0x4b;
  return zipped && (DOCX_TYPE.test(contentType || "") || /octet-stream|zip/i.test(contentType || ""));
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimal zip reader: end-of-central-directory -> central directory -> each entry's data.
async function unzip(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? raw : await inflateRaw(raw));
  }
  return entries;
}

function xmlText(xml) {
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

export function imageSize(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return { width: 1200, height: 600 };
}

function mimeOf(name) {
  return /\.png$/i.test(name) ? "image/png" : /\.jpe?g$/i.test(name) ? "image/jpeg" : /\.gif$/i.test(name) ? "image/gif" : /\.webp$/i.test(name) ? "image/webp" : "";
}

function toDataUrl(bytes, mime) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function readDocx(bytes) {
  if (bytes.length > MAX_DOCX_BYTES) throw new Error("docx too large");
  const entries = await unzip(bytes, (name) => name === "word/document.xml" || /^word\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(name));
  const documentXml = entries.get("word/document.xml");
  if (!documentXml) throw new Error("Not a Word document");
  const images = [...entries.entries()]
    .filter(([name]) => name.startsWith("word/media/"))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, MAX_IMAGES_PER_DOCX)
    .map(([name, data]) => ({ name, mime: mimeOf(name), bytes: data, ...imageSize(data) }))
    .filter((image) => image.mime);
  return { text: xmlText(new TextDecoder().decode(documentXml)), images };
}

// Fetches each candidate with the student's own Moodle session and turns it into page-shaped
// text + OCR image candidates. A failure on one file never fails the page.
export async function readAttendanceDocx(links, { fetchFn = fetch, log = () => {} } = {}) {
  const texts = [];
  const images = [];
  for (const file of attendanceFileLinks(links)) {
    try {
      const response = await fetchFn(file.href, { credentials: "include", redirect: "follow" });
      if (!response.ok || /login|saml|okta/i.test(response.url || "")) { log(file, `HTTP ${response.status}`); continue; }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!looksLikeDocx(response.headers.get("content-type"), bytes)) { log(file, "not a docx"); continue; }
      const docx = await readDocx(bytes);
      texts.push(`Moodle attendance file: ${file.name}\n${docx.text}`);
      docx.images.forEach((image, index) => images.push({
        src: `${file.href}#docx-image-${index + 1}`,
        alt: "",
        context: `attendance code table from ${file.name}`,
        width: image.width,
        height: image.height,
        dataUrl: toDataUrl(image.bytes, image.mime),
        fromDocx: true
      }));
      log(file, `${docx.images.length} image(s), ${docx.text.length} chars`);
    } catch (error) {
      log(file, `failed: ${error?.message || error}`);
    }
  }
  return { text: texts.join("\n"), images };
}
