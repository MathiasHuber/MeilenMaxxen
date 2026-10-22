// Mileage logic: runs, weekly totals, progression suggestions, the 10% warning, streaks and milestones.
// All distances are kilometres, kept to one decimal.
import { WEEK_ORDER, addDays, dayInWeek, isDateKey, weekPos, weekStart, weekday } from "./dates.js";

export const DEFAULT_SETTINGS = {
  step: 0.5, // suggestions add km in steps of this size (at least one a week, never warned about)
  maxIncrease: 10, // % week over week before the planner warns
  addDayEvery: 10, // a new running day is suggested before the week reaches each multiple of this (10, 20, 30 km…)
  maxDays: 5, // no more running days than this are suggested
  longShare: 50, // % of the week the long run may take before increases go to the other runs
  longCapKm: 28, // once the long run would pass this distance…
  longShareAbove: 30, // …it may only take this % of the week
  startWeekKm: 5, // first week: this many km, spread over the start days
  startDays: [2, 6], // first week: Tuesday and Saturday
  days: [0, 1, 2, 3, 4, 5, 6], // weekdays you can run on; suggestions only use these
  goalKm: 0, // weekly km to build up to and then hold; 0 for no goal
  milestoneStep: 10, // a milestone every this many km in one week
};

export const MILESTONE_STEP = 10;

/**
 * A run: { id, date, planned, actual, long }.
 * planned: km planned, or null for a run that was only logged.
 * actual: km run, or null while not logged. A past run that isn't logged counts as missed.
 * long: the week's long run.
 */
