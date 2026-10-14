import { birthdayDatesFor, localTime } from "./dates";
import { formatDate, parseMessage } from "./parse";
import type { Birthday, Store } from "./store";

export const HELP =
  "🎂 I'll text you on your friends' birthdays.\n\n" +
  "Add one: Varun 5/6\n" +
  "Add several: one per line\n" +
  "See all: list\n" +
  "Remove: delete Varun";

const MAX_REPLY_LENGTH = 1500;

/** Handles one incoming text and returns the reply to send back. */
export async function handleText(store: Store, phone: string, body: string): Promise<string> {
  const cmd = parseMessage(body);

  switch (cmd.kind) {
    case "help":
      return HELP;

    case "thanks":
      return "Anytime! 🎂";

    case "ok":
      return "👍";

    case "list": {
      const all = await store.list(phone);
      if (all.length === 0) return "No birthdays saved yet. Text a name and date, like: Varun 5/6";
      const lines = all.map((b) => `${b.name} – ${formatDate(b.month, b.day)}`);
      return truncate(`Your birthdays (${all.length}):\n${lines.join("\n")}`);
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
        parts.push(`Saved! I'll text you on: ${saved}.`);
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
): Promise<{ year: number; messages: Array<{ phone: string; text: string; birthdays: Birthday[] }> }> {
  const t = localTime(now, timeZone);
  // Runs before the send hour do nothing. Runs at or after it send whatever
  // hasn't gone out yet today, so a later run retries any failed sends.
  if (t.hour < sendHour) return { year: t.year, messages: [] };

  const due = await store.due(birthdayDatesFor(t.year, t.month, t.day), t.year);
  const byPhone = new Map<string, Birthday[]>();
  for (const b of due) byPhone.set(b.phone, [...(byPhone.get(b.phone) ?? []), b]);

  const messages = [...byPhone].map(([phone, birthdays]) => ({
    phone,
    birthdays,
    text: reminderText(birthdays.map((b) => b.name)),
  }));
  return { year: t.year, messages };
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
