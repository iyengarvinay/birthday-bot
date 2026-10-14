export interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
}

/** The calendar date and hour at `now` in the given IANA time zone. */
export function localTime(now: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The saved (month, day) pairs whose reminder falls on this date. Feb 29
 * birthdays are celebrated on Feb 28 in years without a leap day.
 */
export function birthdayDatesFor(year: number, month: number, day: number): Array<[number, number]> {
  const dates: Array<[number, number]> = [[month, day]];
  if (month === 2 && day === 28 && !isLeapYear(year)) dates.push([2, 29]);
  return dates;
}

/**
 * Days from `today` until the next occurrence of a birthday (0 if it's today).
 * Feb 29 birthdays fall on Feb 28 in non-leap years, matching the reminders.
 */
export function daysUntil(month: number, day: number, today: { year: number; month: number; day: number }): number {
  const start = Date.UTC(today.year, today.month - 1, today.day);
  for (const year of [today.year, today.year + 1]) {
    const observedDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
    const date = Date.UTC(year, month - 1, observedDay);
    if (date >= start) return Math.round((date - start) / 86_400_000);
  }
  throw new Error(`no upcoming date for ${month}/${day}`);
}
