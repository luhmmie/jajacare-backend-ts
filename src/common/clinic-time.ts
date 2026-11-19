/**
 * The clinic runs on Lagos time. Nigeria has no daylight saving, so Africa/Lagos is a fixed UTC+1 and
 * "local date + HH:mm -> UTC instant" is a constant shift. All slot maths goes through these helpers so
 * "today", "this slot" and "this week" mean the same thing on a server running in UTC.
 */
export const CLINIC_TZ = 'Africa/Lagos';
const OFFSET = '+01:00';
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DAY_MS = 86_400_000;

export function isValidDateString(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** YYYY-MM-DD of an instant, in Lagos. */
export function lagosDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The UTC instant of `time` (HH:mm) on Lagos calendar day `date`. */
export function lagosToUtc(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${OFFSET}`);
}

/** 0 = Sunday … 6 = Saturday, for a Lagos calendar day. */
export function lagosWeekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** [from, to) covering one Lagos calendar day. */
export function lagosDayRange(date: string): { from: Date; to: Date } {
  const from = lagosToUtc(date, '00:00');
  return { from, to: new Date(from.getTime() + DAY_MS) };
}
