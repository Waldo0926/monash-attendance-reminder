# Changelog

## v1.3.52
Chrome Web Store resubmission. The `tabs` permission is gone: background tabs are opened with `chrome.tabs.create`, which needs no permission, and the host permissions already show the URL and title of Attendance, Moodle, Ed and Gmail tabs, which is all the extension reads. Checked in Chromium with the extension loaded: `chrome.tabs.query` still returns the URL of an open Ed thread and still hides other sites, so Chrome no longer warns that the extension can read browsing history. `scripts/build-store-zip.sh` builds the store zip and refuses to write it if the package has a CDN host, a URL inside the bundled Tesseract files, a remote script or stylesheet, a remote import, `eval` or `new Function`, or a remote origin in the CSP. CI now runs it on every pull request instead of only on main. OCR was checked end to end with every non-extension request logged: it read "Workshop 02 GU2ZP" and "Tutorial 16 ST8CT" from a test image and made no network request. `store/LISTING.md` has the updated permission table, remote-code answer and test instructions.

## v1.3.51
Fixed submissions that reported success without signing anything. After the user ticked FIT3162 Studio 01 (BY5YY) and FIT2109 Workshop 02 and pressed submit, the page said "已处理 2/2" but Attendance still showed the question mark on Studio 01. "Success" only meant some element had been clicked. Attendance is an ASP.NET page, so the whole page is one form, and the button search ran over every link in it, including header and footer links, then picked the first one whose text contained a word like "enter". The extension also saved those two records as submitted and skipped them on every later try. Now the button search only takes real buttons, or postback and in-page links, and never home, back, cancel or logout. After the click the extension reopens that day in Attendance in a fresh tab and only counts the record as done when its row shows as completed. The confirm page lists each class with its own result and the reason when it failed (for example "已点击提交，但 Attendance 仍显示未签到"). Only checked successes are skipped next time, so the records old versions wrongly saved can be submitted again. Every submit also writes a "submit result" entry to the debug log with the button it clicked and what Attendance showed.

## v1.3.50
Fixed workshop codes going missing or coming out wrong because OCR misreads the letter Z. The FIT2109 and FIT2102 code tables are screenshots in the Lato font, and Tesseract reads its capital Z as a lowercase z. FIT2109 Week 11 printed Workshop 02 as GU2ZP; the OCR text said "GU2zP", the matcher only accepts upper case codes, so the row showed as not found while the tutorial codes from the same post were fine. The whitelisted code column crop cannot output lowercase, so there the same Z turned into a 7: FIT2102 Week 10 Workshop 01 is W4ZVD but was reported as W47VD with high confidence. Five character tokens that mix in a digit or a second capital are now folded to upper case after OCR. The code column is also read without the whitelist and at three more image sizes, and when those readings spell a cell differently the code drops to needs review and the page lists the other spellings (for example "OCR 读法不一致：W47VD / W4ZVD"), so a wrong code is never ticked for submission on its own. Checked against all 11 real FIT2109 and FIT2102 code images from Weeks 9 to 11 (47 codes): before this change 38 codes were right, 3 were wrong but marked high confidence and 3 were missing; now 34 are right and high confidence, 8 are needs review (5 of them already show the right code, 2 more have the right code in the list of other spellings), 2 are missing, and none are wrong with high confidence. Separately, a five character word next to a course code and a date is no longer taken as a code unless its row also names the class type or the class time. The FIT3162 Studio 01 row had been "found" as MCS21, which was the project team's name in an email that also mentioned Thursday 15 October.

## v1.3.49
Chrome Web Store Manifest V3 compliance fix. The extension already configured Tesseract OCR to load its worker, WebAssembly core, and English language data from packaged local files, but the bundled upstream Tesseract.js files still contained unused jsDelivr fallback URLs. Chrome Web Store's Blue Argon scan treats those remote executable-code fallbacks as remotely hosted code even when local paths are supplied at runtime. Those fallback URLs are now removed and replaced with packaged local defaults, and a regression test rejects any future HTTP(S) URL literal inside the bundled Tesseract executable files. No attendance-discovery, OCR workflow, or submission behaviour changed.

