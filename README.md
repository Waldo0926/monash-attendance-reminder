# Monash Attendance Helper

[![Type](https://img.shields.io/badge/Type-Chrome_Extension-2563eb?style=for-the-badge)](#)
[![Tech](https://img.shields.io/badge/Tech-JavaScript-7c3aed?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/License-All_Rights_Reserved-dc2626?style=for-the-badge)](#)


**English** | [简体中文](README.zh-CN.md)

> Current extension build: **v1.3.23** — completed Attendance rows are retained through final reconciliation, synthetic completed-row links are distinguished from genuine pending `Entry.aspx` links, already-open Attendance tabs are repaired after an extension reload, and **Save, then test now** waits for final reconciliation before reporting results.

A privacy-focused Chrome extension that helps Monash students discover recent attendance activities, find matching attendance codes from Gmail, Ed Discussion, and Moodle, review the results, and submit only after explicit confirmation.

The default mode does **not** require a manually entered timetable. It reads recent activities from the Monash Attendance account already signed in to the same Chrome profile, keeps completed activities visible, and searches the student's signed-in Monash learning services for matching attendance codes.

> **Important:** This project is not an unattended auto-attendance bot. It prepares attendance information for review. The student must confirm that they actually attended the class before any record can be submitted.

## Features

- Discovers recent activities from **Monash Attendance** automatically.
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
- Sends Chrome reminders at configurable times.
- Requires an explicit attendance declaration before submission.
- Never places a completed Attendance record on the submission path.
- Supports a manual timetable only as an optional fallback.

Reminder times use the **current system timezone of the computer running Chrome**.

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

Completed rows discovered through the Attendance portal are assigned a stable per-session identity so several completed activities on the same date do not collapse into one result. A synthetic discovery link carrying `mah_completed=1` is treated only as completed-state evidence; a genuine `Entry.aspx` link remains a pending Attendance entry.

### Moodle fallback

Moodle discovery does more than inspect the `My units` page. For unresolved classes, the extension can follow the relevant unit into recent Week/section pages and continue into Attendance-related activities when they are available.

This is useful for units where attendance codes are published only inside Moodle rather than Gmail or Ed.

## Completed attendance records

The review page should show both incomplete and already-completed activities.

A completed record is displayed as completed and cannot be submitted again. This makes it easier to distinguish between:

- already completed attendance;
- a high-confidence code ready for review;
- an uncertain code that needs checking;
- no code found.

## Install in Chrome

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the `extension` folder from this repository.
6. Pin **Monash Attendance Helper** if desired.
7. Open the extension settings.
8. Keep automatic Attendance discovery enabled and configure reminder times.
9. Keep Gmail, Moodle, Ed, and Monash Attendance signed in to the same Chrome profile.
10. Click **Save, then test now**. In v1.3.23 the test performs the preliminary scan and final Attendance reconciliation before reporting final counts.

After updating the repository locally, return to `chrome://extensions` and reload the unpacked extension. The displayed version should match `extension/manifest.json`.

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
- Some Monash pages can visibly render usable content while Chrome still reports a tab as `loading`; the final reconciliation reads the usable DOM directly, but a genuinely unavailable page can still fail.
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

Regression coverage includes Gmail multi-account discovery, strict per-class matching, OCR packaging, Moodle fallback, completed-row retention, same-day multiple completed sessions, completed-vs-pending `Entry.aspx` handling, final-reconciliation flow, and no-resubmit safeguards.

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
