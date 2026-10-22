import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState, suggestWeek, runsFromItems, template, baseline, increaseCheck, streakWeeks, milestones,
  bestFreeDay, weeklySeries, weeklyIncrease, planAhead, futurePlanned, setLong, migrate, readBackup, makeBackup, plannedTotal, actualTotal,
} from "../src/mileage.js";
import { addDays } from "../src/dates.js";

const MON = "2026-01-05"; // a Monday
let n = 0;
const id = () => `r${++n}`;
const run = (date, planned, actual = null, long = false) => ({ id: id(), date, planned, actual, long });
const kms = (s) => s.runs.map((r) => `${r.wd}:${r.km}${r.long ? "L" : ""}`).join(" ");

/** Plans each week from the suggestion and logs every run as planned. */
function simulate(weeks, longDay = 0) {
  const state = createState();
  const log = [];
  for (let i = 0; i < weeks; i++) {
    const monday = addDays(MON, 7 * i);
    const s = suggestWeek(state.runs, monday, state.settings, longDay);
    log.push({ kind: s.kind, runs: kms(s), total: s.total });
    state.runs.push(...runsFromItems(s.runs, monday, id).map((r) => ({ ...r, actual: r.planned })));
  }
  return log;
}

test("first week: two easy runs", () => {
  const s = suggestWeek([], MON, createState().settings);
  assert.equal(s.kind, "start");
  assert.equal(kms(s), "2:2.5 6:2.5");
});

test("two runs grow evenly in half kilometres, a day is added before 10 km with a long run", () => {
  const log = simulate(13);
  assert.deepEqual(log.map((l) => l.runs), [
    "2:2.5 6:2.5",
    "2:3 6:2.5",
    "2:3 6:3",
    "2:3.5 6:3",
    "2:3.5 6:3.5",
    "2:4 6:3.5",
    "2:4 6:4",
    "2:4.5 6:4",
    "2:4.5 6:4.5",
    "2:5 6:4.5",
    "2:3 6:3 0:4L", // 9.5 km + 0.5: a third day on Sunday, the long run
    "2:3 6:3 0:5L", // 10 km: two steps fit within 10%
    "2:3 6:3 0:6L",
  ]);
  assert.equal(log[10].kind, "add-day");
});

test("weeks grow in half kilometres up to 10%, at least one step", () => {
  const s = createState().settings;
  assert.equal(weeklyIncrease(10, s), 1); // 10.5 is +5%, 11 is +10%, 11.5 would be +15%
  assert.equal(weeklyIncrease(5, s), 0.5);
  assert.equal(weeklyIncrease(3, s), 0.5); // less than one step fits: still one step
  assert.equal(weeklyIncrease(13.4, s), 1);
  assert.equal(weeklyIncrease(30, s), 3);
  const log = simulate(30);
  for (let i = 1; i < log.length; i++) {
    assert.equal(increaseCheck(log[i - 1].total, log[i].total, s).over, false, `week ${i}`);
    assert.ok(log[i].total - log[i - 1].total >= 0.5 - 1e-9);
  }
});

test("the long run takes increases up to its share, the rest evens out the other runs", () => {
  const log = simulate(25);
  for (const l of log.slice(10)) {
    const long = Number(l.runs.match(/:([\d.]+)L/)[1]);
    assert.ok(long / l.total <= 0.5 + 1e-9, `${l.runs}`);
  }
  assert.equal(log[13].runs, "2:3.5 6:3 0:6.5L"); // 12 km + 1: long run to 6.5 (half of 13), the other step to the shortest run
  // a 4th day before 20 km, keeping the long run's distance
  const add = log.findIndex((l, i) => i > 10 && l.kind === "add-day");
  assert.ok(log[add].total >= 20 && log[add - 1].total < 20);
  assert.equal(log[add].runs.split(" ").length, 4);
  assert.equal(log[add - 1].runs.match(/:([\d.]+)L/)[1], log[add].runs.match(/:([\d.]+)L/)[1]);
});

test("past 28 km the long run only takes 30% of the week", () => {
  const log = simulate(50);
  const longs = log.slice(10).map((l) => [Number(l.runs.match(/:([\d.]+)L/)[1]), l.total]);
  assert.ok(longs.some(([long]) => long > 28), "reaches the cap");
  for (const [long, total] of longs) assert.ok(long <= 28 || long <= total * 0.3 + 1e-9, `${long} of ${total}`);
});

