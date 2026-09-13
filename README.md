# Monash Attendance Helper

A configurable Chrome extension that discovers recent classes from Monash Attendance, finds attendance codes from Gmail, Moodle, and Ed, reminds students, and submits only after confirmation.

The default mode does **not** require a manually entered timetable. It reads the last seven days of available activities from the signed-in Monash Attendance account, then searches the signed-in Gmail, Moodle, and Ed sessions for matching codes. A manual timetable remains available only as a fallback.

The extension never uploads credentials, page content, attendance codes, or your timetable to this project or its website.

## What it does

1. Reads recent activities from the Monash Attendance account already signed in to the same Chrome profile.
2. Runs at your configured primary and optional backup reminder times.
3. Searches the signed-in Gmail account and discovers matching Moodle / Ed course pages in background tabs.
4. Matches five-character attendance codes against the course, class label, and activity date.
5. Sends a system notification and opens a review page when clicked.
6. Submits only the rows selected by the student after the student ticks the explicit attendance declaration.

Reminder times use the **current system timezone of the computer running Chrome**. The timezone is detected automatically rather than being fixed to Malaysia.

## Automatic discovery (default)

Keep Monash Attendance, Gmail, Moodle, and Ed signed in to the same Chrome profile. Leave **Automatically discover classes from Attendance** enabled. No Week 1 date or manual course list is required.

The extension checks the rolling seven-day window ending on the day it runs. It only prepares a review list; it never submits without the student's explicit attendance declaration and confirmation.

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
- Course staff may change post layouts. Codes marked **Review** must be checked against the shown source text before submission.
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
