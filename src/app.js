import {
  createState, migrate, round1, runKm, isDone, isMissed, runsInWeek, runsOn, actualTotal, plannedTotal, template,
  baseline, increaseCheck, suggestWeek, runsFromItems, bestFreeDay, defaultLongDay, weeklySeries, streakWeeks, milestones,
  moveRun, deleteRun, updateRun, setLong, makeBackup, readBackup, planAhead, futurePlanned, floorHalf,
} from "./mileage.js";
import {
  WEEKDAY_NAMES, WEEKDAY_LONG, WEEK_ORDER, todayKey, toKey, fromKey, addDays, weekStart, weekday, dayInWeek, isDateKey,
} from "./dates.js";

const STORAGE_KEY = "meilenmaxxen";
const app = document.getElementById("app");

let state = load();
let view = "today";
const ui = {
  planWeek: null, // Monday of the week open in the planner
  aheadWeeks: 12, // how many weeks "Plan ahead" plans
  longPick: null, // long run day picked in a suggestion
  calMonth: todayKey().slice(0, 7),
  calSelected: null,
  logOpen: null, // id of the run whose log form is open, or "extra"
  chartRange: 12,
  chartSel: null,
  celebrate: "", // one-off message after logging a run
  flash: "", // one-off message for the settings page
};

// ---------- persistence ----------

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw && migrate(JSON.parse(raw));
    if (data) return data;
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return createState();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

// ---------- formatting ----------

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (x) => round1(x).toLocaleString(undefined, { maximumFractionDigits: 1 });
const km = (x) => `${num(x)} km`;
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${km(Math.abs(x))}`;
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const dayLabel = (key) => fromKey(key).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const shortDate = (key) => fromKey(key).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const ordinal = (n) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`; // running days: 1 to 7

/** Reads a distance typed with either a decimal point or comma. */
function parseKm(text) {
  const n = Number(String(text).trim().replace(",", "."));
  return text !== "" && Number.isFinite(n) && n >= 0 && n <= 500 ? round1(n) : null;
}

function weekName(monday) {
  const thisWeek = weekStart(todayKey());
  if (monday === thisWeek) return "This week";
  if (monday === addDays(thisWeek, 7)) return "Next week";
  if (monday === addDays(thisWeek, -7)) return "Last week";
  return `Week of ${shortDate(monday)}`;
}
const weekRange = (monday) => `${shortDate(monday)} – ${shortDate(addDays(monday, 6))}`;

const FLAME = `<svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.6 3.2-1.4 5-2.8 6.7C7.8 10.4 7 12 7 14a5 5 0 0 0 10 0c0-2.3-1-4-2-5.2.1 1.8-.6 3-1.8 3.6.6-3.6-.2-7.4-1.2-10.4z"/></svg>`;

function streakBadge() {
  const weeks = streakWeeks(state.runs, todayKey());
  const label = weeks ? `${weeks}-week streak` : "No streak yet";
  return `<span class="streak ${weeks ? "on" : ""}" title="Weeks in a row with more kilometres than the week before">${FLAME}${esc(label)}</span>`;
}

// ---------- rendering ----------

