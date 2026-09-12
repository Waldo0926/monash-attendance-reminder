# Attendance Helper Configurator

This directory contains the web configurator for **Monash Attendance Helper**.

It starts with an empty timetable. Each student adds their own courses, Moodle or Ed source pages, class groups, Week 1 date, and reminder times. The page then generates an `attendance-helper-config.json` file that can be imported from the Chrome extension settings.

No login session, Moodle or Ed page content, attendance code, or generated timetable is uploaded by the configurator.

## Supported sources

The current Chrome extension permissions support:

- Monash Moodle pages under `https://learning.monash.edu/`
- Ed pages under `https://edstem.org/`
- Monash Malaysia Attendance under `https://attendance.monash.edu.my/`

Reminder times run according to the computer's current system timezone.

## Local development

Node.js `>=22.13.0` is required.

```bash
npm ci
npm run dev
```

Useful verification commands:

```bash
npm test
npm run lint
```

`npm test` builds the site and runs the rendered HTML test.

## Main files

- `app/page.tsx` — per-user timetable/configuration builder
- `app/globals.css` — configurator styles
- `tests/rendered-html.test.mjs` — build/render smoke test

The Chrome extension itself lives in the repository-level `extension/` directory.
