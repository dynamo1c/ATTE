/**
 * Calendar dates as plain "YYYY-MM-DD" strings (same as Postgres `date`).
 * All arithmetic happens in UTC so a server's local timezone can never shift a day.
 */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string): IsoDate {
  if (!ISO_DATE.test(value)) throw new Error(`Invalid date "${value}", expected YYYY-MM-DD`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date "${value}"`);
  }
  return value;
}

function toUtc(date: IsoDate): Date {
  return new Date(`${assertIsoDate(date)}T00:00:00Z`);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: IsoDate): number {
  const day = toUtc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Inclusive range of dates from `from` to `to`. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = assertIsoDate(from); d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's date in the college timezone. */
export function todayIn(timezone = "Asia/Kolkata", now = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Monday of the week containing `date`. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}