test("plan ahead: weeks after this one from the suggestions, replacing what was planned", () => {
  const today = addDays(MON, 2);
  const runs = [run(MON, 2.5, 2.5), run(addDays(MON, 4), 2.5), run(addDays(MON, 9), 8), run(addDays(MON, 30), 3)];
  const s = createState().settings;
  const out = planAhead(runs, today, 12, s, null, id);
  assert.equal(out.weeks.length, 12);
  assert.equal(out.weeks[0].week, addDays(MON, 7));
  assert.deepEqual(out.weeks.slice(0, 3).map((w) => w.total), [5.5, 6, 6.5]);
  assert.ok(!out.runs.some((r) => r.planned === 8)); // the old plan after this week is gone
  assert.equal(out.runs.filter((r) => r.date < addDays(MON, 7)).length, 2); // this week stays
  assert.equal(futurePlanned(out.runs, today).length, 9 * 2 + 3 * 3); // a third day from 10 km
  assert.deepEqual(futurePlanned(runs, today).map((r) => r.planned), [8, 3]);
});

/** Like simulate, with changed settings. */
function simulateWith(weeks, patch, longDay = null) {
  const state = createState();
  Object.assign(state.settings, patch);
  const log = [];
  for (let i = 0; i < weeks; i++) {
    const monday = addDays(MON, 7 * i);
    const s = suggestWeek(state.runs, monday, state.settings, longDay);
    log.push({ kind: s.kind, runs: kms(s), total: s.total, moves: s.moves });
    state.runs.push(...runsFromItems(s.runs, monday, id).map((r) => ({ ...r, actual: r.planned })));
  }
  return log;
}

test("runs only go on days you can run", () => {
  const days = [1, 3, 4, 6]; // not Tuesday, Friday or Sunday
  const log = simulateWith(40, { days });
  assert.equal(log[0].runs, "3:2.5 6:2.5"); // Tuesday from the start days is replaced by Wednesday
  for (const l of log) for (const r of l.runs.split(" ")) assert.ok(days.includes(Number(r.split(":")[0])), l.runs);
  assert.equal(Math.max(...log.map((l) => l.runs.split(" ").length)), 4); // no more days than you have
  assert.match(log[10].runs, /6:4L/); // long run on Saturday: Sunday isn't possible
});

test("last week's runs on a day you can't run move to a free day", () => {
  const runs = [run(addDays(MON, 1), 3), run(addDays(MON, 5), 3)]; // Tuesday and Saturday
  const s = suggestWeek(runs, addDays(MON, 7), { ...createState().settings, days: [1, 3, 5, 6] });
  assert.deepEqual(s.moves, [{ from: 2, to: 3 }]);
  assert.equal(kms(s), "3:3.5 6:3");
});

test("the week builds up to the goal and then holds", () => {
  const log = simulateWith(14, { goalKm: 8.2 });
  assert.deepEqual(log.map((l) => l.total).slice(5), [7.5, 8, 8.2, 8.2, 8.2, 8.2, 8.2, 8.2, 8.2]);
  assert.equal(log[8].kind, "hold");
});

test("first week from a weekly total", () => {
  assert.equal(simulateWith(1, { startWeekKm: 12, startDays: [1, 3, 5] })[0].runs, "1:4 3:4 5:4");
  assert.equal(simulateWith(1, { startWeekKm: 7 })[0].runs, "2:3.5 6:3.5");
});

test("long run day chosen on an existing running day", () => {
  const log = simulate(11, 6);
  assert.equal(log[10].runs, "2:3 4:3 6:4L");
});

test("no more days than maxDays", () => {
  const log = simulate(60);
  assert.ok(log.every((l) => l.runs.split(" ").length <= 5));
  assert.ok(log.at(-1).total > 100);
});

test("template uses what was run, missed runs as planned", () => {
  const runs = [run(MON, 3, 3.4), run(addDays(MON, 3), 3, null, true)];
  assert.deepEqual(template(runs, addDays(MON, 7)), [{ wd: 1, km: 3.4, long: false }, { wd: 4, km: 3, long: true }]);
  assert.equal(baseline(runs, addDays(MON, 14)).total, 6.4); // a week off: compares with the last running week
});

