import { birthdayDatesFor, daysUntil, localTime } from "./dates";
import { formatDate, parseMessage, parseName, type Command } from "./parse";
import type { Birthday, Store } from "./store";

export const HELP =
  "🎂 I'll text you on your friends' birthdays.\n\n" +
  "Add one: Varun 5/6\n" +
  "Add several: one per line\n" +
  "See all: list\n" +
  "Look one up: when is Varun's bday?\n" +
  "Remove: delete Varun";

export const INTRO =
  "Hi! 🎂 I'm a birthday bot: text me your friends' birthdays and I'll text you on the day.\n\n" +
  "First, what's your name?";

export const ASK_NAME_AGAIN = "I didn't catch your name. What should I call you? (Or text help to see what I can do.)";

const ASK_NAME_ALONGSIDE = "By the way, what's your name?";

export const welcome = (name: string) =>
  `Nice to meet you, ${name}! 🎂\n\n` +
  "Text me a friend's name and birthday, like: Varun 5/6. Text help anytime to see everything I can do.";

/** How often confirmations and reminders mention the person's name. */
const NAME_ODDS = 1 / 3;

const MAX_REPLY_LENGTH = 1500;

type Day = { year: number; month: number; day: number };

/**
 * Handles one incoming text and returns the reply to send back. `random` picks
 * when to use the person's name and `today` is the date in the bot's time zone;
 * tests pass fixed values.
 */
export async function handleText(
  store: Store,
  phone: string,
  body: string,
  random: () => number = Math.random,
  today: Day = localTime(new Date(), "UTC"),
): Promise<string> {
  const existing = await store.getUser(phone);
  if (!existing) await store.addUser(phone);
  const name = existing?.name ?? null;
  const cmd = parseMessage(body);

  if (cmd.kind === "rename") {
    await store.setUserName(phone, cmd.name);
    return name ? `Got it, I'll call you ${cmd.name}.` : welcome(cmd.name);
  }
  if (name) return respond(store, phone, cmd, name, random, today);

  // We don't know their name yet. A text that isn't a command or a birthday may
  // be their answer; birthdays and commands still work while we wait. On the
  // very first text, only an explicit "I'm …" counts, since we haven't asked yet.
  const nothingToDo = cmd.kind === "add" && cmd.entries.length === 0;
  const smallTalk = cmd.kind === "thanks" || cmd.kind === "ok";
  if (nothingToDo || smallTalk) {
    const answer = parseName(body, { requireIntro: !existing });
    if (answer) {
      await store.setUserName(phone, answer);
      return welcome(answer);
    }
  }
  if (!existing && (nothingToDo || smallTalk || cmd.kind === "help")) return INTRO;
  if (nothingToDo) return ASK_NAME_AGAIN;
  return `${await respond(store, phone, cmd, null, random, today)}\n\n${ASK_NAME_ALONGSIDE}`;
}

