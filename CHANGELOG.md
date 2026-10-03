# Changelog

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