test("10% warning, but a single step is always fine", () => {
  const s = createState().settings;
  assert.equal(increaseCheck(3, 3.5, s).over, false); // +17%, but only one step
  assert.equal(increaseCheck(5, 6, s).over, true);
  assert.equal(increaseCheck(10, 11, s).over, false); // exactly 10% is fine
  assert.equal(increaseCheck(30, 33, s).over, false);
  assert.equal(increaseCheck(30, 33.5, s).over, true);
  assert.equal(increaseCheck(30, 33.5, s).pct, 12);
  assert.equal(increaseCheck(0, 10, s).over, false);
});

test("streak counts weeks that beat the week before", () => {
  const w = (i) => addDays(MON, 7 * i);
  const runs = [run(w(0), 5, 5), run(w(1), 6, 6), run(w(2), 5, 5), run(w(3), 6, 6), run(w(4), 7, 7), run(w(5), 8, 3)];
  assert.equal(streakWeeks(runs, w(5)), 2); // this week not beaten yet: weeks 3 and 4
  runs.push(run(addDays(w(5), 1), null, 5));
  assert.equal(streakWeeks(runs, w(5)), 3);
  assert.equal(streakWeeks(runs, w(7)), 0); // a week off breaks it
  assert.equal(streakWeeks([run(w(0), 5, 5)], w(0)), 0); // the first week has nothing to beat
});

test("milestones every 10 km of weekly mileage", () => {
  const runs = [run(MON, 9, 9), run(addDays(MON, 7), 11, 12), run(addDays(MON, 14), 21, 21)];
  const m = milestones(runs, addDays(MON, 14));
  assert.deepEqual(m.reached.map((r) => [r.km, r.week]), [[10, addDays(MON, 7)], [20, addDays(MON, 14)]]);
  assert.equal(m.next, 30);
  assert.deepEqual(milestones(runs, addDays(MON, 14), 5).reached.map((r) => r.km), [5, 10, 15, 20]);
  assert.equal(m.best, 21);
});

test("weekly totals", () => {
  const runs = [run(MON, 3, 2.7), run(addDays(MON, 2), 3), run(addDays(MON, 14), 4)];
  assert.equal(actualTotal(runs, MON), 2.7);
  assert.equal(plannedTotal(runs, MON), 5.7);
  assert.deepEqual(weeklySeries(runs, addDays(MON, 14)).map((w) => w.planned), [5.7, 0, 4]);
});

test("free day furthest from running days", () => {
  assert.equal(bestFreeDay([2, 6]), 4);
  assert.equal(bestFreeDay([2]), 5);
  assert.equal(bestFreeDay([]), 2);
});

test("one long run per week", () => {
  let s = { ...createState(), runs: [run(MON, 3), run(addDays(MON, 6), 5, null, true)] };
  s = setLong(s, s.runs[0].id, true);
  assert.deepEqual(s.runs.map((r) => r.long), [true, false]);
  assert.equal(s.longRunDay, 1);
});

test("backup round trip and validation", () => {
  const s = { ...createState(), runs: [run(MON, 3, 2.7)] };
  assert.deepEqual(readBackup(JSON.stringify(makeBackup(s))), s);
  assert.equal(readBackup("{}"), null);
  assert.equal(readBackup("nope"), null);
  const bad = migrate({ version: 1, runs: [{ id: "x", date: "2026-02-30", planned: 3 }, { id: "y", date: MON, planned: -1 }], settings: { step: 99 } });
  assert.deepEqual(bad.runs, []);
  assert.equal(bad.settings.step, 0.5);
  // the old 1 km default step becomes 0.5 km; a step chosen later stays
  assert.equal(migrate({ version: 1, runs: [], settings: { step: 1 } }).settings.step, 0.5);
  assert.equal(migrate({ version: 1, settingsRev: 2, runs: [], settings: { step: 1 } }).settings.step, 1);
  // km per first run (before revision 3) becomes the first week's total
  assert.equal(migrate({ version: 1, settingsRev: 2, runs: [], settings: { startKm: 3, startDays: [1, 3, 5] } }).settings.startWeekKm, 9);
});
