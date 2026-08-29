# Monash Attendance Reminder

This small macOS helper opens the configured course attendance-code sources and the Monash Attendance page in Google Chrome. It is intended to prevent forgotten submissions while keeping the final attendance confirmation manual.

> This project does not collect credentials, extract attendance codes, or submit attendance on a student's behalf. Only record attendance when you actually attended the class.

## Schedule

- Sunday at 7:00 PM
- Monday at 10:00 AM (backup reminder)

## Install

Double-click `install.command`. macOS may ask for permission to run it. The installer opens all four pages once so you can verify the setup.

The helper uses the login sessions already present in Google Chrome. It does not read or store passwords and does not submit attendance codes.

The bundled URLs and schedule are configured for the current Monash units. Edit `attendance-reminder.sh` and `com.monash.attendance-reminder.plist` before installing if your units or preferred reminder times differ.

## Run manually

Double-click `attendance-reminder.sh`, or run it from Terminal.

## Uninstall

Run these commands in Terminal:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.monash.attendance-reminder.plist"
rm "$HOME/Library/LaunchAgents/com.monash.attendance-reminder.plist"
rm -r "$HOME/Library/Application Support/MonashAttendanceReminder"
```

## License

MIT
