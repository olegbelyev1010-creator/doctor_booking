/**
 * Shared slot generation (local calendar days, ISO timestamps).
 */

export const WORK_HOURS_WEEKDAY = [9, 10, 11, 12, 14, 15, 16, 17, 18];
export const WORK_HOURS_WEEKEND = [10, 11, 12, 14, 15];

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

/** Last calendar day of June for the booking horizon (June 30 of current or next year). */
export function getEndOfJune(referenceDate = new Date()) {
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);
  let year = today.getFullYear();
  let end = new Date(year, 5, 30);
  end.setHours(0, 0, 0, 0);
  if (today > end) {
    year += 1;
    end = new Date(year, 5, 30);
    end.setHours(0, 0, 0, 0);
  }
  return end;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatDateYMD(date) {
  const d = startOfDay(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Slots for a single calendar day. */
export function generateSlotsForDay(date) {
  const slots = [];
  const day = startOfDay(date);
  const dow = day.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const pool = isWeekend ? WORK_HOURS_WEEKEND : WORK_HOURS_WEEKDAY;
  const count = isWeekend ? randomInt(2, 4) : randomInt(4, 7);

  const hours = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
  for (const hour of hours) {
    const slot = new Date(day);
    slot.setHours(hour, randomInt(0, 1) * 30, 0, 0);
    slots.push(slot.toISOString());
  }
  return slots;
}

/** Inclusive range [fromDate, toDate] by calendar day. */
export function generateSlotsInRange(fromDate, toDate) {
  const slots = [];
  const from = startOfDay(fromDate);
  const to = startOfDay(toDate);
  if (from > to) return slots;

  const cursor = new Date(from);
  while (cursor <= to) {
    slots.push(...generateSlotsForDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots.sort();
}

/** From tomorrow through end of June. */
export function generateSlotsThroughEndOfJune(referenceDate = new Date()) {
  const today = startOfDay(referenceDate);
  const start = new Date(today);
  start.setDate(start.getDate() + 1);
  return generateSlotsInRange(start, getEndOfJune(today));
}

/** First calendar day after the latest existing slot, but not before tomorrow. */
export function getExtensionStartDate(existingSlots, referenceDate = new Date()) {
  const today = startOfDay(referenceDate);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let latest = null;
  for (const iso of existingSlots) {
    const d = startOfDay(new Date(iso));
    if (!latest || d > latest) latest = d;
  }

  if (!latest) return tomorrow;

  const dayAfterLatest = new Date(latest);
  dayAfterLatest.setDate(dayAfterLatest.getDate() + 1);
  return dayAfterLatest > tomorrow ? dayAfterLatest : tomorrow;
}