export function createState() {
  return { version: 1, settingsRev: 3, runs: [], settings: cleanSettings({}), longRunDay: null };
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
 * How much a suggested week grows: steps of `step` km are added while the week stays within the
 * % limit (10 km: 10.5 is +5%, 11 is +10%, 11.5 would be +15%, so +1 km). Always at least one step.
 */
export function weeklyIncrease(baseTotal, settings) {
  const steps = Math.floor((baseTotal * settings.maxIncrease) / 100 / settings.step + 1e-9);
  return round1(Math.max(1, steps) * settings.step);
}

/** Compares a planned week with its baseline. `pct` is null without a baseline. */
export function increaseCheck(baseTotal, total, settings) {
  if (!baseTotal) return { over: false, pct: null, diff: total };
  const diff = round1(total - baseTotal);
  return { over: diff > increaseLimit(baseTotal, settings) + 1e-9, pct: Math.round((diff / baseTotal) * 100), diff };
}

const posOrder = (a, b) => weekPos(a.wd) - weekPos(b.wd);

/** The free weekday (of `allowed`) furthest from every running day (ties: earliest in the week), or null. */
export function bestFreeDay(usedDays, allowed = WEEK_ORDER) {
  const used = [...new Set(usedDays)].map(weekPos);
  if (!used.length) return allowed.includes(2) ? 2 : WEEK_ORDER.find((wd) => allowed.includes(wd)) ?? null;
  let best = null, bestGap = -1;
  for (const wd of WEEK_ORDER) {
    const p = weekPos(wd);
    if (used.includes(p) || !allowed.includes(wd)) continue;
    const gap = Math.min(...used.map((u) => Math.min(Math.abs(p - u), 7 - Math.abs(p - u))));
    if (gap > bestGap) { best = wd; bestGap = gap; }
  }
  return best;
}

/**
 * Long run day: the chosen one if you can run then, else a weekend day you already run on,
 * else a weekend day you can run on, else your last running day.
 */
export function defaultLongDay(items, chosen = null, allowed = WEEK_ORDER) {
  if (chosen != null && allowed.includes(chosen)) return chosen;
  const days = items.map((i) => i.wd).filter((wd) => allowed.includes(wd));
  for (const wd of [0, 6]) if (days.includes(wd)) return wd;
  for (const wd of [0, 6]) if (allowed.includes(wd)) return wd;
  return [...WEEK_ORDER].reverse().find((wd) => days.includes(wd)) ?? [...WEEK_ORDER].reverse().find((wd) => allowed.includes(wd));
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
 * - increase: the week grows by `weeklyIncrease`, steps of `step` km up to the % limit. Each step
 *   goes to the shortest run, so the runs grow evenly; with a long run, to the long run while it
 *   stays within `longShare` of the week (`longShareAbove` once it would pass `longCapKm`).
 * - add-day: before the week reaches the next multiple of `addDayEvery` km, one more running day.
 *   The week's km (plus the increase) are spread over the runs. The first time, a long run day is chosen
 *   (`longDay`), which gets the extra; once there is a long run, it keeps its distance.
 * - hold: the week has reached `goalKm`, so it stays the same.
 * Runs only go on the weekdays in `days`: last week's runs on other days move to a free day you can run on.
 * Returns { kind, runs: [{ wd, km, long, change?: "up" | "new" }], from, total, moves: [{ from, to }], longDay? }.
 */
export function suggestWeek(runs, monday, settings, longDay = null) {
  const s = settings;
  const allowed = s.days;
  const shortest = (list) => [...list].sort((a, b) => a.km - b.km || posOrder(a, b))[0];
  const tpl = template(runs, monday).map((r) => ({ ...r, from: r.km }));
  if (!tpl.length) {
    const days = s.startDays.filter((wd) => allowed.includes(wd));
    while (days.length < Math.min(Math.max(1, s.startDays.length), allowed.length)) days.push(bestFreeDay(days, allowed));
    const out = days.map((wd) => ({ wd, km: 0, long: false, change: "new" })).sort(posOrder);
    spread(out, s.startWeekKm);
    return { kind: "start", runs: out, from: 0, total: sum(out.map((r) => r.km)), moves: [] };
  }
  // Last week's runs on days you can't run move to a free day you can, or join your shortest run.
  const moves = [];
  for (const r of [...tpl]) {
    if (allowed.includes(r.wd)) continue;
    const to = bestFreeDay(tpl.filter((x) => x !== r).map((x) => x.wd), allowed);
    if (to != null) {
      moves.push({ from: r.wd, to });
      r.wd = to;
    } else {
      const into = shortest(tpl.filter((x) => x !== r && allowed.includes(x.wd)));
      if (!into) continue;
      moves.push({ from: r.wd, to: into.wd });
      into.km = round1(into.km + r.km);
      into.from = round1(into.from + r.from);
      into.long ||= r.long;
      tpl.splice(tpl.indexOf(r), 1);
    }
  }
  const from = sum(tpl.map((r) => r.km));
  let total = round1(from + weeklyIncrease(from, s));
  if (s.goalKm && total > s.goalKm) total = Math.max(from, s.goalKm);
  if (total <= from) return { kind: "hold", runs: tpl.sort(posOrder), from, total: from, moves };
  const target = Math.min(s.maxDays, allowed.length, 2 + Math.floor((total + 1e-9) / s.addDayEvery));
  const usedDays = new Set(tpl.map((r) => r.wd));
  const hasLong = tpl.some((r) => r.long);
  const longOf = () => tpl.find((r) => r.long);

  if (tpl.length < target && bestFreeDay([...usedDays], allowed) != null) {
    const day = hasLong ? null : defaultLongDay(tpl, longDay, allowed);
    const newWd = day != null && !usedDays.has(day) ? day : bestFreeDay([...usedDays], allowed);
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
    return { kind: "add-day", runs: tpl.sort(posOrder), from, total: sum(tpl.map((r) => r.km)), moves, ...(hasLong ? {} : { longDay: day }) };
  }

  // One step at a time: to the long run while it stays within its share of the week,
  // otherwise to whichever other run is shortest, so the runs grow evenly.
  const long = longOf();
  const easy = tpl.filter((r) => r !== long);
  for (let left = round1(total - from); left > 1e-9;) {
    const add = Math.min(s.step, left);
    const share = long && long.km + add > s.longCapKm + 1e-9 ? s.longShareAbove : s.longShare;
    const r = long && (!easy.length || long.km + add <= (total * share) / 100 + 1e-9) ? long : shortest(easy);
    r.km = round1(r.km + add);
    left = round1(left - add);
  }
  for (const r of tpl) if (r.km > r.from) r.change = "up";
  return { kind: "increase", runs: tpl.sort(posOrder), from, total, moves };
}

/** Planned runs that aren't logged, from the week after `today`'s on. */
export const futurePlanned = (runs, today) => {
  const next = addDays(weekStart(today), 7);
  return runs.filter((r) => r.date >= next && !isDone(r));
};

/**
 * Plans `weeks` weeks from the week after `today`'s, each from the suggestion for the week before.
 * Planned runs after this week are replaced. `longDay` is used if a long run day has to be chosen.
 * Returns { runs: all runs afterwards, weeks: [{ week, total, kind }], longDay }.
 */
export function planAhead(runs, today, weeks, settings, longDay, newId) {
  const drop = new Set(futurePlanned(runs, today));
  let out = runs.filter((r) => !drop.has(r));
  const summary = [];
  let chosen = longDay;
  for (let i = 0, w = addDays(weekStart(today), 7); i < weeks; i++, w = addDays(w, 7)) {
    const s = suggestWeek(out, w, settings, chosen);
    if (s.longDay != null) chosen = s.longDay;
    out = [...out, ...runsFromItems(s.runs, w, newId)];
    summary.push({ week: w, total: s.total, kind: s.kind });
  }
  return { runs: out, weeks: summary, longDay: chosen };
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
export function milestones(runs, today, step = MILESTONE_STEP) {
  const reached = [];
  let best = 0, bestWeek = null;
  for (const { week, actual } of weeklySeries(runs, weekStart(today))) {
    if (actual > best) { best = actual; bestWeek = week; }
    for (let m = (reached.length + 1) * step; m <= actual + 1e-9; m += step) reached.push({ km: m, week });
  }
  const next = (reached.length + 1) * step;
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
  const weekdays = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))] : null);
  const days = weekdays(s?.startDays), allowed = weekdays(s?.days);
  return {
    step: num(s?.step, 0.1, 10, d.step),
    maxIncrease: num(s?.maxIncrease, 1, 100, d.maxIncrease),
    addDayEvery: num(s?.addDayEvery, 2, 100, d.addDayEvery),
    maxDays: Math.round(num(s?.maxDays, 2, 7, d.maxDays)),
    longShare: num(s?.longShare, 20, 100, d.longShare),
    longCapKm: num(s?.longCapKm, 5, 100, d.longCapKm),
    longShareAbove: num(s?.longShareAbove, 10, 100, d.longShareAbove),
    startWeekKm: num(s?.startWeekKm, 0.5, 200, d.startWeekKm),
    startDays: days?.length ? days : [...d.startDays],
    days: allowed?.length ? allowed : [...d.days],
    goalKm: num(s?.goalKm, 0, 1000, d.goalKm),
    milestoneStep: num(s?.milestoneStep, 1, 100, d.milestoneStep),
  };
}

/** Returns a valid state from stored or imported data, or null when it isn't MeilenMaxxen data. */
export function migrate(data) {
  if (!data || typeof data !== "object" || data.version !== 1 || !Array.isArray(data.runs)) return null;
  const seen = new Set();
  const runs = data.runs.map(cleanRun).filter((r) => r && !seen.has(r.id) && seen.add(r.id));
  const longRunDay = Number.isInteger(data.longRunDay) && data.longRunDay >= 0 && data.longRunDay <= 6 ? data.longRunDay : null;
  const rev = data.settingsRev ?? 1;
  // Revision 3 sets the first week as a weekly total; before, it was km per run.
  const old = data.settings;
  const settings = cleanSettings(rev < 3 && typeof old?.startKm === "number" ? { ...old, startWeekKm: old.startKm * (old.startDays?.length || 2) } : old);
  // Before settings revision 2 the default step was 1 km; the new default is 0.5 km.
  if (rev < 2 && settings.step === 1) settings.step = DEFAULT_SETTINGS.step;
  return { version: 1, settingsRev: 3, runs, settings, longRunDay };
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
