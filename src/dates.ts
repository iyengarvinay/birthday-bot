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
