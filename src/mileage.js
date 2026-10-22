// Mileage logic: runs, weekly totals, progression suggestions, the 10% warning, streaks and milestones.
// All distances are kilometres, kept to one decimal.
import { WEEK_ORDER, addDays, dayInWeek, isDateKey, weekPos, weekStart, weekday } from "./dates.js";

export const DEFAULT_SETTINGS = {
  step: 1, // smallest weekly increase a suggestion makes (and never warned about)
  maxIncrease: 10, // % week over week before the planner warns
  addDayEvery: 10, // a new running day is suggested before the week reaches each multiple of this (10, 20, 30 km…)
  maxDays: 5, // no more running days than this are suggested
  longShare: 50, // % of the week the long run may take before increases go to the other runs
  startKm: 2.5, // first week: runs of this distance
  startDays: [2, 6], // first week: Tuesday and Saturday
};

export const MILESTONE_STEP = 10;

/**
 * A run: { id, date, planned, actual, long }.
 * planned: km planned, or null for a run that was only logged.
 * actual: km run, or null while not logged. A past run that isn't logged counts as missed.
 * long: the week's long run.
 */
export function createState() {
  return { version: 1, runs: [], settings: { ...DEFAULT_SETTINGS, startDays: [...DEFAULT_SETTINGS.startDays] }, longRunDay: null };
}

export const round1 = (x) => Math.round(x * 10) / 10;
export const floorHalf = (x) => Math.floor(x * 2 + 1e-9) / 2;
const sum = (xs) => round1(xs.reduce((a, b) => a + b, 0));

/** The distance a run counts with for planning: what was run, otherwise what was planned. */
export const runKm = (r) => r.actual ?? r.planned ?? 0;

export const isDone = (r) => r.actual != null;
export const isMissed = (r, today) => r.actual == null && r.date < today;

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function runsInWeek(runs, monday) {
  const end = addDays(monday, 6);
  return runs.filter((r) => r.date >= monday && r.date <= end).sort(byDate);
}

export const runsOn = (runs, date) => runs.filter((r) => r.date === date);

/** Kilometres actually run in a week. */
export const actualTotal = (runs, monday) => sum(runsInWeek(runs, monday).map((r) => r.actual ?? 0));

/** A week's volume for planning: logged runs as run, the rest as planned. */
export const plannedTotal = (runs, monday) => sum(runsInWeek(runs, monday).map(runKm));

/** Monday of the most recent week before `monday` that has any runs, or null. */
export function baseWeek(runs, monday) {
  let best = null;
  for (const r of runs) {
    if (r.date >= monday || runKm(r) <= 0) continue;
    const w = weekStart(r.date);
    if (!best || w > best) best = w;
  }
  return best;
}

/** Last running week as a template: [{ wd, km, long }], Monday first. */
export function template(runs, monday) {
  const base = baseWeek(runs, monday);
  if (!base) return [];
  return runsInWeek(runs, base)
    .filter((r) => runKm(r) > 0)
    .map((r) => ({ wd: weekday(r.date), km: round1(runKm(r)), long: !!r.long }));
}

/** What the week before is compared with: the last running week's volume. */
export function baseline(runs, monday) {
  const base = baseWeek(runs, monday);
  return { week: base, total: base ? plannedTotal(runs, base) : 0 };
}

/** The most a week may grow before the planner warns: the % limit, but never less than one step. */
export const increaseLimit = (baseTotal, settings) => Math.max((baseTotal * settings.maxIncrease) / 100, settings.step);

/**
 * How much a suggested week grows: as much as possible while staying just under the % limit
 * (in 0.1 km), but at least `step`, so small weeks still move on.
 */
export function weeklyIncrease(baseTotal, settings) {
  const underLimit = Math.ceil(((baseTotal * settings.maxIncrease) / 100) * 10 - 1e-9) / 10 - 0.1;
  return round1(Math.max(settings.step, underLimit));
}

/** Compares a planned week with its baseline. `pct` is null without a baseline. */
export function increaseCheck(baseTotal, total, settings) {
  if (!baseTotal) return { over: false, pct: null, diff: total };
  const diff = round1(total - baseTotal);
  return { over: diff > increaseLimit(baseTotal, settings) + 1e-9, pct: Math.round((diff / baseTotal) * 100), diff };
}

const posOrder = (a, b) => weekPos(a.wd) - weekPos(b.wd);

/** The free weekday furthest from every running day (ties: earliest in the week). */
export function bestFreeDay(usedDays) {
  const used = [...new Set(usedDays)].map(weekPos);
  if (!used.length) return 2;
  let best = null, bestGap = -1;
  for (const wd of WEEK_ORDER) {
    const p = weekPos(wd);
    if (used.includes(p)) continue;
    const gap = Math.min(...used.map((u) => Math.min(Math.abs(p - u), 7 - Math.abs(p - u))));
    if (gap > bestGap) { best = wd; bestGap = gap; }
  }
  return best;
}