function render() {
  for (const b of document.querySelectorAll(".tabs button")) {
    if (b.dataset.view === view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  const views = { today: todayView, calendar: calendarView, plan: planView, progress: progressView, settings: settingsView };
  app.innerHTML = views[view]();
}

/** Log form for a run: distance pre-filled with what was planned (or logged). */
function logForm(r) {
  const value = r ? r.actual ?? r.planned ?? defaultRunKm() : defaultRunKm();
  const id = r ? r.id : "extra";
  return `<div class="log-form">
    <span class="stepper">
      <button class="btn icon" data-action="log-step" data-id="${esc(id)}" data-delta="-0.1" aria-label="0.1 km less">−</button>
      <input class="km-input" id="log-${esc(id)}" inputmode="decimal" autocomplete="off" value="${esc(num(value))}" aria-label="Kilometres run">
      <button class="btn icon" data-action="log-step" data-id="${esc(id)}" data-delta="0.1" aria-label="0.1 km more">+</button>
    </span>
    <span class="muted">km</span>
    <button class="btn primary" data-action="log-save" data-id="${esc(id)}">${r?.actual != null ? "Save" : "Log run"}</button>
  </div>`;
}

/** A run with its status and log controls. `extras` adds move and delete (calendar). */
function runCard(r, today, extras = false) {
  const tags = [r.long ? `<span class="tag long">Long run</span>` : ""];
  let body;
  if (isDone(r) && ui.logOpen !== r.id) {
    const diff = r.planned != null ? round1(r.actual - r.planned) : null;
    const vs = diff == null ? `<span class="muted small">not planned</span>`
      : diff === 0 ? `<span class="muted small">as planned</span>`
      : `<span class="small ${diff > 0 ? "up" : "muted"}">${signed(diff)} vs plan</span>`;
    tags.push(`<span class="tag done">Done</span>`);
    body = `<div class="run-edit">
      <span><span class="run-km">${km(r.actual)}</span> ${vs}</span>
      <span class="row"><button class="btn small" data-action="log-open" data-id="${esc(r.id)}">Change</button>
      <button class="btn small" data-action="log-undo" data-id="${esc(r.id)}">Undo</button></span>
    </div>`;
  } else {
    if (isMissed(r, today) && ui.logOpen !== r.id) tags.push(`<span class="tag missed">Not logged</span>`);
    body = `<div class="small muted">Planned ${km(r.planned ?? 0)}</div>${logForm(r)}`;
  }
  const move = extras ? `<div class="row wrap">
      <label class="inline small">Move to <input type="date" id="move-${esc(r.id)}" value="${r.date}"></label>
      <button class="btn small" data-action="move-run" data-id="${esc(r.id)}">Move</button>
      <button class="btn small danger" data-action="delete-run" data-id="${esc(r.id)}">Delete</button>
    </div>` : "";
  return `<div class="run">
    <div class="run-head"><span class="run-title">${extras ? (r.long ? "" : "Run") : esc(dayLabel(r.date))} ${tags.join("")}</span></div>
    ${body}${move}
  </div>`;
}

// ---------- today ----------

function todayView() {
  const today = todayKey();
  const thisWeek = weekStart(today);
  const celebrate = ui.celebrate ? `<div class="card celebrate" role="status">${ui.celebrate}</div>` : "";
  ui.celebrate = "";
  if (!state.runs.length) {
    return `<div class="row between head"><h2>Today</h2>${streakBadge()}</div>
      <div class="card">
        <p><strong>Welcome!</strong> MeilenMaxxen builds your weekly kilometres step by step: a little more each week, a new running day before each 10 km, and a long run once you run three days a week.</p>
        <button class="btn primary block" data-action="goto-plan">Plan your first week</button>
      </div>
      ${extraRun()}`;
  }
  const planned = plannedTotal(state.runs, thisWeek);
  const ran = actualTotal(state.runs, thisWeek);
  const base = baseline(state.runs, thisWeek);
  const todays = runsOn(state.runs, today);
  const open = state.runs.filter((r) => isMissed(r, today) && r.date >= addDays(thisWeek, -7)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const next = state.runs.filter((r) => r.date > today && !isDone(r)).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const nextWeekPlanned = runsInWeek(state.runs, addDays(thisWeek, 7)).length > 0;

  const todayCard = todays.length
    ? `<h2>Today's run${todays.length > 1 ? "s" : ""}</h2><div class="card">${todays.map((r) => runCard(r, today)).join("")}</div>`
    : `<div class="card"><strong>Rest day</strong><p class="small muted">${next ? `Next run: ${esc(dayLabel(next.date))}, ${km(next.planned ?? 0)}${next.long ? " (long run)" : ""}.` : "No more runs planned."}</p></div>`;
  const openCard = open.length
    ? `<h2>Not logged yet</h2><div class="card">${open.map((r) => runCard(r, today)).join("")}</div>` : "";
  const planHint = !nextWeekPlanned && [5, 6, 0].includes(weekday(today))
    ? `<div class="card row between wrap"><span>Next week isn't planned yet.</span><button class="btn small primary" data-action="goto-plan" data-week="${addDays(thisWeek, 7)}">Plan next week</button></div>` : "";

  return `<div class="row between head"><h2>Today</h2>${streakBadge()}</div>
    ${celebrate}
    <div class="card">
      <div class="row between"><span class="small muted">This week</span><span class="small muted">${esc(weekRange(thisWeek))}</span></div>
      <div class="big">${km(ran)} <small>of ${km(planned)}</small></div>
      <div class="bar" role="img" aria-label="${esc(`${num(ran)} of ${num(planned)} km`)}"><span style="width:${planned ? Math.min(100, (ran / planned) * 100) : 0}%"></span></div>
      ${base.week ? `<p class="small muted">${esc(weekName(base.week))}: ${km(base.total)}</p>` : ""}
    </div>
    ${todayCard}${openCard}${planHint}${extraRun()}`;
}

function extraRun() {
  if (ui.logOpen !== "extra") return `<button class="btn block" data-action="log-open" data-id="extra">+ Log a run that wasn't planned</button>`;
  return `<div class="card">
    <strong>Log an extra run</strong>
    <div class="row wrap" style="margin:8px 0"><label class="inline small">Day <input type="date" id="extra-date" value="${todayKey()}" max="${todayKey()}"></label></div>
    ${logForm(null)}
    <button class="btn link" data-action="log-close">Cancel</button>
  </div>`;
}

// ---------- calendar ----------

function calendarView() {
  const today = todayKey();
  const [y, m] = ui.calMonth.split("-").map(Number);
  const gridStart = weekStart(`${ui.calMonth}-01`);
  const gridEnd = addDays(weekStart(toKey(new Date(y, m, 0))), 6);
  const cells = [];
  for (let k = gridStart; k <= gridEnd; k = addDays(k, 1)) {
    const marks = runsOn(state.runs, k).map((r) => {
      const cls = isDone(r) ? "done" : r.date < today ? "missed" : "planned";
      const label = isDone(r) ? `${num(r.actual)} km run` : r.date < today ? `${num(r.planned)} km missed` : `${num(r.planned)} km planned`;
      return `<span class="mark ${cls} ${r.long ? "long" : ""}" title="${esc(label)}">${esc(num(isDone(r) ? r.actual : r.planned))}</span>`;
    }).join("");
    const cls = ["day", k.startsWith(ui.calMonth) ? "" : "out", k === today ? "today" : "", ui.calSelected === k ? "selected" : ""].join(" ");
    cells.push(`<button class="${cls}" data-action="cal-day" data-date="${k}" aria-label="${esc(dayLabel(k))}">
      <span class="d">${Number(k.slice(8))}</span><span class="marks">${marks}</span></button>`);
  }
  const monthName = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const heads = WEEK_ORDER.map((wd) => `<span class="dow">${WEEKDAY_NAMES[wd].slice(0, 2)}</span>`).join("");
  return `<div class="row between head"><h2>Calendar</h2>${streakBadge()}</div>
    <div class="card cal">
      <div class="row between">
        <button class="btn icon" data-action="cal-month" data-delta="-1" aria-label="Previous month">‹</button>
        <strong>${esc(monthName)}</strong>
        <button class="btn icon" data-action="cal-month" data-delta="1" aria-label="Next month">›</button>
      </div>
      <div class="grid">${heads}${cells.join("")}</div>
      <div class="legend small muted">
        <span><span class="mark done">2.7</span> run</span>
        <span><span class="mark planned">3</span> planned</span>
        <span><span class="mark planned long">8</span> long run</span>
        <span><span class="mark missed">3</span> missed</span>
      </div>
    </div>
    ${ui.calSelected ? dayDetail(ui.calSelected, today) : `<p class="muted small">Tap a day to log, move or add a run.</p>`}`;
}

function dayDetail(k, today) {
  const runs = runsOn(state.runs, k);
  const future = k > today;
  return `<div class="card">
    <div class="row between"><strong>${esc(dayLabel(k))}</strong>
      <button class="btn small" data-action="goto-plan" data-week="${weekStart(k)}">Plan this week</button></div>
    ${runs.length ? runs.map((r) => runCard(r, today, true)).join("") : `<p class="muted small">No run on this day.</p>`}
    <div class="run">
      <span class="small">${future ? "Plan a run on this day" : "Add a run you did on this day"}</span>
      <div class="log-form">
        <input class="km-input" id="add-km" inputmode="decimal" autocomplete="off" value="${esc(num(defaultRunKm()))}" aria-label="Kilometres">
        <span class="muted">km</span>
        <button class="btn" data-action="add-on-day" data-date="${k}">${future ? "Add planned run" : "Add run"}</button>
      </div>
    </div>
  </div>`;
}

// ---------- planner ----------

function defaultPlanWeek() {
  const thisWeek = weekStart(todayKey());
  return runsInWeek(state.runs, thisWeek).length ? addDays(thisWeek, 7) : thisWeek;
}

const weekCheck = (monday) => {
  const base = baseline(state.runs, monday);
  return { base, total: plannedTotal(state.runs, monday), ...increaseCheck(base.total, plannedTotal(state.runs, monday), state.settings) };
};

function warningText(c) {
  return `<strong>That's ${c.pct}% more than ${esc(weekName(c.base.week).toLowerCase())}</strong> (${km(c.base.total)} → ${km(c.total)}). Increasing your weekly kilometres by more than ${state.settings.maxIncrease}% raises the risk of injury. You can still run it, but a smaller step is safer.`;
}

function previewSlots(items, monday) {
  return `<div class="preview" aria-label="Suggested week">${WEEK_ORDER.map((wd) => {
    const here = items.filter((i) => i.wd === wd);
    const cls = here.map((i) => [i.change === "new" ? "new" : i.change === "up" ? "up" : "", i.long ? "long" : ""].join(" ")).join(" ");
    return `<div class="slot ${cls}"><span>${WEEKDAY_NAMES[wd]}</span><strong>${here.length ? here.map((i) => num(i.km)).join("+") : "–"}</strong><span>${Number(dayInWeek(monday, wd).slice(8))}</span></div>`;
  }).join("")}</div>`;
}

function suggestionCard(monday) {
  const tpl = template(state.runs, monday);
  const longDay = ui.longPick ?? state.longRunDay;
  const s = suggestWeek(state.runs, monday, state.settings, longDay);
  const step = state.settings.step;
  let text;
  if (s.kind === "start") {
    text = `<strong>Start easy:</strong> ${km(s.total)} over ${s.runs.length} run${s.runs.length === 1 ? "" : "s"}. After that your week grows in steps of ${km(step)}, as many as fit within ${state.settings.maxIncrease}%.`;
  } else if (s.kind === "hold") {
    text = `<strong>You're at your goal of ${km(state.settings.goalKm)} a week.</strong> Keep it steady: the same ${km(s.total)} as last week. Raise the goal in the suggestion settings to keep building.`;
  } else if (s.kind === "increase") {
    const ups = s.runs.filter((r) => r.change === "up");
    const inc = round1(s.total - s.from);
    const runName = (r) => `${WEEKDAY_LONG[r.wd]}${r.long ? " (long run)" : ""}`;
    text = `<strong>Add ${km(inc)} (+${(Math.floor((inc / s.from) * 1000) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })}%)</strong>, ${ups.length === 1 ? `all on your ${esc(runName(ups[0]))} run` : "spread over your runs"}: ${ups.map((r) => `${esc(runName(r))} ${num(r.from)} → ${km(r.km)}`).join(", ")}. That makes ${km(s.total)} this week.`;
  } else {
    const added = s.runs.find((r) => r.change === "new");
    const count = s.runs.length;
    text = `<strong>Add a ${ordinal(count)} running day on ${esc(WEEKDAY_LONG[added.wd])}.</strong> Instead of another longer run, your ${km(s.total)} are spread over ${count} runs, so each one stays easy.`;
    if (s.longDay != null) {
      const chosen = defaultLongDay(tpl, longDay, state.settings.days);
      text += `<p class="small">From now on one run a week is your <strong>long run</strong>: most of the extra kilometres go there. Pick its day:</p>
        <div class="chips" role="group" aria-label="Long run day">${WEEK_ORDER.filter((wd) => state.settings.days.includes(wd)).map((wd) =>
          `<button class="chip" data-action="long-pick" data-wd="${wd}" aria-pressed="${wd === chosen}">${WEEKDAY_NAMES[wd]}</button>`).join("")}</div>`;
    }
  }
  const check = increaseCheck(baseline(state.runs, monday).total, s.total, state.settings);
  const moves = s.moves.length
    ? `<p class="small muted">You can't run on ${s.moves.map((m) => `${WEEKDAY_LONG[m.from]} (moved to ${WEEKDAY_LONG[m.to]})`).join(", ")}.</p>` : "";
  return `<div class="card">
    <h3>Suggested plan</h3>
    <div>${text}</div>${moves}
    ${previewSlots(s.runs, monday)}
    ${check.over ? `<p class="notice warn small">This is more than ${state.settings.maxIncrease}% above your last week.</p>` : ""}
    <div class="row wrap">
      <button class="btn primary" data-action="apply-suggestion" data-week="${monday}">Use this plan</button>
      ${tpl.length ? `<button class="btn" data-action="copy-last" data-week="${monday}">Copy last week</button>` : ""}
    </div>
  </div>`;
}

function planRunRow(r, monday, today) {
  const dayOptions = WEEK_ORDER.map((wd) => {
    const d = dayInWeek(monday, wd);
    return `<option value="${d}" ${d === r.date ? "selected" : ""}>${esc(dayLabel(d))}</option>`;
  }).join("");
  const status = isDone(r) ? `<span class="tag done">Ran ${km(r.actual)}</span>` : isMissed(r, today) ? `<span class="tag missed">Not logged</span>` : "";
  const kmControl = r.planned == null
    ? `<span class="small muted">Not planned</span>`
    : `<span class="stepper">
        <button class="btn small icon" data-action="plan-step" data-id="${esc(r.id)}" data-delta="-0.5" aria-label="0.5 km less">−</button>
        <input class="km-input" data-input="run-km" data-id="${esc(r.id)}" inputmode="decimal" autocomplete="off" value="${esc(num(r.planned))}" aria-label="Planned kilometres">
        <button class="btn small icon" data-action="plan-step" data-id="${esc(r.id)}" data-delta="0.5" aria-label="0.5 km more">+</button>
        <span class="muted small">km</span>
      </span>`;
  return `<div class="run">
    <div class="run-head">
      <select class="text-input" data-input="run-day" data-id="${esc(r.id)}" aria-label="Day">${dayOptions}</select>
      <span class="row">${r.long ? `<span class="tag long">Long run</span>` : ""}${status}</span>
    </div>
    <div class="run-edit">
      ${kmControl}
      <span class="row">
        <button class="btn small icon star" data-action="toggle-long" data-id="${esc(r.id)}" aria-pressed="${r.long}" aria-label="Long run" title="Long run">★</button>
        <button class="btn small danger" data-action="delete-run" data-id="${esc(r.id)}">Remove</button>
      </span>
    </div>
  </div>`;
}

function planView() {
  const today = todayKey();
  const monday = ui.planWeek ?? defaultPlanWeek();
  const runs = runsInWeek(state.runs, monday);
  const c = weekCheck(monday);
  const past = addDays(monday, 6) < today;
  const vs = c.base.week
    ? `<p class="small muted">${esc(weekName(c.base.week))}: ${km(c.base.total)}${runs.length ? ` · <span class="${c.over ? "warn" : c.diff > 0 ? "up" : ""}">${signed(c.diff)}${c.pct != null ? ` (${c.pct > 0 ? "+" : ""}${c.pct}%)` : ""}</span>` : ""}</p>`
    : "";
  const replace = runs.length && !past && !runs.some(isDone)
    ? `<details><summary class="small">Use the suggested plan instead</summary>${suggestionCard(monday)}</details>` : "";
  return `<div class="row between head"><h2>Plan</h2>${streakBadge()}</div>
    <div class="card weeknav">
      <button class="btn icon" data-action="plan-week" data-delta="-7" aria-label="Previous week">‹</button>
      <span class="label"><strong>${esc(weekName(monday))}</strong><span class="small muted">${esc(weekRange(monday))}</span></span>
      <button class="btn icon" data-action="plan-week" data-delta="7" aria-label="Next week">›</button>
    </div>
    <div class="card">
      <div class="row between"><span class="small muted">Planned this week</span><span class="small muted">${runs.length} run${runs.length === 1 ? "" : "s"}</span></div>
      <div class="big">${km(c.total)}</div>
      ${vs}
      ${c.over && runs.length ? `<p class="notice warn">${warningText(c)}</p>` : ""}
    </div>
    ${!runs.length && !past ? suggestionCard(monday) : ""}
    ${runs.length ? `<div class="card">${runs.map((r) => planRunRow(r, monday, today)).join("")}</div>` : past ? `<p class="muted small">No runs this week.</p>` : ""}
    <button class="btn block" data-action="plan-add" data-week="${monday}">+ Add a run</button>
    ${replace}
    <p class="small muted">★ marks the long run. Use the day menu to move a run.</p>
    ${aheadCard()}
    <details class="card">
      <summary>Suggestion settings</summary>
      ${progressionFields()}
    </details>`;
}

/** Plans several weeks at once from the suggestions, and clears what's planned after this week. */
function aheadCard() {
  const today = todayKey();
  const thisWeek = weekStart(today);
  const p = planAhead(state.runs, today, ui.aheadWeeks, state.settings, state.longRunDay, newId);
  const start = plannedTotal(state.runs, thisWeek);
  const peak = p.weeks.reduce((best, w) => (w.total >= best.total ? w : best), p.weeks[0]);
  const pct = start ? Math.round(((peak.total - start) / start) * 100) : null;
  const series = [{ week: thisWeek, actual: actualTotal(state.runs, thisWeek), planned: start }, ...p.weeks.map((w) => ({ week: w.week, actual: 0, planned: w.total }))];
  const future = futurePlanned(state.runs, today).length;
  const longNote = state.longRunDay == null && p.longDay != null
    ? `<p class="small muted">A long run day gets picked on the way: ${esc(WEEKDAY_LONG[p.longDay])}. Change it in the settings below.</p>` : "";
  return `<h2>Plan ahead</h2>
    <div class="card">
      <label class="field"><span>Weeks to plan</span><input type="text" inputmode="numeric" data-input="ahead-weeks" value="${ui.aheadWeeks}" aria-label="Weeks to plan"></label>
      <p>From <strong>${km(start)}</strong> this week to a peak of <strong>${km(peak.total)}</strong> in the week of ${esc(shortDate(peak.week))}${pct != null ? ` <span class="up">(+${pct}%)</span>` : ""}.</p>
      ${weeklyChart(series, thisWeek, true)}
      ${longNote}
      <div class="row wrap">
        <button class="btn primary" data-action="ahead-plan">Plan ${ui.aheadWeeks} week${ui.aheadWeeks === 1 ? "" : "s"}</button>
        ${future ? `<button class="btn danger" data-action="clear-future">Remove all runs after this week</button>` : ""}
      </div>
      <p class="small muted">Planning starts next week; this week stays as it is.${future ? ` The ${runs(future)} planned after this week get replaced.` : ""}</p>
    </div>`;
}

/**
 * Changes the plan of week `monday`. When the change pushes the week over the % limit, asks first
 * and undoes it if you'd rather not.
 */
async function planChange(monday, change) {
  const before = state;
  const wasOver = weekCheck(monday).over;
  change();
  const c = weekCheck(monday);
  if (!wasOver && c.over) {
    const ok = await ask(`${weekName(c.base.week)}: ${km(c.base.total)}. ${weekName(monday)} would have ${km(c.total)}, ${c.pct}% more. Increasing by more than ${state.settings.maxIncrease}% a week raises the risk of injury. Plan it anyway?`, "Plan it anyway");
    if (!ok) state = before;
  }
  save();
  render();
}

// ---------- progress ----------

function niceStep(max) {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100]) if (max / s <= 5) return s;
  return 200;
}

/** Weekly kilometres as columns: run (filled) and, for this and coming weeks, the planned rest (dashed). */
function weeklyChart(series, thisWeek, labelPeak = false) {
  if (series.length < 2) return `<p class="muted small">Your weekly kilometres show here once you've run for two weeks.</p>`;
  const W = 340, H = 190, L = 32, R = 8, T = 18, B = 24;
  const max = Math.max(...series.map((w) => Math.max(w.actual, w.week >= thisWeek ? w.planned : 0)), 1);
  const step = niceStep(max);
  const hi = Math.ceil(max / step) * step;
  const y = (v) => T + (1 - v / hi) * (H - T - B);
  const band = (W - L - R) / series.length;
  const bw = Math.max(2, Math.min(26, band - 2));
  const grid = [];
  for (let v = 0; v <= hi + 1e-9; v += step) {
    grid.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`);
  }
  const top = (x, v) => {
    const h = y(0) - y(v), r = Math.min(4, h, bw / 2);
    return `M${x},${y(0)}V${y(v) + r}Q${x},${y(v)} ${x + r},${y(v)}H${x + bw - r}Q${x + bw},${y(v)} ${x + bw},${y(v) + r}V${y(0)}Z`;
  };
  const sel = ui.chartSel && series.some((w) => w.week === ui.chartSel) ? ui.chartSel : null;
  const cols = series.map((w, i) => {
    const x = L + i * band + (band - bw) / 2;
    const plan = w.week >= thisWeek && w.planned > w.actual
      ? `<rect class="plan" x="${x + 0.75}" y="${y(w.planned)}" width="${bw - 1.5}" height="${Math.max(0, y(w.actual) - y(w.planned) - 0.75)}" rx="3"/>` : "";
    const col = w.actual > 0 ? `<path class="col" d="${top(x, w.actual)}"/>` : "";
    const label = `${weekRange(w.week)}: ${num(w.actual)} km run${w.week >= thisWeek ? `, ${num(w.planned)} km planned` : ""}`;
    return `${w.week === sel ? `<rect class="sel" x="${L + i * band}" y="${T - 6}" width="${band}" height="${y(0) - T + 6}" rx="4"/>` : ""}${plan}${col}
      <rect class="hit" data-action="chart-sel" data-week="${w.week}" x="${L + i * band}" y="${T - 6}" width="${band}" height="${H - T}"><title>${esc(label)}</title></rect>`;
  });
  // Direct label on the latest week with kilometres run, or on the peak of a plan.
  const planned = (w) => (w.week >= thisWeek ? Math.max(w.actual, w.planned) : w.actual);
  const lastIdx = labelPeak
    ? series.reduce((best, w, i) => (planned(w) >= planned(series[best]) ? i : best), 0)
    : series.map((w) => w.actual > 0).lastIndexOf(true);
  const lx = L + lastIdx * band + band / 2;
  const last = series[lastIdx];
  const value = lastIdx >= 0 ? `<text class="value" x="${lx}" y="${y(planned(last)) - 5}" text-anchor="${lx > W - 24 ? "end" : "middle"}">${num(labelPeak ? planned(last) : last.actual)}</text>` : "";
  const summary = `Weekly kilometres from ${num(series[0].actual)} to ${num(series.at(-1).actual)} km`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}">
    ${grid.join("")}${cols.join("")}${value}
    <text class="axis" x="${L}" y="${H - 6}">${esc(shortDate(series[0].week))}</text>
    <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(shortDate(series.at(-1).week))}</text>
  </svg>`;
}

function progressView() {
  const today = todayKey();
  const thisWeek = weekStart(today);
  const lastPlanned = state.runs.reduce((w, r) => (weekStart(r.date) > w ? weekStart(r.date) : w), thisWeek);
  // 12 weeks / 6 months start at this week, so it stays in view however far ahead you've planned.
  const series = ui.chartRange
    ? Array.from({ length: ui.chartRange }, (_, i) => {
      const week = addDays(thisWeek, 7 * i);
      return { week, actual: actualTotal(state.runs, week), planned: plannedTotal(state.runs, week) };
    })
    : weeklySeries(state.runs, lastPlanned);
  const ms = milestones(state.runs, today, state.settings.milestoneStep);
  const streak = streakWeeks(state.runs, today);
  const total = round1(state.runs.reduce((a, r) => a + (r.actual ?? 0), 0));
  const runsDone = state.runs.filter(isDone).length;
  const selWeek = series.find((w) => w.week === ui.chartSel) ?? series.filter((w) => w.week <= thisWeek).at(-1);
  const readout = selWeek
    ? `<strong>${esc(weekName(selWeek.week))}</strong> <span class="muted">(${esc(weekRange(selWeek.week))})</span>: ${km(selWeek.actual)} run${selWeek.week >= thisWeek && selWeek.planned !== selWeek.actual ? ` of ${km(selWeek.planned)} planned` : ""}` : "";
  const ranges = [[12, "12 weeks"], [26, "6 months"], [0, "All"]].map(([n, label]) =>
    `<button class="chip" data-action="chart-range" data-n="${n}" aria-pressed="${ui.chartRange === n}">${label}</button>`).join("");
  const stones = ms.reached.map((m) => `<div class="stone" title="First reached in the week of ${esc(shortDate(m.week))}"><strong>${m.km} km</strong><span>${esc(shortDate(m.week))}</span></div>`).join("");

  return `<div class="row between head"><h2>Progress</h2>${streakBadge()}</div>
    <div class="chips" role="group" aria-label="Time range">${ranges}</div>
    <div class="card">
      <h3>Weekly kilometres</h3>
      ${weeklyChart(series, thisWeek)}
      <p class="small readout" role="status">${readout}</p>
      <div class="legend small muted"><span><span class="mark done">&nbsp;</span> run</span><span><span class="mark planned" style="border-style:dashed">&nbsp;</span> still planned</span></div>
      <div class="stats">
        <div><span class="small muted">This week</span><strong>${km(actualTotal(state.runs, thisWeek))}</strong></div>
        <div><span class="small muted">Best week</span><strong>${km(ms.best)}</strong></div>
        <div><span class="small muted">Total</span><strong>${km(total)}</strong></div>
        <div><span class="small muted">Runs</span><strong>${runsDone}</strong></div>
      </div>
    </div>
    <h2>Milestones</h2>
    <div class="card">
      <div class="row between"><span>Next: a <strong>${ms.next} km</strong> week</span><span class="small muted num">${km(ms.best)} / ${ms.next} km</span></div>
      <div class="bar"><span style="width:${ms.progress * 100}%"></span></div>
      <p class="small muted">${ms.best ? `Your best week so far is ${km(ms.best)}. ` : ""}A milestone for every ${km(state.settings.milestoneStep)} in one week.</p>
      ${stones ? `<div class="stones">${stones}</div>` : ""}
    </div>
    <h2>Streak</h2>
    <div class="card">
      <div class="row">${streakBadge()}</div>
      <p class="small muted">Every week you run more kilometres than the week before adds to your streak. This week joins as soon as you've beaten last week${streak ? "" : ". Run a little more than last week to start one"}.</p>
    </div>`;
}

// ---------- settings ----------

/** A sensible distance for a run added by hand: an even share of the first week. */
const defaultRunKm = () => Math.max(0.5, floorHalf(state.settings.startWeekKm / Math.max(1, state.settings.startDays.length)));

const GOAL_FIELDS = [
  ["goalKm", "Goal (km a week)", "Suggestions build up to this and then keep your week steady. Leave empty for no goal.", 0, 1000],
  ["startWeekKm", "First week (km)", "Spread over your first week's running days.", 0.5, 200],
];
const SETTING_FIELDS = [
  ["step", "Increase in steps of (km)", "Suggestions add steps of this size until one more would pass the warning limit. Always at least one step.", 0.1, 10],
  ["maxIncrease", "Warn above (% per week)", "Plans that grow faster than this get a warning. One step is always fine.", 1, 100],
  ["addDayEvery", "New running day every (km)", "A new day is suggested before your week reaches 10, 20, 30… km.", 2, 100],
  ["maxDays", "Most running days a week", "", 2, 7],
  ["longShare", "Long run at most (% of the week)", "Beyond this, increases go to your other runs.", 20, 100],
  ["longCapKm", "Long run limit (km)", "Once the long run would pass this distance, it may only take the share below.", 5, 100],
  ["longShareAbove", "Above the limit: long run at most (%)", "", 10, 100],
];
const MILESTONE_FIELDS = [
  ["milestoneStep", "Milestone every (km a week)", "", 1, 100],
];

/** The suggestion parameters, shown in Settings and in the planner. */
function progressionFields() {
  const s = state.settings;
  const fields = (list) => list.map(([name, label, hint, min, max]) =>
    `<label class="field"><span>${esc(label)}</span><input type="text" inputmode="decimal" name="${name}" data-input="setting" value="${name === "goalKm" && !s.goalKm ? "" : esc(num(s[name]))}" ${name === "goalKm" ? `placeholder="None"` : ""} data-min="${min}" data-max="${max}">
      ${hint ? `<span class="small muted hint">${esc(hint)}</span>` : ""}</label>`).join("");
  const dayChips = (action, on, label, enabled = () => true) => `<div class="chips" role="group" aria-label="${esc(label)}">${WEEK_ORDER.map((wd) =>
    `<button class="chip" data-action="${action}" data-wd="${wd}" aria-pressed="${on(wd)}" ${enabled(wd) ? "" : "disabled"}>${WEEKDAY_NAMES[wd]}</button>`).join("")}</div>`;
  const longDay = `<label class="field"><span>Long run day</span><select data-input="long-day">
      <option value="">Not chosen yet</option>
      ${WEEK_ORDER.filter((wd) => s.days.includes(wd)).map((wd) => `<option value="${wd}" ${state.longRunDay === wd ? "selected" : ""}>${WEEKDAY_LONG[wd]}</option>`).join("")}
    </select></label>`;
  return `<h3>Your week</h3>
    <p class="small">Days you can run</p>
    ${dayChips("allowed-day", (wd) => s.days.includes(wd), "Days you can run")}
    <p class="small muted">Suggestions only put runs on these days.</p>
    ${fields(GOAL_FIELDS)}
    <p class="small">Running days in your first week</p>
    ${dayChips("start-day", (wd) => s.startDays.includes(wd), "First week days", (wd) => s.days.includes(wd))}
    ${longDay}
    <h3>Growth</h3>
    ${fields(SETTING_FIELDS.slice(0, 4))}
    <h3>Long run</h3>
    ${fields(SETTING_FIELDS.slice(4))}
    <h3>Milestones</h3>
    ${fields(MILESTONE_FIELDS)}
    <button class="btn link" data-action="reset-settings">Back to the defaults</button>`;
}

function settingsView() {
  return `<h2>Settings</h2>
    <div class="card">
      ${progressionFields()}
    </div>
    <h2>Your data</h2>
    <div class="card data">
      <p class="small">Export saves all your runs and settings to a file. Import replaces everything in this app with a file's contents.</p>
      <div class="row wrap">
        <button class="btn" data-action="export-file">Export data</button>
        <label class="btn">Import data<input type="file" accept="application/json,.json,text/plain" id="import" hidden></label>
      </div>
      <p class="small" id="backup-status" role="status">${esc(ui.flash)}</p>
      <details id="backup-paste">
        <summary class="small">Copy and paste instead</summary>
        <textarea id="backup" rows="5" spellcheck="false" aria-label="Exported data"></textarea>
        <div class="row wrap">
          <button class="btn small" data-action="copy-backup">Copy my data</button>
          <button class="btn small" data-action="import-text">Import pasted text</button>
        </div>
      </details>
    </div>
    <div class="card row between wrap">
      <span class="small muted">Your data is saved on this device only. Export it now and then.</span>
      <button class="btn small" data-action="reset">Reset everything</button>
    </div>`;
}

// ---------- events ----------

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  view = b.dataset.view;
  ui.flash = "";
  ui.logOpen = null;
  if (view === "plan") { ui.planWeek = null; ui.longPick = null; }
  render();
  window.scrollTo(0, 0);
});

