# Monash Attendance Helper

**English** | [简体中文](README.zh-CN.md)

A privacy-focused Chrome extension that helps Monash students discover recent attendance activities, find matching attendance codes from Gmail, Ed Discussion, and Moodle, review the results, and submit only after explicit confirmation.

The default mode does **not** require a manually entered timetable. It reads recent activities from the Monash Attendance account already signed in to the same Chrome profile, keeps completed activities visible, and searches the student's signed-in Monash learning services for matching attendance codes.

> **Important:** This project is not an unattended auto-attendance bot. It prepares attendance information for review. The student must confirm that they actually attended the class before any record can be submitted.

## Features

- Discovers recent activities from **Monash Attendance** automatically.
- Keeps activities that Attendance already marks as completed and shows them as completed instead of hiding them.
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
Review page
  ↓
Student confirmation
```

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
10. Save the settings and use the test / re-scan option to review the detected activities and codes.

After updating the repository locally, return to `chrome://extensions` and reload the unpacked extension.

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

MIT