async function respond(
  store: Store,
  phone: string,
  cmd: Command,
  name: string | null,
  random: () => number,
  today: Day,
): Promise<string> {
  switch (cmd.kind) {
    case "help":
      return name ? `Hi ${name}! ${HELP}` : HELP;

    case "thanks":
      return name ? `Anytime, ${name}! 🎂` : "Anytime! 🎂";

    case "rename":
      return `Got it, I'll call you ${cmd.name}.`;

    case "ok":
      return "👍";

    case "list": {
      const all = await store.list(phone);
      if (all.length === 0) return "No birthdays saved yet. Text a name and date, like: Varun 5/6";
      const lines = all.map((b) => `${b.name} – ${formatDate(b.month, b.day)}`);
      return truncate(`Your birthdays (${all.length}):\n${lines.join("\n")}`);
    }

    case "find": {
      const all = await store.list(phone);
      const query = cmd.name.toLowerCase();
      // "varuns bday" means Varun, but James is James: try the name as typed first.
      let matches = findMatches(all, query);
      if (matches.length === 0 && query.length > 2 && query.endsWith("s")) {
        matches = findMatches(all, query.slice(0, -1));
      }
      if (matches.length === 0) {
        return `I don't have a birthday saved for ${cmd.name}. Text "list" to see them all, or add it like: ${cmd.name} 5/6`;
      }
      return truncate(matches.map((b) => describeBirthday(b, today)).join("\n"));
    }

    case "delete":
      return (await store.remove(phone, cmd.name))
        ? `Removed ${cmd.name}.`
        : `I don't have a birthday saved for ${cmd.name}. Text "list" to see them all.`;

    case "add": {
      for (const e of cmd.entries) await store.upsert({ phone, ...e });
      const parts: string[] = [];
      if (cmd.entries.length > 0) {
        const saved = cmd.entries.map((e) => `${e.name} (${formatDate(e.month, e.day)})`).join(", ");
        const greeting = name && random() < NAME_ODDS ? `Saved, ${name}!` : "Saved!";
        parts.push(`${greeting} I'll text you on: ${saved}.`);
      }
      if (cmd.unreadable.length > 0) {
        const quoted = cmd.unreadable.map((u) => `"${u}"`).join(", ");
        parts.push(
          `I couldn't read ${quoted}. To save a birthday, text a name and date, like: Varun 5/6\n\n` +
            `Text help to see everything I can do.`,
        );
      }
      return truncate(parts.join("\n\n"));
    }
  }
}

/** The reminders to send now: one message per person, grouped by phone. */
export async function dueReminders(
  store: Store,
  now: Date,
  timeZone: string,
  sendHour: number,
  random: () => number = Math.random,
): Promise<{ year: number; messages: Array<{ phone: string; text: string; birthdays: Birthday[] }> }> {
  const t = localTime(now, timeZone);
  // Runs before the send hour do nothing. Runs at or after it send whatever
  // hasn't gone out yet today, so a later run retries any failed sends.
  if (t.hour < sendHour) return { year: t.year, messages: [] };

  const due = await store.due(birthdayDatesFor(t.year, t.month, t.day), t.year);
  const byPhone = new Map<string, Birthday[]>();
  for (const b of due) byPhone.set(b.phone, [...(byPhone.get(b.phone) ?? []), b]);

  const messages = [];
  for (const [phone, birthdays] of byPhone) {
    const userName = (await store.getUser(phone))?.name;
    const text = reminderText(birthdays.map((b) => b.name));
    messages.push({
      phone,
      birthdays,
      text: userName && random() < NAME_ODDS ? `Hey ${userName}! ${text}` : text,
    });
  }
  return { year: t.year, messages };
}

/** Exact name matches if any; otherwise names with a word starting with the query. */
function findMatches(all: Birthday[], query: string): Birthday[] {
  const exact = all.filter((b) => b.name.toLowerCase() === query);
  if (exact.length > 0) return exact;
  return all.filter((b) => {
    const name = b.name.toLowerCase();
    return name.startsWith(query) || name.split(/\s+/).some((w) => w.startsWith(query));
  });
}

function describeBirthday(b: Birthday, today: Day): string {
  const date = formatDate(b.month, b.day);
  const days = daysUntil(b.month, b.day, today);
  if (days === 0) return `${b.name}'s birthday is today, ${date}! 🎂`;
  if (days === 1) return `${b.name}'s birthday is tomorrow, ${date}.`;
  return `${b.name}'s birthday is ${date}, in ${days} days.`;
}

export function reminderText(names: string[]): string {
  if (names.length === 1) return `It's ${names[0]}'s bday today 🎂`;
  const list = names.length === 2
    ? `${names[0]} and ${names[1]}`
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Birthdays today: ${list} 🎂`;
}

function truncate(s: string): string {
  return s.length <= MAX_REPLY_LENGTH ? s : s.slice(0, MAX_REPLY_LENGTH - 1) + "…";
}