/** Long run day to offer when none is set: a weekend day you already run on, else Sunday. */
export function defaultLongDay(items, chosen = null) {
  if (chosen != null) return chosen;
  const days = items.map((i) => i.wd);
  return days.includes(0) ? 0 : days.includes(6) ? 6 : 0;
}

/** Splits `total` over `items` in half-kilometre steps; earlier items get the leftovers. */
function spread(items, total) {
  if (!items.length) return;
  const base = Math.max(0.5, floorHalf(total / items.length));
  let left = round1(total - base * items.length);
  for (const it of items) it.km = base;
  for (let i = 0; left > 1e-9; i = (i + 1) % items.length) {
    const add = Math.min(0.5, left);
    items[i].km = round1(items[i].km + add);
    left = round1(left - add);
  }
}

/**
 * Suggests the runs for the week starting `monday`, from the last running week:
 * - start: no runs yet, so a first week of easy runs.
 * - increase: the week grows by `weeklyIncrease`, just under the % limit. Without a long run, the
 *   shortest run gets all of it. With one, the long run takes what keeps it within `longShare` of
 *   the week and the rest evens out the other runs, shortest first.
 * - add-day: before the week reaches the next multiple of `addDayEvery` km, one more running day.
 *   The week's km (plus the increase) are spread over the runs. The first time, a long run day is chosen
 *   (`longDay`), which gets the extra; once there is a long run, it keeps its distance.
 * Returns { kind, runs: [{ wd, km, long, change?: "up" | "new" }], from, total, longDay? }.
 */
export function suggestWeek(runs, monday, settings, longDay = null) {
  const tpl = template(runs, monday).map((r) => ({ ...r, from: r.km }));
  const s = settings;
  if (!tpl.length) {
    const days = s.startDays.length ? s.startDays : DEFAULT_SETTINGS.startDays;
    const out = days.map((wd) => ({ wd, km: s.startKm, long: false, change: "new" })).sort(posOrder);
    return { kind: "start", runs: out, from: 0, total: sum(out.map((r) => r.km)) };
  }
  const from = sum(tpl.map((r) => r.km));
  const total = round1(from + weeklyIncrease(from, s));
  const target = Math.min(s.maxDays, 7, 2 + Math.floor((total + 1e-9) / s.addDayEvery));
  const usedDays = new Set(tpl.map((r) => r.wd));
  const hasLong = tpl.some((r) => r.long);
  const longOf = () => tpl.find((r) => r.long);
  const shortest = (list) => [...list].sort((a, b) => a.km - b.km || posOrder(a, b))[0];

  if (tpl.length < target && usedDays.size < 7) {
    const day = hasLong ? null : defaultLongDay(tpl, longDay);
    const newWd = day != null && !usedDays.has(day) ? day : bestFreeDay([...usedDays]);
    const added = { wd: newWd, km: 0, long: false, from: 0, change: "new" };
    tpl.push(added);
    if (!hasLong) tpl.filter((r) => r.wd === day)[0].long = true;
    const long = longOf();
    if (hasLong) {
      spread(tpl.filter((r) => r !== long), round1(total - long.km));
    } else {
      const others = tpl.filter((r) => r !== long);
      const base = floorHalf(total / tpl.length);
      for (const r of others) r.km = base;
      long.km = round1(total - base * others.length);
    }
    for (const r of tpl) if (!r.change && r.km !== r.from) r.change = r.km > r.from ? "up" : "down";
    return { kind: "add-day", runs: tpl.sort(posOrder), from, total: sum(tpl.map((r) => r.km)), ...(hasLong ? {} : { longDay: day }) };
  }

  const inc = round1(total - from);
  if (!hasLong) {
    const pick = shortest(tpl);
    pick.km = round1(pick.km + inc);
  } else {
    const long = longOf();
    const easy = tpl.filter((r) => r !== long);
    const toLong = easy.length ? Math.min(inc, Math.max(0, Math.floor(((total * s.longShare) / 100 - long.km) * 10 + 1e-9) / 10)) : inc;
    long.km = round1(long.km + toLong);
    // The rest in half kilometres to whichever other run is shortest, so they even out.
    for (let left = round1(inc - toLong); left > 1e-9;) {
      const add = Math.min(0.5, left);
      const r = shortest(easy);
      r.km = round1(r.km + add);
      left = round1(left - add);
    }
  }
  for (const r of tpl) if (r.km > r.from) r.change = "up";
  return { kind: "increase", runs: tpl.sort(posOrder), from, total };
}

/** Runs for a week from [{ wd, km, long }] items. */
export function runsFromItems(items, monday, newId) {
  return items.filter((i) => i.km > 0).map((i) => ({ id: newId(), date: dayInWeek(monday, i.wd), planned: round1(i.km), actual: null, long: !!i.long }));
}

