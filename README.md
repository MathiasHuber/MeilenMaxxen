# MeilenMaxxen

A small, offline-first running planner that builds your weekly kilometres step by step. No build step, no dependencies, no account. Data stays on your device. Same look as Starkheben 5×5, in blue.

## How the progression works

- **First week:** 5 km spread over your first week's days (two runs of 2.5 km, Tuesday and Saturday, by default).
- **Every week:** 0.5 km steps are added until one more step would take the week past +10%; the last step that fits is the plan. 10 km → 10.5 (+5%) → 11 (+10%) → 11.5 would be +15%, so next week is 11 km. Always at least one step, so small weeks still move on. Each step goes to the shortest run, so the runs grow evenly: 2.5/2.5 → 3/2.5 → 3/3 → …
- **A new running day before each 10 km:** when next week would reach 10 km (then 20, 30…), the app suggests another running day instead. The week's kilometres are spread over one more run, so each run gets easier.
- **Long run:** the first time a day is added, you pick your long run day. From then on each step goes to the long run while it stays at most 50% of the week (the long run share in Settings); the other steps even out your other runs. When more days are added later, the long run keeps its distance.
- **Long run limit:** once the long run would pass 28 km, it may only take 30% of the week, so the extra kilometres go to the other runs.
- **Days you can run:** suggestions only put runs on the days you tick. A run from last week on a day you've ruled out moves to a free day you can run on.
- **Goal:** set a weekly goal (say 30 km) and the suggestions build up to it, then keep your week steady.
- **The 10% rule:** a plan that grows more than 10% over your last running week gets a warning (and a confirmation the moment an edit crosses the line). You can still plan it. A single step (0.5 km) is always fine, so the early weeks don't warn; the suggestions themselves never warn.

All of these numbers can be changed in Settings or under **Suggestion settings** in the Plan tab.

## Features

- **Today:** this week's kilometres against the plan, today's run with a log form (pre-filled with the planned distance, so 2.5 planned → type 2.7), runs from this and last week that aren't logged yet, and runs that weren't planned.
- **Plan:** open any week. An empty week shows the suggested plan (built from your last week) as a week preview; use it or copy last week as is. Then change kilometres (− / + or type), move runs to another day, mark the long run (★), add runs, or remove them (with a warning).
- **Plan ahead:** plan the next X weeks (12 by default) in one go from the suggestions. A chart shows each week and the peak you'd reach. **Remove all runs after this week** clears the plan from next week on (with a warning); this week and logged runs stay.
- **Calendar:** a month view of run, planned, long and missed runs with their kilometres. Tap a day to log, move, delete or add a run.
- **Progress:** weekly kilometres as columns (12 weeks and 6 months start at the current week; All shows your whole history) (what's still planned this week drawn dashed), tap a week for its numbers. Totals, best week.
- **Milestones:** a 10 km week, then 20, 30… (the step is a setting) with the week you first reached each one.
- **Streak:** weeks in a row with more kilometres than the week before. This week joins as soon as you beat last week.
- **Export / Import:** a JSON file of all runs and settings.

## Run it

```bash
npm start          # serves on http://localhost:8080
npm test           # logic tests (Node 20+)
```

## Android app

`android/` wraps the app in a small native WebView shell (same as Starkheben). No internet permission; data stays on the phone.

```bash
sudo apt-get install android-sdk-platform-23 aapt dalvik-exchange zipalign apksigner
./android/build.sh                       # dist/meilenmaxxen.apk, signed with a local debug key
BUNDLETOOL=bundletool-all.jar UPLOAD_KEYSTORE=… UPLOAD_STORE_PASS=… ./android/build.sh   # also dist/meilenmaxxen.aab for Google Play
```

Icons are generated from `store/icon-art.mjs` with `node store/make-icons.mjs` (needs Playwright).

## Layout

- `src/mileage.js`: runs, weekly totals, progression suggestions, the 10% check, streaks, milestones, validation and backup
- `src/dates.js`: date keys and weeks (Monday to Sunday)
- `src/app.js`: UI and storage
- `src/styles.css`: the Starkheben design, with blue as the accent
- `tests/`: unit tests for the logic
- `scripts/build-single.mjs`: bundles everything into one HTML file (used by the Android build)
- `android/`: native Android shell and its build script
