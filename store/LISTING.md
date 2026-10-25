# Chrome Web Store submission kit – v1.3.52

Everything below is copy-paste material for the Developer Dashboard (https://chrome.google.com/webstore/devconsole). Files in this folder:

- `monash-attendance-helper-1.3.52.zip` – the package to upload. Not committed; build it with `bash scripts/build-store-zip.sh` (see the bottom).
- `screenshots/` – three 1280×800 images.
- Privacy policy URL to paste: https://github.com/Waldo0926/monash-attendance-reminder/blob/main/PRIVACY.md

## Store listing

**Name** (comes from `manifest.json`): Monash Attendance Helper
**Summary** (≤132 chars, also from the manifest): Discover recent classes from Monash Attendance, find codes in Gmail/Moodle/Ed, and submit only after confirmation.
**Category**: Productivity (or Education)
**Language**: English, Chinese (Simplified)

### Description (English)

Monash Attendance Helper is an unofficial tool for Monash University Malaysia students. It saves you from hunting for each week's attendance codes.

What it does
• Reads the classes you are enrolled in from Monash Attendance (last 7 days, or the whole semester for an export).
• Looks for the matching codes your teaching staff already posted – in Gmail, Moodle (page text, week sections and Word attendance files) and Ed discussion threads.
• Reads codes that were posted as screenshots or inside a Word file with a text-recognition engine that runs on your own computer.
• Shows everything on one confirmation page. Nothing is submitted until you tick "I attended these classes" and press submit.
• Weekly reminder and a backup check, plus a CSV/HTML export of your semester history.

Privacy
• Everything runs locally in your browser. No server, no analytics, no ads, no remote code.
• It only visits Monash Attendance, Moodle, Ed and Gmail using your own signed-in session.
• Privacy policy: https://github.com/Waldo0926/monash-attendance-reminder/blob/main/PRIVACY.md

Important
• Unofficial: not affiliated with or endorsed by Monash University or Google.
• It cannot prove attendance or guarantee that a submission succeeds. Only submit codes for classes you actually attended, and follow Monash University's rules.

### Description (简体中文)

Monash Attendance Helper 是给莫纳什大学马来西亚校区学生用的非官方小工具，帮你省去每周到处找签到码的麻烦。

功能
• 从 Monash Attendance 读取你名下的课程（最近 7 天，或导出整个学期）。
• 在 Gmail、Moodle（页面文字、每周版块和 Word 签到文件）和 Ed 讨论帖里查找教学人员已经发布的对应签到码。
• 签到码是截图或放在 Word 文件里时，用运行在你自己电脑上的文字识别引擎来读取。
• 所有结果集中在一个确认页。只有你勾选「我实际参加了这些课程」并点击提交，才会提交。
• 每周提醒和备用检查，还能导出本学期历史记录（CSV/HTML）。

隐私
• 全部在你的浏览器本地运行。没有服务器、统计、广告和远程代码。
• 只用你自己的登录状态访问 Monash Attendance、Moodle、Ed 和 Gmail。
• 隐私政策：https://github.com/Waldo0926/monash-attendance-reminder/blob/main/PRIVACY.md

重要说明
• 非官方：与莫纳什大学和 Google 没有隶属或认可关系。
• 不能证明你到场，也不能保证提交一定成功。请只为你真正参加过的课程提交签到码，并遵守莫纳什大学的规定。

## Privacy practices tab

**Single purpose**: Find the attendance codes that Monash University Malaysia teaching staff have published for the user's own classes (in Gmail, Moodle and Ed), show them for review, and submit the ones the user confirms to Monash Attendance.

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `scripting` | Injects the page reader into an already-open tab after the extension is reloaded or updated, when the automatic content script is not present yet. |
| `storage` | Keeps settings, the latest scan result and a diagnostic log locally on the device. |
| `alarms` | Schedules the weekly reminder and the backup check. |
| `notifications` | Tells the user when a scan has finished and how many codes were found. |
| `offscreen` | Runs the bundled Tesseract OCR in an offscreen document, because a service worker has no DOM or canvas. Used to read codes pasted as screenshots or stored inside Word files. |
| `https://attendance.monash.edu.my/*` | Reads the user's class list and submits confirmed codes. |
| `https://mail.google.com/*` | Reads Gmail search results and messages that contain attendance codes. |
| `https://learning.monash.edu/*` | Reads the user's Moodle unit pages, week sections, and attendance-code files. |
| `https://edstem.org/*` | Reads Ed discussion threads that contain attendance codes. |
| `https://*.edusercontent.com/*` | Loads images attached to Ed posts so the codes in them can be read. |
| `https://d25zr1xy094zys.cloudfront.net/*` | Moodle serves uploaded files (such as an attendance-code .docx) through a signed link on this host; fetch fails without access to it. |
| `wasm-unsafe-eval` (CSP) | Required to run the Tesseract WebAssembly OCR engine that is bundled in the package. |

**Remote code**: No, I am not using remote code. All JavaScript and WebAssembly is in the package. Tesseract loads its worker, core and English data from the package through `chrome.runtime.getURL` in `ocr.js`, and since v1.3.49 the bundled Tesseract files contain no URL at all.

There is no `tabs` permission since v1.3.52. Background tabs are opened with `chrome.tabs.create`, which needs no permission, and the host permissions above already let the extension see the URL of its own Attendance, Moodle, Ed and Gmail tabs.

## Test instructions tab

The extension needs a Monash University student account (Monash Attendance, Moodle, Ed and a Gmail inbox that receives unit emails), so a reviewer without one can check the following:

1. Install, click the toolbar icon. The popup shows the last scan and three buttons.
2. Click 设置 (Settings). The options page shows the semester start date, the reminder schedule, optional manual units and the semester history export. Everything is stored locally.
3. Click 查看确认页 (Review). The confirmation page lists found codes after a scan. The submit button stays disabled until at least one class is picked and the "I attended these classes" box is ticked.
4. Open DevTools on any extension page: every script, the OCR worker, the WebAssembly core and the language data load from chrome-extension:// URLs. The extension makes no request to any host outside the host permissions.

Screenshots of a real scan are in the store listing.

**Data usage** – tick: Personally identifiable information, Personal communications, Website content. Do not tick: health, financial, authentication information, location, user activity.
Then certify all three statements: not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

## Things that can hold up the review

1. **Trademark in the name.** "Monash" in the item name can be rejected as implying an official product. Safer name, if the first submission is refused: "Attendance Helper for Monash Malaysia (unofficial)". The listing name comes from `manifest.json`, so changing it means a manifest change and a new package.
2. **Reads email.** The privacy policy URL and the permission justifications above are what reviewers look for. Do not skip them.
3. **Screenshots.** The three provided are the README images placed on a 1280×800 canvas. They have red annotation boxes and show other extensions in the toolbar; clean retakes of the confirmation page (with sample data) are better.
4. **Academic integrity wording.** Keep the "submit only after you confirm you attended" and "unofficial" lines in the listing.

## Account and submission steps (done by the account owner)

1. Register at https://chrome.google.com/webstore/devconsole – one-time US$5 fee, Google account with 2-step verification.
2. New item → upload the zip.
3. Fill in Store listing, Privacy practices (above), Distribution (Public, or Unlisted if it should only be shared by link) → Submit for review. Review usually takes from a few days to a few weeks; a change of permissions on a later update triggers a fresh review.

## Build the package

```bash
bash scripts/build-store-zip.sh
```

It zips `extension/` with `manifest.json` at the root and then scans the zip. It stops without a zip if it finds a CDN host, any URL inside the bundled Tesseract files, a remote `<script>` or stylesheet, a remote import, `eval` or `new Function` in our own code, or a remote origin in the CSP. CI runs the same script on every pull request.
