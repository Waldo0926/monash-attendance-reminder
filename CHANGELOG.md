# Changelog

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
