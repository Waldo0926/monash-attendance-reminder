#!/bin/zsh

set -eu

ATTENDANCE_URL="https://attendance.monash.edu.my/student/Default.aspx"
FIT3162_URL="https://learning.monash.edu/course/view.php?id=44555"
FIT2109_URL="https://edstem.org/au/courses/39026/discussion"
FIT2102_URL="https://edstem.org/au/courses/36340/discussion?category=Malaysia"

/usr/bin/osascript -e 'display notification "请检查 FIT3162、FIT2109 和 FIT2102 本周签到码；填写后再关闭页面。" with title "Monash Attendance Reminder" sound name "Glass"'

/usr/bin/open -a "Google Chrome" "$FIT3162_URL"
/usr/bin/open -a "Google Chrome" "$FIT2109_URL"
/usr/bin/open -a "Google Chrome" "$FIT2102_URL"
/usr/bin/open -a "Google Chrome" "$ATTENDANCE_URL"

