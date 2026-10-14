export interface Entry {
  name: string;
  month: number;
  day: number;
}

export type Command =
  | { kind: "help" }
  | { kind: "list" }
  | { kind: "delete"; name: string }
  | { kind: "add"; entries: Entry[]; unreadable: string[] };

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

// Longest day in each month, counting Feb 29 so leap-day birthdays are allowed.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const MAX_NAME_LENGTH = 50;

export function parseMessage(body: string): Command {
  const text = body.trim();
  const lower = text.toLowerCase();

  if (lower === "" || ["help", "hi", "hello", "start", "?", "commands"].includes(lower)) {
    return { kind: "help" };
  }
  if (["list", "ls", "show", "all"].includes(lower)) {
    return { kind: "list" };
  }
  const del = text.match(/^(?:delete|remove|forget)\s+(.+)$/i);
  if (del?.[1]) {
    return { kind: "delete", name: cleanName(del[1]) };
  }

  const entries: Entry[] = [];
  const unreadable: string[] = [];
  // One birthday per line, or separated by ";" or ",". A comma directly before
  // a year ("May 6, 1990") is part of the date, not a separator.
  for (const raw of text.split(/\n|;|,(?!\s*\d{4}\b)/)) {
    const part = raw.trim();
    if (!part) continue;
    const entry = parseEntry(part);
    if (entry) entries.push(entry);
    else unreadable.push(part);
  }
  return { kind: "add", entries, unreadable };
}

export function parseEntry(text: string): Entry | null {
  const sep = String.raw`[\s:\-–—]+`;
  const numeric = String.raw`(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](?:\d{4}|\d{2}))?`;
  const named = String.raw`([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+\d{4})?`;

  const patterns: Array<[RegExp, (m: RegExpMatchArray) => [string, number, number] | null]> = [
    // Varun 5/6, Varun: 5-6-1990
    [new RegExp(`^(.+?)${sep}${numeric}$`, "i"), (m) => [m[1]!, +m[2]!, +m[3]!]],
    // 5/6 Varun
    [new RegExp(`^${numeric}${sep}(.+)$`, "i"), (m) => [m[3]!, +m[1]!, +m[2]!]],
    // Varun May 6, Varun - May 6th, 1990
    [new RegExp(`^(.+?)${sep}${named}$`, "i"), (m) => withMonthName(m[1]!, m[2]!, m[3]!)],
    // May 6 Varun
    [new RegExp(`^${named}${sep}(.+)$`, "i"), (m) => withMonthName(m[3]!, m[1]!, m[2]!)],
  ];

  for (const [re, extract] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const parts = extract(m);
    if (!parts) continue;
    const [rawName, month, day] = parts;
    const name = cleanName(rawName);
    if (name && isValidDate(month, day)) return { name, month, day };
  }
  return null;
}

function withMonthName(name: string, monthWord: string, day: string): [string, number, number] | null {
  const month = MONTHS.indexOf(monthWord.slice(0, 3).toLowerCase()) + 1;
  // Reject words that merely start like a month ("Mayra 6" is not May 6).
  const full = monthWord.toLowerCase();
  const isMonthWord = month > 0 && MONTH_NAMES[month - 1]!.startsWith(full) && full.length >= 3;
  return isMonthWord ? [name, month, +day] : null;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export function isValidDate(month: number, day: number): boolean {
  return Number.isInteger(month) && Number.isInteger(day)
    && month >= 1 && month <= 12
    && day >= 1 && day <= DAYS_IN_MONTH[month - 1]!;
}

function cleanName(raw: string): string {
  return raw
    .replace(/['’]s\s+(?:birthday|bday)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

export function formatDate(month: number, day: number): string {
  const label = MONTH_NAMES[month - 1]!;
  return `${label[0]!.toUpperCase()}${label.slice(1)} ${day}`;
}