/** Weekly totals from the first running week to `lastMonday`: [{ week, actual, planned }]. */
export function weeklySeries(runs, lastMonday) {
  const dated = runs.filter((r) => runKm(r) > 0).map((r) => r.date).sort();
  if (!dated.length) return [];
  const out = [];
  for (let w = weekStart(dated[0]); w <= lastMonday; w = addDays(w, 7)) {
    out.push({ week: w, actual: actualTotal(runs, w), planned: plannedTotal(runs, w) });
  }
  return out;
}

/**
 * Weeks in a row in which you ran more km than the week before (which must have some). Only logged km count.
 * The current week joins the streak as soon as it beats last week; until then the streak runs to last week.
 */
export function streakWeeks(runs, today) {
  const thisWeek = weekStart(today);
  const beats = (w) => {
    const before = actualTotal(runs, addDays(w, -7));
    return before > 0 && actualTotal(runs, w) > before; // your first week has nothing to beat yet
  };
  let w = beats(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let n = 0;
  while (beats(w)) { n++; w = addDays(w, -7); }
  return n;
}

/** Weekly mileage milestones (10, 20, 30 km…): reached ones with their first week, and the next. */
export function milestones(runs, today) {
  const reached = [];
  let best = 0, bestWeek = null;
  for (const { week, actual } of weeklySeries(runs, weekStart(today))) {
    if (actual > best) { best = actual; bestWeek = week; }
    for (let m = (reached.length + 1) * MILESTONE_STEP; m <= actual + 1e-9; m += MILESTONE_STEP) reached.push({ km: m, week });
  }
  const next = (reached.length + 1) * MILESTONE_STEP;
  return { reached, best, bestWeek, next, progress: Math.min(1, best / next) };
}

// ---------- editing ----------

export function moveRun(state, id, date) {
  return { ...state, runs: state.runs.map((r) => (r.id === id ? { ...r, date } : r)) };
}

export function deleteRun(state, id) {
  return { ...state, runs: state.runs.filter((r) => r.id !== id) };
}

export function updateRun(state, id, patch) {
  return { ...state, runs: state.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

/** Marks one run as its week's long run (or clears it); a week has at most one. */
export function setLong(state, id, on) {
  const run = state.runs.find((r) => r.id === id);
  if (!run) return state;
  const w = weekStart(run.date);
  return {
    ...state,
    runs: state.runs.map((r) => (r.id === id ? { ...r, long: on } : on && weekStart(r.date) === w ? { ...r, long: false } : r)),
    longRunDay: on ? weekday(run.date) : state.longRunDay,
  };
}

// ---------- validation and backup ----------

const kmValue = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 500 ? round1(v) : null);

function cleanRun(r) {
  if (!r || typeof r !== "object" || typeof r.id !== "string" || !isDateKey(r.date)) return null;
  const planned = kmValue(r.planned), actual = kmValue(r.actual);
  if (planned == null && actual == null) return null;
  return { id: r.id.slice(0, 40), date: r.date, planned, actual, long: r.long === true };
}

function cleanSettings(s) {
  const d = DEFAULT_SETTINGS;
  const num = (v, min, max, def) => (typeof v === "number" && v >= min && v <= max ? v : def);
  const days = Array.isArray(s?.startDays) ? [...new Set(s.startDays.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))] : null;
  return {
    step: num(s?.step, 0.1, 10, d.step),
    maxIncrease: num(s?.maxIncrease, 1, 100, d.maxIncrease),
    addDayEvery: num(s?.addDayEvery, 2, 100, d.addDayEvery),
    maxDays: Math.round(num(s?.maxDays, 2, 7, d.maxDays)),
    longShare: num(s?.longShare, 20, 100, d.longShare),
    startKm: num(s?.startKm, 0.5, 50, d.startKm),
    startDays: days?.length ? days : [...d.startDays],
  };
}

/** Returns a valid state from stored or imported data, or null when it isn't MeilenMaxxen data. */
export function migrate(data) {
  if (!data || typeof data !== "object" || data.version !== 1 || !Array.isArray(data.runs)) return null;
  const seen = new Set();
  const runs = data.runs.map(cleanRun).filter((r) => r && !seen.has(r.id) && seen.add(r.id));
  const longRunDay = Number.isInteger(data.longRunDay) && data.longRunDay >= 0 && data.longRunDay <= 6 ? data.longRunDay : null;
  return { version: 1, runs, settings: cleanSettings(data.settings), longRunDay };
}

export const makeBackup = (state) => ({ app: "meilenmaxxen", exported: new Date().toISOString(), ...state });

export function readBackup(text) {
  try {
    const data = JSON.parse(text);
    return data?.app === "meilenmaxxen" ? migrate(data) : null;
  } catch {
    return null;
  }
}
