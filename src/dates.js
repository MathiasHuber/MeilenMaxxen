// Calendar logic: dates are local "YYYY-MM-DD" keys, which sort and compare as strings.
// Weeks run Monday to Sunday and are identified by their Monday.

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Weekdays in display order, Monday first (values are Date#getDay numbers). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function toKey(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = (now = new Date()) => toKey(now);

export function isDateKey(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && toKey(fromKey(v)) === v;
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export const weekday = (key) => fromKey(key).getDay();

/** Monday of the week containing `key`. */
export const weekStart = (key) => addDays(key, -((weekday(key) + 6) % 7));

/** The date of weekday `wd` (0 = Sunday) in the week starting on Monday `monday`. */
export const dayInWeek = (monday, wd) => addDays(monday, (wd + 6) % 7);

/** Position of a weekday in the Monday-first week: Mon 0 … Sun 6. */
export const weekPos = (wd) => (wd + 6) % 7;
