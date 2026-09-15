const ATTENDANCE_TAB_PATTERN = "https://attendance.monash.edu.my/student/Units.aspx*";

async function injectIntoExistingAttendanceTabs() {
  const tabs = await chrome.tabs.query({ url: ATTENDANCE_TAB_PATTERN }).catch(() => []);
  await Promise.all(tabs.map(async (tab) => {
    if (!tab?.id) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["attendance-portal-shim.js"]
      });
    } catch {
      // A tab can be closing, navigating, or not scriptable yet. New navigations are still
      // covered by manifest content_scripts, so this startup repair is intentionally best-effort.
    }
  }));
}

// Extension reloads do not retroactively run manifest content scripts in tabs that were
// already open. Inject the completed-row detector immediately when the service worker starts
// so a developer reload cannot make already-signed classes disappear from the next scan.
injectIntoExistingAttendanceTabs().catch(() => {});

chrome.runtime.onStartup.addListener(() => {
  injectIntoExistingAttendanceTabs().catch(() => {});
});