const runById = (id) => state.runs.find((r) => r.id === id);
const runs = (n) => `${n} run${n === 1 ? "" : "s"}`;

/** What logging a run achieved: a new milestone or a longer streak. */
function achievements(before, today) {
  const ms = milestones(state.runs, today, state.settings.milestoneStep);
  const streak = streakWeeks(state.runs, today);
  const news = ms.reached.filter((m) => !before.reached.some((b) => b.km === m.km));
  const lines = [];
  if (news.length) lines.push(`<strong>Milestone: ${news.at(-1).km} km in a week!</strong> Your best week is now ${km(ms.best)}.`);
  if (streak > before.streak) lines.push(`<strong>${streak}-week streak.</strong> More kilometres than last week.`);
  return lines.join("<br>");
}

const actions = {
  "goto-plan"(el) {
    view = "plan";
    ui.planWeek = el.dataset.week ?? null;
    ui.longPick = null;
    window.scrollTo(0, 0);
  },
  "log-open"(el) { ui.logOpen = el.dataset.id; },
  "log-close"() { ui.logOpen = null; },
  "log-step"(el) {
    const input = document.getElementById(`log-${el.dataset.id}`);
    const n = parseKm(input.value) ?? 0;
    input.value = num(Math.max(0, round1(n + Number(el.dataset.delta))));
    return false;
  },
  "log-save"(el) {
    const id = el.dataset.id;
    const value = parseKm(document.getElementById(`log-${id}`).value);
    if (value == null || value <= 0) return false;
    const today = todayKey();
    const before = { reached: milestones(state.runs, today, state.settings.milestoneStep).reached, streak: streakWeeks(state.runs, today) };
    if (id === "extra") {
      const date = document.getElementById("extra-date").value;
      if (!isDateKey(date) || date > today) return false;
      state = { ...state, runs: [...state.runs, { id: newId(), date, planned: null, actual: value, long: false }] };
    } else {
      state = updateRun(state, id, { actual: value });
    }
    ui.logOpen = null;
    ui.celebrate = achievements(before, today);
  },
  "log-undo"(el) {
    const r = runById(el.dataset.id);
    if (!r) return false;
    state = r.planned == null ? deleteRun(state, r.id) : updateRun(state, r.id, { actual: null });
  },
  "cal-month"(el) {
    const [y, m] = ui.calMonth.split("-").map(Number);
    ui.calMonth = toKey(new Date(y, m - 1 + Number(el.dataset.delta), 1)).slice(0, 7);
    ui.calSelected = null;
  },
  "cal-day"(el) {
    ui.calSelected = ui.calSelected === el.dataset.date ? null : el.dataset.date;
    ui.logOpen = null;
  },
  "move-run"(el) {
    const date = document.getElementById(`move-${el.dataset.id}`).value;
    if (!isDateKey(date)) return false;
    state = moveRun(state, el.dataset.id, date);
    ui.calSelected = date;
    ui.calMonth = date.slice(0, 7);
  },
  async "delete-run"(el) {
    const r = runById(el.dataset.id);
    if (!r) return false;
    const what = isDone(r) ? `your ${km(r.actual)} run on ${dayLabel(r.date)}. The kilometres you logged will be lost` : `the ${km(r.planned)} run planned for ${dayLabel(r.date)}`;
    const ok = await ask(`Remove ${what}? Next week's suggestion is based on this week, so it changes too.`, "Remove run");
    if (!ok) return false;
    state = deleteRun(state, r.id);
  },
  "add-on-day"(el) {
    const value = parseKm(document.getElementById("add-km").value);
    if (value == null || value <= 0) return false;
    const date = el.dataset.date;
    const future = date > todayKey();
    state = { ...state, runs: [...state.runs, { id: newId(), date, planned: future ? value : null, actual: future ? null : value, long: false }] };
  },
  "plan-week"(el) {
    ui.planWeek = addDays(ui.planWeek ?? defaultPlanWeek(), Number(el.dataset.delta));
    ui.longPick = null;
  },
  "long-pick"(el) { ui.longPick = Number(el.dataset.wd); },
  "apply-suggestion"(el) {
    const monday = el.dataset.week;
    const s = suggestWeek(state.runs, monday, state.settings, ui.longPick ?? state.longRunDay);
    planChange(monday, () => {
      const keep = state.runs.filter((r) => !(r.date >= monday && r.date <= addDays(monday, 6) && !isDone(r)));
      state = { ...state, runs: [...keep, ...runsFromItems(s.runs, monday, newId)], longRunDay: s.longDay ?? state.longRunDay };
    });
    ui.planWeek = monday;
    return false;
  },
  "copy-last"(el) {
    const monday = el.dataset.week;
    const items = template(state.runs, monday);
    planChange(monday, () => { state = { ...state, runs: [...state.runs, ...runsFromItems(items, monday, newId)] }; });
    ui.planWeek = monday;
    return false;
  },
  "plan-add"(el) {
    const monday = el.dataset.week;
    const used = runsInWeek(state.runs, monday).map((r) => weekday(r.date));
    const wd = bestFreeDay(used, state.settings.days) ?? bestFreeDay(used) ?? 1;
    const run = { id: newId(), date: dayInWeek(monday, wd), planned: defaultRunKm(), actual: null, long: false };
    ui.planWeek = monday;
    planChange(monday, () => { state = { ...state, runs: [...state.runs, run] }; });
    return false;
  },
  "plan-step"(el) {
    const r = runById(el.dataset.id);
    if (!r || r.planned == null) return false;
    const value = Math.max(0.5, round1(r.planned + Number(el.dataset.delta)));
    planChange(weekStart(r.date), () => { state = updateRun(state, r.id, { planned: value }); });
    return false;
  },
  "toggle-long"(el) {
    const r = runById(el.dataset.id);
    if (!r) return false;
    state = setLong(state, r.id, !r.long);
  },
  async "ahead-plan"() {
    const today = todayKey();
    const future = futurePlanned(state.runs, today).length;
    if (future && !(await ask(`Replace the ${runs(future)} planned after this week with a ${ui.aheadWeeks}-week plan from the suggestions?`, "Replace plan"))) return false;
    const p = planAhead(state.runs, today, ui.aheadWeeks, state.settings, state.longRunDay, newId);
    state = { ...state, runs: p.runs, longRunDay: p.longDay ?? state.longRunDay };
  },
  async "clear-future"() {
    const future = new Set(futurePlanned(state.runs, todayKey()));
    if (!(await ask(`Remove all ${runs(future.size)} planned after this week? This week and logged runs stay.`, "Remove runs"))) return false;
    state = { ...state, runs: state.runs.filter((r) => !future.has(r)) };
  },
  "chart-range"(el) { ui.chartRange = Number(el.dataset.n); },
  "chart-sel"(el) { ui.chartSel = el.dataset.week; },
  "start-day"(el) {
    const wd = Number(el.dataset.wd);
    const days = state.settings.startDays.includes(wd) ? state.settings.startDays.filter((d) => d !== wd) : [...state.settings.startDays, wd];
    if (!days.length) return false;
    state = { ...state, settings: { ...state.settings, startDays: days } };
  },
  "allowed-day"(el) {
    const wd = Number(el.dataset.wd);
    const s = state.settings;
    const days = s.days.includes(wd) ? s.days.filter((d) => d !== wd) : [...s.days, wd];
    if (!days.length) return false; // keep at least one day
    // A first-week day you can't run on any more is swapped for another free day.
    const startDays = s.startDays.filter((d) => days.includes(d));
    while (startDays.length < Math.min(s.startDays.length, days.length)) startDays.push(bestFreeDay(startDays, days));
    state = {
      ...state,
      settings: { ...s, days, startDays },
      longRunDay: days.includes(state.longRunDay) ? state.longRunDay : null,
    };
  },
  async "reset-settings"() {
    if (!(await ask("Set all progression settings back to their defaults?", "Reset settings"))) return false;
    state = { ...state, settings: createState().settings };
  },
  "export-file"() { exportData(); return false; },
  "copy-backup"() { copyBackup(); return false; },
  "import-text"() { importText(document.getElementById("backup").value); return false; },
  async reset() {
    const ok = await ask(`Delete all ${runs(state.runs.length)} and your settings? This can't be undone. Export your data first if you might need it.`, "Delete everything");
    if (!ok) return false;
    state = createState();
    ui.planWeek = null;
  },
};

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !actions[el.dataset.action]) return;
  // An action returns false when nothing changed (cancelled, invalid, or handled itself).
  if ((await actions[el.dataset.action](el)) === false) return;
  save();
  render();
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "import") {
    const file = t.files[0];
    t.value = ""; // so picking the same file again still triggers an import
    return file && importText(await file.text());
  }
  const input = t.dataset.input;
  if (input === "run-km") {
    const r = runById(t.dataset.id);
    const value = parseKm(t.value);
    if (!r || value == null || value <= 0) return render();
    return planChange(weekStart(r.date), () => { state = updateRun(state, r.id, { planned: value }); });
  }
  if (input === "run-day") {
    if (!isDateKey(t.value)) return render();
    state = moveRun(state, t.dataset.id, t.value);
  } else if (input === "setting") {
    const n = t.name === "goalKm" && t.value.trim() === "" ? 0 : parseKm(t.value);
    const [min, max] = [Number(t.dataset.min), Number(t.dataset.max)];
    if (n == null || n < min || n > max) return render();
    state = { ...state, settings: { ...state.settings, [t.name]: t.name === "maxDays" ? Math.round(n) : n } };
  } else if (input === "ahead-weeks") {
    const n = Math.round(Number(t.value));
    if (n >= 1 && n <= 52) ui.aheadWeeks = n;
    return render();
  } else if (input === "long-day") {
    state = { ...state, longRunDay: t.value === "" ? null : Number(t.value) };
  } else {
    return;
  }
  save();
  render();
});

