export interface Entry {
  name: string;
  month: number;
  day: number;
}

export type Command =
  | { kind: "help" }
  | { kind: "thanks" }
  | { kind: "ok" }
  | { kind: "list" }
  | { kind: "delete"; name: string }
  | { kind: "rename"; name: string }
  | { kind: "find"; name: string }
  | { kind: "add"; entries: Entry[]; unreadable: string[] };

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

// Longest day in each month, counting Feb 29 so leap-day birthdays are allowed.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const MAX_NAME_LENGTH = 50;

const GREETINGS = ["help", "hi", "hey", "hello", "start", "?", "commands"];

// Small talk is recognized only when every word is on these lists, so a
// birthday like "Sure 5/6" is never mistaken for it.
const THANKS_WORDS = ["thanks", "thank", "thx", "ty", "tysm", "tks"];
const SMALL_TALK_WORDS = [
  ...THANKS_WORDS, "you", "u", "so", "much", "a", "lot", "very",
  "ok", "okay", "k", "kk", "cool", "nice", "great", "awesome", "perfect", "amazing",
  "sounds", "good", "got", "it", "lol", "haha", "yes", "yep", "yeah", "sure",
  "np", "alright", "will", "do", "love", "this",
];
const THANKS_EMOJI = /[🙏❤♥🥰😍💙💚💜🧡💛🤍]/u;
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f]/gu;

export function parseMessage(body: string): Command {
  const text = body.trim();
  const lower = text.toLowerCase();

  if (lower === "" || GREETINGS.includes(lower)) {
    return { kind: "help" };
  }
  const smallTalk = parseSmallTalk(lower);
  if (smallTalk) return smallTalk;
  if (["list", "ls", "show", "all"].includes(lower)) {
    return { kind: "list" };
  }
  const del = text.match(/^(?:delete|remove|forget)\s+(.+)$/i);
  if (del?.[1]) {
    return { kind: "delete", name: cleanName(del[1]) };
  }
  const rename = text.match(/^(?:call me|my name is|my name's|my name’s)\s+(.+)$/i);
  const newName = rename?.[1] ? parseName(rename[1]) : null;
  if (newName) {
    return { kind: "rename", name: newName };
  }

  const found = parseFind(text);
  if (found) {
    return { kind: "find", name: found };
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

const MAX_USER_NAME_LENGTH = 30;

// Common words that show up in chatty replies but are never someone's name,
// so "hey what's up" or "not now" isn't saved as a name.
const NOT_NAMES = new Set([
  "what", "whats", "up", "who", "why", "how", "when", "where", "is", "are", "was", "the", "a", "an",
  "there", "here", "this", "that", "you", "your", "me", "my", "i", "it", "no", "not", "nope", "now",
  "later", "idk", "huh", "wait", "test", "testing", "stop", "please", "sorry", "good", "morning",
  "night", "fine", "and", "or", "but", "so", "to", "of", "for", "with", "do", "does", "can", "help",
  "yo", "sup", "bot", "hello", "hi", "hey", "list", "ls", "show", "all", "delete", "remove",
  "forget", "start", "commands",
  // Small talk, except words that are also common first names.
  ...SMALL_TALK_WORDS.filter((w) => w !== "will"),
]);

/**
 * Reads a person's own name from a reply like "Vinay", "I'm Vinay" or
 * "hi, my name is Vinay Iyengar". Returns null unless it looks like a name:
 * one to three words of letters, with no digits.
 */
export function parseName(text: string, { requireIntro = false } = {}): string | null {
  const greeting = /^(?:(?:hi|hey|hello)\b[\s,!.]*)?/i;
  const intro = /^(?:i'?m|i’m|i am|im|my name is|my name's|my name’s|it'?s|it’s|this is|call me|name'?s|name is)\s+/i;
  const afterGreeting = text.trim().replace(greeting, "");
  if (requireIntro && !intro.test(afterGreeting)) return null;
  const stripped = afterGreeting.replace(intro, "").replace(/[\s.!]+$/, "").trim();
  if (!/^\p{L}[\p{L}'’-]*(?:\s\p{L}[\p{L}'’-]*){0,2}$/u.test(stripped)) return null;
  if (stripped.length > MAX_USER_NAME_LENGTH) return null;
  if (stripped.toLowerCase().split(/\s+/).some((w) => NOT_NAMES.has(w.replace(/['’]s$/, "")))) return null;
  // Capitalize names typed in all lowercase ("vinay" → "Vinay"); keep any other casing.
  return stripped === stripped.toLowerCase()
    ? stripped.replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    : stripped;
}

/**
 * Reads a birthday lookup: "When is Varun's bday?", "what's varun's birthday",
 * "Varun's bday?", "search Varun". "What…" needs the word birthday/bday, so
 * "what's up" isn't a lookup.
 */
function parseFind(text: string): string | null {
  const t = text.replace(/[?!.\s]+$/, "");
  const bday = String.raw`(?:birthday|bday|b-day|bd)`;
  const patterns = [
    new RegExp(String.raw`^(?:when(?:['’]s|\s+is|\s+was)?|search(?:\s+for)?|find|look\s*up)\s+(.+?)(?:\s+${bday})?$`, "i"),
    new RegExp(String.raw`^what(?:['’]s|\s+is)\s+(.+?)\s+${bday}$`, "i"),
    new RegExp(String.raw`^(.+?)\s+${bday}$`, "i"),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const name = m[1].replace(/['’]s?$/, "").replace(/^the\s+/i, "").trim();
    if (name && !/\d/.test(name) && !/^(?:happy|my|your)$/i.test(name)) return name;
  }
  return null;
}

function parseSmallTalk(lower: string): Command | null {
  const words = lower.replace(EMOJI, " ").replace(/[.,!?~'’]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.every((w) => SMALL_TALK_WORDS.includes(w))) return null;
  const thanks = THANKS_EMOJI.test(lower) || words.some((w) => THANKS_WORDS.includes(w));
  return { kind: thanks ? "thanks" : "ok" };
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
