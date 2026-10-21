import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState, suggestWeek, runsFromItems, template, baseline, increaseCheck, streakWeeks, milestones,
  bestFreeDay, weeklySeries, setLong, migrate, readBackup, makeBackup, plannedTotal, actualTotal,
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

test("two runs grow one at a time, a day is added before 10 km with a long run", () => {
  const log = simulate(8);
  assert.deepEqual(log.map((l) => l.runs), [
    "2:2.5 6:2.5",
    "2:3.5 6:2.5",
    "2:3.5 6:3.5",
    "2:4.5 6:3.5",
    "2:4.5 6:4.5",
    "2:3 6:3 0:4L", // 9 km + 1: a third day on Sunday, the long run
    "2:3 6:3 0:5L",
    "2:3 6:3 0:6L",
  ]);
  assert.equal(log[5].kind, "add-day");
  assert.deepEqual(log.map((l) => l.total), [5, 6, 7, 8, 9, 10, 11, 12]);
});

test("the long run gets most of the increases but stays within its share", () => {
  const log = simulate(20);
  for (const l of log.slice(6)) {
    const long = Number(l.runs.match(/:([\d.]+)L/)[1]);
    assert.ok(long / l.total <= 0.5 + 1e-9, `${l.runs}`);
  }
  // 4th day before 20 km, keeping the long run's distance
  const add = log.findIndex((l, i) => i > 5 && l.kind === "add-day");
  assert.equal(log[add].total, 20);
  assert.equal(log[add].runs.split(" ").length, 4);
  assert.equal(log[add - 1].runs.match(/:([\d.]+)L/)[1], log[add].runs.match(/:([\d.]+)L/)[1]);
});

test("long run day chosen on an existing running day", () => {
  const log = simulate(6, 6);
  assert.equal(log[5].runs, "2:3 4:3 6:4L");
});

test("no more days than maxDays", () => {
  const log = simulate(60);
  assert.ok(log.every((l) => l.runs.split(" ").length <= 5));
  assert.equal(log.at(-1).total, 64);
});

test("template uses what was run, missed runs as planned", () => {
  const runs = [run(MON, 3, 3.4), run(addDays(MON, 3), 3, null, true)];
  assert.deepEqual(template(runs, addDays(MON, 7)), [{ wd: 1, km: 3.4, long: false }, { wd: 4, km: 3, long: true }]);
  assert.equal(baseline(runs, addDays(MON, 14)).total, 6.4); // a week off: compares with the last running week
});

test("10% warning, but a single step is always fine", () => {
  const s = createState().settings;
  assert.equal(increaseCheck(5, 6, s).over, false); // +20%, but only one step
  assert.equal(increaseCheck(5, 6.5, s).over, true);
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
  assert.equal(bad.settings.step, 1);
});