// Enter in a distance field saves it, like leaving the field.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.matches?.(".km-input, .field input")) return;
  const button = e.target.closest(".log-form")?.querySelector("[data-action='log-save'], [data-action='add-on-day']");
  if (button) button.click();
  else e.target.blur();
});

// ---------- export / import ----------
// Exports download as a file on the web and go through Android's save dialog in the app.

function backupStatus(msg) {
  ui.flash = msg;
  const el = document.getElementById("backup-status");
  if (el) el.textContent = msg;
}

function exportData() {
  const text = JSON.stringify(makeBackup(state));
  const name = `meilenmaxxen-${todayKey()}.json`;
  if (window.MeilenMaxxenAndroid?.exportFile) {
    window.MeilenMaxxenAndroid.exportFile(name, text);
    return backupStatus("Choose where to save the file.");
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  backupStatus(`Exported ${runs(state.runs.length)} to ${name}.`);
}

// Called by the Android app once the save dialog finishes.
window.onAndroidExport = (ok) => backupStatus(ok ? "Exported. The file is where you chose to save it." : "Export cancelled.");

async function copyBackup() {
  const box = document.getElementById("backup");
  if (!box.value) box.value = JSON.stringify(makeBackup(state));
  try {
    await navigator.clipboard.writeText(box.value);
    backupStatus("Copied.");
  } catch {
    box.focus();
    box.select();
    backupStatus("Selected. Use your device's Copy.");
  }
}

/** Import always replaces everything, so it asks first and says exactly what will be lost. */
async function importText(text) {
  const data = readBackup(text);
  if (!data) return backupStatus("That isn't a MeilenMaxxen export. Nothing was changed.");
  const ok = await ask(
    `Replace ALL data in this app? Your ${runs(state.runs.length)} and settings will be overwritten by the file's ${runs(data.runs.length)}. This can't be undone.`,
    "Replace my data",
  );
  if (!ok) return backupStatus("Import cancelled. Nothing was changed.");
  state = data;
  ui.flash = `Imported ${runs(data.runs.length)}.`;
  save();
  render();
}

// In-page confirmation: native confirm() is unavailable in some embedded views.
function ask(message, okLabel) {
  const modal = document.getElementById("modal");
  const ok = document.getElementById("modal-ok");
  const cancel = document.getElementById("modal-cancel");
  document.getElementById("modal-text").textContent = message;
  ok.textContent = okLabel;
  modal.hidden = false;
  cancel.focus();
  return new Promise((resolve) => {
    const done = (value) => {
      modal.hidden = true;
      ok.onclick = cancel.onclick = modal.onkeydown = null;
      resolve(value);
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    modal.onkeydown = (ev) => ev.key === "Escape" && done(false);
  });
}

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

render();
