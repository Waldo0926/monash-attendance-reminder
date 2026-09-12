# Monash Attendance Helper

A local Chrome extension that checks the Moodle or Ed pages **you configure**, looks for likely attendance codes for your own class groups, sends a notification, and shows a final confirmation screen before submitting anything to Monash Attendance.

The project does **not** ship with another student's timetable as the default. Each user adds their own courses, source pages, class groups, semester Week 1 date, and reminder times.

The extension never uploads credentials, page content, attendance codes, or your timetable to this project or its website.

## What it does

1. Uses the courses and class groups saved in your local extension settings.
2. Runs at your configured primary and optional backup reminder times.
3. Opens each enabled Moodle or Ed source in a background tab using the Chrome session that is already signed in.
4. Calculates the current teaching week from the Week 1 Monday you provide.
5. Matches five-character attendance codes against the course, week, class label, day, and time.
6. Sends a system notification and opens a review page when clicked.
7. Submits only the rows selected by the student after the student ticks the explicit attendance declaration.

## Configure your own timetable

For each course, add:

- **Course code / name** — for example `FIT2004`.
- **Source** — Moodle or Ed Discussion.
- **Source URL** — the page where that course publishes attendance codes.
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
7. Set the semester Week 1 Monday and reminder times.
8. Add your own courses and class groups, then click **Save and enable**.
9. Keep Moodle, Ed, and Monash Attendance signed in in the same Chrome profile.

The graphical configurator in `site/` can generate an `attendance-helper-config.json` file. Import it from the extension settings page with **Import web config**.

## Example configuration

`examples/mum-2026-s2-example.json` demonstrates the configuration format using one student's 2026 Semester 2 MUM timetable. It is **example data only**. Do not assume its course URLs, class groups, dates, or reminder times match your own timetable.

## Important limits

- The computer must be awake and Chrome must be able to run at the scheduled time. Chrome will normally deliver a missed alarm after it next starts, but an expired login still needs the student to sign in again.
- Course staff may change post layouts. Codes marked **Review** must be checked against the shown source text before submission.
- A code is never proof that the student attended. Only submit a record for a class actually attended.
- The confirmation page asks for the attendance declaration every time. It is intentionally not an unattended auto-submit bot.
- The attendance matching logic depends on the class label you configure. Use the label staff normally write near the code, such as `Tutorial 03`, `Workshop 01`, or `Studio 2`.

## Test

Run the parser tests:

```sh
node --test tests/*.test.mjs
```

Then load the extension unpacked, configure at least one real course, and use **Save, then test now** from its settings page. The test should produce a Chrome notification and a Week review page.

## License

MIT
