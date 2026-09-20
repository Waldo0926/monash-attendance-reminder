# Monash Attendance Helper

[![Type](https://img.shields.io/badge/Type-Chrome_Extension-2563eb?style=for-the-badge)](#)
[![Tech](https://img.shields.io/badge/Tech-JavaScript-7c3aed?style=for-the-badge)](#)
[![Platform](https://img.shields.io/badge/Platform-Windows_%7C_macOS_%7C_Linux-16a34a?style=for-the-badge)](#platform-support)
[![License](https://img.shields.io/badge/License-All_Rights_Reserved-dc2626?style=for-the-badge)](#)

**English** | [简体中文](README.zh-CN.md)

> Current extension build: **v1.3.46**. Full version history: [CHANGELOG.md](CHANGELOG.md).

A privacy-focused, cross-platform Chrome extension that helps Monash students discover recent attendance activities, find matching attendance codes from Gmail, Ed Discussion, and Moodle, review the results, and submit only after explicit confirmation.

The default mode does **not** require a manually entered timetable. It reads recent activities from the Monash Attendance account already signed in to the same Chrome profile, keeps completed activities visible, and searches the student's signed-in Monash learning services for matching attendance codes.

> **Important:** This project is not an unattended auto-attendance bot. It prepares attendance information for review. The student must confirm that they actually attended the class before any record can be submitted.

## Features

- Discovers recent activities from **Monash Attendance** automatically, looking back over the past week and forward through the end of the current week, to cover accounts whose portal publishes several days ahead.
- Keeps activities that Attendance already marks as completed and shows them as completed instead of hiding them.
- Keeps multiple completed activities on the same date separate by course, activity, class number, and time.
- Searches for attendance codes in this order:
  1. **Gmail** — recent attendance-related messages.
  2. **Ed Discussion** — recent attendance posts for courses that use Ed.
  3. **Moodle** — the relevant unit, recent Week/section pages, and Attendance activities.
- Parses text-based attendance tables directly.
- Uses bundled, local OCR for attendance tables posted as images.
- Matches codes against available course, activity type, class number, date, and time information.
- Marks uncertain matches for manual review instead of silently guessing.
- Qualifies every status by "this week" or "last week" — no code found this week is usually just the teacher not having posted it yet; the same gap last week means Attendance still hasn't shown it as completed and is worth checking by hand.
- Shows a class as "not started" once it has a scheduled start time still ahead of now, even if a code was already found early — it is shown as information, never as something ready to submit.
- Runs scanning and final reconciliation as one background step, so it no longer depends on the popup or a page staying open for the whole duration.
- Logs key steps to persistent storage and renders that log on the confirm page, so troubleshooting does not require opening DevTools.
- Sends Chrome reminders at configurable times.
- Requires an explicit attendance declaration before submission.
- Never places a completed or not-yet-started Attendance record on the submission path.
- Supports a manual timetable only as an optional fallback.

Reminder times use the **current system timezone of the computer running Chrome**.

## Platform support

This project is a Chrome extension plus a browser-based configurator, not a native macOS application. The same unpacked-extension workflow is intended to work on **Windows, macOS, and Linux** wherever a compatible desktop Chrome/Chromium environment provides the required extension APIs.

There are no macOS-only runtime dependencies in the extension itself. Platform-specific development comments or tests in the repository do not make the user-facing extension macOS-only.

## How automatic discovery works

Keep these services signed in to the **same Chrome profile**:

- Monash Attendance
- Gmail
- Monash Moodle
- Ed Discussion, if your units use Ed

The extension follows this general flow:

```text
Monash Attendance
  ↓
Discover recent activities and completed status
  ↓
Gmail
  ↓ if unresolved
Ed Discussion
  ↓ if unresolved
Moodle
  ↓
Match by available course / activity / class / date / time evidence
  ↓
Final Attendance reconciliation
  ↓
Review page
  ↓
Student confirmation for incomplete records only
```

Completed rows discovered through the Attendance portal are assigned a stable per-session identity so several completed activities on the same date do not collapse into one result. Final reconciliation reads a row's completed status directly from the live Attendance DOM rather than relying on anything injected into the page; a genuine `Entry.aspx` link remains a pending Attendance entry. Scanning and final reconciliation are chained inside a single background message rather than requiring the popup or the confirm page to stay open for both steps - a popup closing mid-scan used to silently skip reconciliation entirely.

### Moodle fallback

Moodle discovery does more than inspect the `My units` page. For unresolved classes, the extension can follow the relevant unit into recent Week/section pages and continue into Attendance-related activities when they are available.

This is useful for units where attendance codes are published only inside Moodle rather than Gmail or Ed.

## Completed attendance records

The review page should show both incomplete and already-completed activities.

A completed record is displayed as completed and cannot be submitted again. Every card is also labelled "this week" or "last week", making it easy to distinguish between:

- **completed** — Attendance already shows it done; cannot be resubmitted.
- **not started** — the class hasn't reached its scheduled start time yet; a code found this early is shown for information only, and the checkbox stays disabled.
- **high confidence** — a likely-correct code, ready for the student to review and submit.
- **needs review** — a candidate code the student must confirm by hand.
- **not found** — this week, that's usually just a normal wait for the teacher to publish it; last week, it means Attendance still hasn't shown it as completed and is worth checking manually.

## Install in Chrome (Windows / macOS / Linux)

1. Open this repository's GitHub page, click the green **Code** button, then **Download ZIP**. (If you already use git, `git clone` works too.)
2. Find the downloaded ZIP file, usually in your Downloads folder, and extract it. On Windows, right click the file and choose **Extract All**. On macOS, double click the ZIP to unzip it.
3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** using the toggle in the top right corner.
5. Click **Load unpacked**.
6. In the folder picker, open the extracted folder and select the **extension** subfolder inside it, not the top level repository folder.
7. The extension icon should now appear in the toolbar. Click the puzzle piece icon next to the address bar and pin **Monash Attendance Helper** if you want quick access.
8. Click the extension icon, or right click it and choose **Options**, to open the settings page.
9. Sign in to Gmail, Monash Moodle, Ed Discussion (if your units use it), and Monash Attendance in the same Chrome profile the extension is running in.
10. On the settings page, keep automatic Attendance discovery turned on, set this semester's Week 1 Monday date, and choose your reminder time(s).
11. Click **Save, then test now**. This runs the preliminary scan and the final Attendance reconciliation as one background step, and reports how many activities and codes it found once both are done. You don't need to keep the settings page open the whole time.

After pulling repository updates later, return to `chrome://extensions` and reload the unpacked extension. The version shown there should match `extension/manifest.json`.

## Using it day to day

Once set up, the extension keeps discovering and scanning in the background and sends a Chrome notification at the reminder time(s) you configured.

1. When a reminder notification appears, click it, or click the extension icon, to open the review page.
2. Each class shows up as a card labelled completed, not started, high confidence, needs review, or not found, the same statuses described above under Completed attendance records.
3. For a high confidence or needs review card, check the code against its source (Gmail, Ed, or Moodle) if you are unsure, tick the attendance declaration checkbox, and submit.
4. Completed and not started classes are shown for information only and cannot be submitted from here.
5. Use the **Export semester history** button on the settings page any time you want a full CSV record of the semester so far, for example before asking a unit coordinator for a manual correction.

Only ever submit attendance for classes you actually attended.

## Exporting this semester's history

Attendance usually only accepts a backdated submission up to about a week ago, so a class forgotten earlier in the semester can't be fixed there. The "Export semester history" button at the bottom of the settings page re-runs the full discovery/matching pipeline from Week 1 through today (restoring already-cached codes first to avoid re-searching everything), and downloads the result as a CSV - useful as a record to keep, or to send a unit coordinator when asking for a manual correction. Requires Week 1's Monday to be set above, and can take a few minutes for a long semester.

## Manual timetable fallback

Automatic discovery is the recommended mode, but a manual timetable is still available as a fallback.

A manual course entry can include:

- course code or name;
- Moodle or Ed source URL;
- optional Ed category;
- the Tutorial, Workshop, Laboratory, Studio, Applied, Seminar, or other class groups that the student actually attends;
- weekday and start time for each class group.

The repository does **not** ship with a personal timetable that other students are expected to use. Example configuration files under `examples/` are demonstration data only.

## Web configurator

The `site/` directory contains a graphical configurator that can generate:

```text
attendance-helper-config.json
```

The generated file can be imported from the extension settings page.

## Privacy and safety

The extension does not upload the following information to this repository or its website:

- Monash or Gmail passwords;
- login cookies;
- email bodies;
- Moodle or Ed page contents;
- attendance codes;
- personal timetable data.

OCR runs locally inside the extension. The OCR worker, WebAssembly core, and English recognition model are bundled with the extension package rather than sending screenshots to a third-party OCR service.

## Safety by design

An attendance code is not proof that a student attended a class. For that reason, the extension deliberately keeps a human confirmation step:

- high-confidence results can be prepared for review;
- uncertain results remain clearly marked;
- completed activities are not submitted twice;
- missing or ambiguous codes are not guessed;
- the attendance declaration must be confirmed before submission.

## Important limitations

- Each Chrome profile must be configured separately.
- Gmail, Moodle, Ed, and Monash Attendance may change their page structures over time.
- Expired login sessions still require the student to sign in again.
- OCR can make mistakes, so image-derived results should be checked when marked for review.
- Some units may publish attendance information differently from the currently supported patterns.
- Some Monash pages can visibly render usable content while Chrome still reports a tab as `loading`; the final reconciliation reads the usable DOM directly, but a genuinely unavailable page can still fail - and gets recorded in the debug log when it does.
- The lookback window only extends through the end of the current week; it never reads ahead into the next teaching week.
- The project cannot guarantee compatibility with every unit or every future Monash page layout.

## Development and testing

Run the extension parser and regression tests:

```sh
node --test tests/*.test.mjs
```

Run the web configurator checks:

```sh
cd site
npm ci
npm test
npm run lint
```

Regression coverage includes Gmail multi-account discovery, strict per-class matching, OCR packaging, Moodle fallback, completed-row retention, same-day multiple completed sessions, completed-vs-pending `Entry.aspx` handling, final-reconciliation flow, no-resubmit safeguards, `executeScript` timeout bounds, this-week/last-week status labelling, the not-started placeholder and its submission block, and the forward-extended lookback window.

Pull requests also run automated checks through GitHub Actions.

## Project structure

```text
extension/   Chrome extension
site/        Web configurator
examples/    Example configuration files
scripts/     Helper scripts
tests/       Automated and regression tests
```

## Disclaimer

This is a student-built helper tool. It is **not an official Monash University product** and is not operated by Monash University, a faculty, or a teaching team.

Use it in accordance with Monash attendance, academic integrity, and IT policies. Only submit attendance for classes you actually attended.

## License

Fellow Monash students are welcome to use this as-is (share the repo, help a friend load it into their own Chrome), but it is not licensed for modified redistribution, and please do not fork it, strip out the manual confirmation step, or turn it into an unattended auto-submit tool.

If you want to build something similar, write your own implementation and keep a real confirmation step in it - that's the academic-integrity point this project is trying to make, and the one thing that should never change.

Use of this extension is entirely at your own risk and must follow Monash's attendance, academic-integrity, and IT policies.