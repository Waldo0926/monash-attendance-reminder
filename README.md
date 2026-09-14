# Monash Attendance Helper

> Current extension build: **v1.3.13** — keeps the v1.3.11 cross-course and class-group safety checks, and fixes a regression where Ed can flatten multiple visual attendance rows into one DOM text line. Matching now isolates the local `Workshop/Tutorial ... Code` slice around each code before validating the class number, restoring valid rows such as `FIT2109 Workshop 02 → SQP3R` without allowing `FIT2102 Tutorial 06 → X9JJB` to leak into FIT2109 Tutorial 05.

A configurable Chrome extension that discovers recent classes from Monash Attendance, finds attendance codes from Gmail, Moodle, and Ed, reminds students, and submits only after confirmation.

The default mode does **not** require a manually entered timetable. It reads the last seven days of available activities from the signed-in Monash Attendance account, then searches the signed-in Gmail, Moodle, and Ed sessions for matching codes. A manual timetable remains available only as a fallback.

The extension never uploads credentials, page content, attendance codes, or your timetable to this project or its website. OCR runs locally inside the extension; its engine and English model are bundled with the download. Ed discovery also uses short nearby link context so course/thread links remain detectable when Ed renders the visible title outside the anchor itself.

The bundled OCR worker is loaded directly from the extension package (rather than through a `blob:` worker), so it remains compatible with Chrome Manifest V3's extension-page Content Security Policy. Before OCR, Chromium decodes each source image and re-encodes it as PNG, so Ed images delivered as browser-native formats such as WebP/AVIF do not get passed directly to Leptonica. Ephemeral `blob:` images are snapshotted while the Ed page is still open.

## What it does

1. Reads recent activities from the Monash Attendance account already signed in to the same Chrome profile.
2. Runs at your configured primary and optional backup reminder times.
3. Searches the signed-in Gmail account and discovers matching Moodle / Ed course pages in background tabs. Attendance-code tables posted as images are read locally with bundled OCR.
4. Matches five-character attendance codes against the course, class label, and activity date.
5. Sends a system notification and opens a review page when clicked.
6. Submits only the rows selected by the student after the student ticks the explicit attendance declaration.

Reminder times use the **current system timezone of the computer running Chrome**. The timezone is detected automatically rather than being fixed to Malaysia.

## Automatic discovery (default)

Keep Monash Attendance, Gmail, Moodle, and Ed signed in to the same Chrome profile. Leave **Automatically discover classes from Attendance** enabled. No Week 1 date or manual course list is required.

The extension checks activities whose Attendance date is up to seven days old, inclusive of today and the date exactly seven days earlier. It only prepares a review list; it never submits without the student's explicit attendance declaration and confirmation.

## Manual timetable (optional fallback)

For each course, add:

- **Course code / name** — for example `FIT2004`.
- **Source** — Moodle or Ed Discussion.
- **Source URL** — use a supported Monash Moodle URL under `https://learning.monash.edu/` or an Ed URL under `https://edstem.org/`.
- **Ed category** — optional; for example `Malaysia` if your Ed course uses that category.
- **Class groups** — add every tutorial, workshop, studio, applied, seminar, or other class that you actually attend, together with its weekday and start time.

There are intentionally **no default FIT3162 / FIT2102 / FIT2109 routes**. Those were the original developer's timetable and are now kept only as an example configuration under `examples/`.

## Install in Chrome

1. Download this repository and unzip it.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `extension` folder.
5. Pin **Monash Attendance Helper**.
6. Open the extension settings.
7. Keep automatic Attendance discovery enabled and set the reminder times.
8. Keep Gmail, Moodle, Ed, and Monash Attendance signed in in the same Chrome profile.
9. Click **Save, then test now** and review the detected classes and codes.

The graphical configurator in `site/` can generate an `attendance-helper-config.json` file. Import it from the extension settings page with **Import web config**.

## Example configuration

`examples/mum-2026-s2-example.json` demonstrates the configuration format using one student's 2026 Semester 2 MUM timetable. It is **example data only**. Do not assume its course URLs, class groups, dates, or reminder times match your own timetable.

## Important limits

- The extension must be installed separately in every Chrome profile/account that should be monitored.
- The computer must be awake and Chrome must be able to run at the scheduled time. Chrome will normally deliver a missed alarm after it next starts, but an expired login still needs the student to sign in again.
- Course staff may change post layouts. Codes marked **Review** must be checked against the shown source text before submission. Review-level matches are intentionally **not pre-selected** on the confirmation page; only high-confidence matches are checked by default.
- A code is never proof that the student attended. Only submit a record for a class actually attended.
- The confirmation page asks for the attendance declaration every time. It is intentionally not an unattended auto-submit bot.
- Automatic matching depends on the course/activity labels exposed by Attendance and the wording in the source. Ambiguous matches remain unchecked for review.

## Test

Run the extension parser tests:

```sh
node --test tests/*.test.mjs
```

Run the site build/render tests and lint checks:

```sh
cd site
npm ci
npm test
npm run lint
```

Then load the extension unpacked, keep automatic discovery enabled, and use **Save, then test now** from its settings page. The test should produce a Chrome notification and a recent-activities review page.

Pull requests also run these automated checks through GitHub Actions.

## License

MIT


## v1.3.13 regression fix

- Wide/short Ed screenshots are no longer assumed to contain only one row. The OCR pipeline now evaluates both `SINGLE_BLOCK` and `SINGLE_LINE`, preserving FIT2109 multi-row Workshop tables while retaining the FIT2102 `JY4H6` one-row rescue.
- A noisy `SINGLE_LINE` result is ignored unless it contains a session row or plausible attendance code.
- Right-column OCR is now a fallback for wide/short images rather than the primary path when the block pass already recovered all rows/codes.
- Regression coverage keeps `JY4H6`, `JKAHX`, `SQP3R`, `ZS9CR` and the `X9JJB` cross-course guard together.
