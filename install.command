#!/bin/zsh

set -eu

INSTALLER_DIR="${0:A:h}"
TARGET_DIR="$HOME/Library/Application Support/MonashAttendanceReminder"
TARGET_SCRIPT="$TARGET_DIR/attendance-reminder.sh"
TARGET_PLIST="$HOME/Library/LaunchAgents/com.monash.attendance-reminder.plist"
USER_ID="$(/usr/bin/id -u)"

/bin/mkdir -p "$TARGET_DIR" "$HOME/Library/LaunchAgents"
/bin/cp "$INSTALLER_DIR/attendance-reminder.sh" "$TARGET_SCRIPT"
/bin/chmod 755 "$TARGET_SCRIPT"

/usr/bin/sed "s|__SCRIPT_PATH__|$TARGET_SCRIPT|g" \
  "$INSTALLER_DIR/com.monash.attendance-reminder.plist" > "$TARGET_PLIST"

/bin/launchctl bootout "gui/$USER_ID" "$TARGET_PLIST" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$USER_ID" "$TARGET_PLIST"

echo "Installed successfully."
echo "Reminders: Sunday 7:00 PM and Monday 10:00 AM."
echo "Opening the attendance pages once now for verification..."
"$TARGET_SCRIPT"

read -r "?Press Return to close this window."