## v1.3.48
Attendance codes posted as a Word file (.docx) are now read, and the mid-semester break no longer hides the right week. Some units (ETW1001 on Moodle, BTW1042 through a forum email) post the codes as a .docx that is just a title plus screenshots of the code table. The scanner used to open such a link in a background tab, which made Chrome pop up a Save dialog on every scan and never read anything. It now fetches the file as bytes, unzips it in memory, and sends its screenshots through the normal OCR, so nothing is saved and no dialog appears. Moodle serves these files through a signed CloudFront link, so the manifest gains one host permission, https://d25zr1xy094zys.cloudfront.net/*, without which fetch fails with "Failed to fetch"; reload the extension after updating. Only the page's main content is searched for files, because Moodle's course index repeats every week's files on every page. Separately, a date that no learned break anchor covers yet now keeps both week labels as candidates (Mon 28 Sep is Week 9 here, but a plain count says Week 10), so both sections are opened and the real week date is learned, which fixes units whose week shift was only visible on the next week's page. A wrapped date cell whose month OCR clipped to its last two letters ("ep" for "Sep") is also restored, so wrapped Wednesday rows are no longer dropped. Verified against the real ETW1001 file: Tutorial 16 = ST8CT, plus Tutorial 02 = PP9MD and Tutorial 09 = H8465 from the same table.

## v1.3.47
Fixed FIT2102's Week 9 codes never being found after the mid-semester break. Week numbers were counted as plain calendar weeks from Week 1, so with the break on Mon 21 Sep, the week of Mon 28 Sep came out as Week 10 while every unit labels it Week 9. Ed then looked for a "Week 10" attendance thread that didn't exist yet and never opened the real "Week 9 Attendance Code" post, and the Moodle fallback opened the Week 10 section instead of Week 9. Week numbers now follow the units' own labels: the extension reads the real start date of each week from Moodle's section headers (for example "Week 9 ... Mon 28 Sept 26") and remembers it, so every later scan skips the break correctly. Until it has seen those dates once, Ed also falls back to the previous week's thread when the computed week has none. Codes from the wrong week still can't slip through, because a code only matches when its date is an exact match. Verified with this week's real Ed post: Workshop 01 = EV6FA and Tutorial 09 = LDERR, both high confidence.

## v1.3.46
v1.3.45's fix was real but incomplete. It taught the code that stitches a row's text back together not to be fooled by a garbled fragment that only looks code shaped, but a real re export still showed the same FIT2102 Workshop 01 (Aug 18) row blank. The real cause was an earlier check that counted a fake code from that same garbled text as already found enough and skipped the dedicated, whitelisted code column crop pass entirely, so the v1.3.45 fix never got a chance to run. This build removes that earlier count check and runs the code column crop whenever the image is shaped like it has a code column, the same principle v1.3.44 already used elsewhere. Verified end to end with the real garbled OCR text and the real crop output run through the actual matchCodesToAttendance function from shared.js. One honest caveat: the source image behind this row is only 841x42px, so the recovered code can still misread one character (T as I) at that resolution, worth a quick visual check against the real Ed post.

## v1.3.45
Fixed pairRowsWithCodeColumn so a row's own OCR reading can only block the crop derived code when it actually agrees with it, instead of letting any pattern shaped fragment block it outright. The fix itself was correct, but v1.3.46 found it was unreachable for the one row it was meant to help.

## v1.3.44
Removed a similar count based rescue gate in the non wideShort table branch. That gate could let an entire dropped table row go unrescued even though the codes and rows counts still looked balanced.

## v1.3.43
Fixed three separate causes of FIT2102, FIT2109 and FIT3162 codes never being found at all: Ed's lazy loaded discussion list, course links tagged with every enrolled unit's code instead of just their own, and Moodle's My units page needing far longer than the old wait budget to render.

## v1.3.42
Added the debug logging that made the three problems above visible instead of guesswork.

## v1.3.41
Fixed the Ed fallback's flat two thread cap, a related but separate problem from the lazy loading issue above.

## v1.3.40
Sent an opened Gmail message's screenshot based code tables to OCR.

## v1.3.39
Filled in the weeks that Attendance's own UI can no longer show at all.

## v1.3.38
Added the on screen requested versus actual date range, and fixed a debug log write race.

## v1.3.37
Fixed a flat Gmail thread cap that was sized for a single week's scan.
