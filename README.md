# Monash Attendance Helper

A local Chrome extension that checks logged-in Moodle and Ed pages on a weekly schedule, finds likely attendance codes for configured class groups, sends a notification, and shows a final confirmation screen before submitting anything to Monash Attendance.

The extension never uploads credentials, page content, or attendance codes to this project or its website.

## What it does

1. Runs at the configured primary and backup reminder times.
2. Opens each enabled source in a background tab, using the Chrome session that is already signed in.
3. Calculates the current teaching week from the configured Week 1 Monday.
4. Matches five-character attendance codes against the course, week, class type, class number, day, and time.
5. Sends a system notification and opens a review page when clicked.
6. Submits only the rows selected by the student after the student ticks the explicit attendance declaration.

Default course routing:

- FIT3162: current-week section on Moodle.
- FIT2102: Ed Discussion, Malaysia category.
- FIT2109: Ed Discussion.

## Install in Chrome

1. Download this repository and unzip it.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `extension` folder.
5. Pin **Monash Attendance Helper**.
6. Open the extension settings, verify the class groups and reminder time, then click **Save and enable**.
7. Keep Moodle, Ed, and Monash Attendance signed in in the same Chrome profile.

The graphical configurator can export an `attendance-helper-config.json` file. Import it from the extension settings page.

## Important limits

- The computer must be awake and Chrome must be able to run at the scheduled time. Chrome will normally deliver a missed alarm after it next starts, but an expired login still needs the student to sign in again.
- Course staff may change post layouts. Codes marked **Review** must be checked against the shown source text before submission.
- A code is never proof that the student attended. Only submit a record for a class actually attended.
- The confirmation page asks for the attendance declaration every time. It is intentionally not an unattended auto-submit bot.

## Test

Run the parser tests:

```sh
node --test tests/*.test.mjs
```

Then load the extension unpacked and use **Save, then test now** from its settings page. The test should produce a Chrome notification and a Week review page.

## License

MIT
