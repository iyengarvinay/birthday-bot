import { describe, expect, it } from "vitest";
import { ASK_NAME_AGAIN, dueReminders, handleText, HELP, INTRO, reminderText, welcome } from "../src/bot";
import { birthdayDatesFor, daysUntil, localTime } from "../src/dates";
import { D1Store } from "../src/store";
import { sqliteD1 } from "./sqlite-d1";

const ME = "+15555550100";
const FRIEND = "+15555550199";
const NY = "America/New_York";

/** Never mention the person's name in confirmations or reminders. */
const NEVER = () => 1;
/** Always mention it. */
const ALWAYS = () => 0;

/** A store where both test users have already told the bot their names. */
async function newStore() {
  const store = new D1Store(sqliteD1());
  await store.setUserName(ME, "Vinay");
  await store.setUserName(FRIEND, "Alex");
  return store;
}

const say = (store: D1Store, phone: string, body: string) => handleText(store, phone, body, NEVER);

describe("handleText", () => {
  it("saves birthdays and lists them in calendar order", async () => {
    const store = await newStore();
    expect(await say(store, ME, "Varun 5/6\nPriya 1/12")).toBe(
      "Saved! I'll text you on: Varun (May 6), Priya (January 12).",
    );
    expect(await say(store, ME, "list")).toBe(
      "Your birthdays (2):\nPriya – January 12\nVarun – May 6",
    );
  });

  it("keeps each person's list separate", async () => {
    const store = await newStore();
    await say(store, ME, "Varun 5/6");
    expect(await say(store, FRIEND, "list")).toMatch(/^No birthdays saved yet/);
  });

  it("updates a birthday when the same name is sent again, ignoring case", async () => {
    const store = await newStore();
    await say(store, ME, "Varun 5/6");
    await say(store, ME, "varun 5/7");
    expect(await say(store, ME, "list")).toBe("Your birthdays (1):\nvarun – May 7");
  });

  it("deletes by name, ignoring case", async () => {
    const store = await newStore();
    await say(store, ME, "Varun 5/6");
    expect(await say(store, ME, "delete VARUN")).toBe("Removed VARUN.");
    expect(await say(store, ME, "delete Varun")).toMatch(/^I don't have a birthday saved for Varun/);
  });

  it("explains what it couldn't read and points to help", async () => {
    expect(await say(await newStore(), ME, "what is this")).toBe(
      `I couldn't read "what is this". To save a birthday, text a name and date, like: Varun 5/6\n\n` +
        `Text help to see everything I can do.`,
    );
  });

  it("answers thanks and acknowledgments without saving anything", async () => {
    const store = await newStore();
    expect(await say(store, ME, "Thanks!")).toBe("Anytime, Vinay! 🎂");
    expect(await say(store, ME, "ok")).toBe("👍");
    expect(await say(store, ME, "list")).toMatch(/^No birthdays saved yet/);
  });

  it("answers help", async () => {
    expect(await say(await newStore(), ME, "help")).toBe(`Hi Vinay! ${HELP}`);
  });
});

describe("reminderText", () => {
  it("matches the requested wording for one birthday", () => {
    expect(reminderText(["Varun"])).toBe("It's Varun's bday today 🎂");
  });
  it("combines several birthdays into one text", () => {
    expect(reminderText(["Varun", "Priya"])).toBe("Birthdays today: Varun and Priya 🎂");
    expect(reminderText(["A", "B", "C"])).toBe("Birthdays today: A, B and C 🎂");
  });
});

describe("dueReminders", () => {
  // 13:00 UTC on May 6 is 9am in New York (daylight time).
  const may6At9 = new Date("2027-05-06T13:00:00Z");

  it("sends one text per person on the day, and nothing before the send hour", async () => {
    const store = await newStore();
    await say(store, ME, "Varun 5/6\nPriya 5/6\nSam 5/7");
    await say(store, FRIEND, "Varun 5/6");

    const early = await dueReminders(store, new Date("2027-05-06T12:00:00Z"), NY, 9, NEVER);
    expect(early.messages).toEqual([]);

    const { messages } = await dueReminders(store, may6At9, NY, 9, NEVER);
    expect(messages.map((m) => [m.phone, m.text])).toEqual([
      [ME, "Birthdays today: Priya and Varun 🎂"],
      [FRIEND, "It's Varun's bday today 🎂"],
    ]);
  });

  it("does not send the same reminder twice in a year, but does the next year", async () => {
    const store = await newStore();
    await say(store, ME, "Varun 5/6");

    const first = await dueReminders(store, may6At9, NY, 9, NEVER);
    for (const m of first.messages) for (const b of m.birthdays) await store.markSent(b, first.year);

    const laterSameDay = await dueReminders(store, new Date("2027-05-06T15:00:00Z"), NY, 9, NEVER);
    expect(laterSameDay.messages).toEqual([]);

    const nextYear = await dueReminders(store, new Date("2028-05-06T13:00:00Z"), NY, 9, NEVER);
    expect(nextYear.messages.map((m) => m.text)).toEqual(["It's Varun's bday today 🎂"]);
  });

  it("retries on a later run if a send failed (left unmarked)", async () => {
    const store = await newStore();
    await say(store, ME, "Varun 5/6");
    await dueReminders(store, may6At9, NY, 9, NEVER); // pretend the send failed: not marked
    const retry = await dueReminders(store, new Date("2027-05-06T14:00:00Z"), NY, 9, NEVER);
    expect(retry.messages).toHaveLength(1);
  });

  it("re-arms a birthday whose date is changed after its reminder went out", async () => {
    const store = await newStore();
    await say(store, ME, "Varun 5/6");
    const sent = await dueReminders(store, may6At9, NY, 9, NEVER);
    for (const m of sent.messages) for (const b of m.birthdays) await store.markSent(b, sent.year);

    await say(store, ME, "Varun 5/20");
    const may20 = await dueReminders(store, new Date("2027-05-20T13:00:00Z"), NY, 9, NEVER);
    expect(may20.messages.map((m) => m.text)).toEqual(["It's Varun's bday today 🎂"]);
  });

  it("uses the local date, not UTC, near midnight", async () => {
    const store = await newStore();
    await say(store, ME, "Varun 5/6");
    // 03:00 UTC on May 7 is still 11pm on May 6 in New York.
    const { messages } = await dueReminders(store, new Date("2027-05-07T03:00:00Z"), NY, 9, NEVER);
    expect(messages).toHaveLength(1);
  });

  it("sends at 9am in winter too (14:00 UTC under standard time)", async () => {
    const store = await newStore();
    await say(store, ME, "Varun 12/25");
    expect((await dueReminders(store, new Date("2027-12-25T13:00:00Z"), NY, 9, NEVER)).messages).toEqual([]);
    expect((await dueReminders(store, new Date("2027-12-25T14:00:00Z"), NY, 9, NEVER)).messages).toHaveLength(1);
  });

  it("celebrates Feb 29 birthdays on Feb 28 in non-leap years", async () => {
    const store = await newStore();
    await say(store, ME, "Leap 2/29");
    expect((await dueReminders(store, new Date("2027-02-28T14:00:00Z"), NY, 9, NEVER)).messages).toHaveLength(1);
    expect((await dueReminders(store, new Date("2028-02-28T14:00:00Z"), NY, 9, NEVER)).messages).toEqual([]);
    expect((await dueReminders(store, new Date("2028-02-29T14:00:00Z"), NY, 9, NEVER)).messages).toHaveLength(1);
  });
});

describe("dates", () => {
  it("reads the local hour across daylight saving", () => {
    expect(localTime(new Date("2027-07-01T13:00:00Z"), NY).hour).toBe(9);
    expect(localTime(new Date("2027-01-01T14:00:00Z"), NY).hour).toBe(9);
  });
  it("adds Feb 29 to Feb 28 only in non-leap years", () => {
    expect(birthdayDatesFor(2027, 2, 28)).toEqual([[2, 28], [2, 29]]);
    expect(birthdayDatesFor(2028, 2, 28)).toEqual([[2, 28]]);
    expect(birthdayDatesFor(2100, 2, 28)).toEqual([[2, 28], [2, 29]]);
  });
});

describe("names", () => {
  const NEW = "+15555550123";
  const fresh = () => new D1Store(sqliteD1());

  it("introduces itself and asks a first-time texter's name, then remembers it", async () => {
    const store = fresh();
    expect(await say(store, NEW, "hi")).toBe(INTRO);
    expect(await say(store, NEW, "vinay")).toBe(welcome("Vinay"));
    expect(await say(store, NEW, "thanks")).toBe("Anytime, Vinay! 🎂");
    expect(await say(store, NEW, "help")).toBe(`Hi Vinay! ${HELP}`);
  });

  it.each([
    ["Vinay", "Vinay"],
    ["I'm Vinay", "Vinay"],
    ["im vinay", "Vinay"],
    ["My name is Mary Jane", "Mary Jane"],
    ["hey, it's Sam!", "Sam"],
    ["Will", "Will"],
    ["o'brien", "O'Brien"],
    ["DJ", "DJ"],
  ])("reads %s as the name %s", async (reply, name) => {
    const store = fresh();
    await say(store, NEW, "hi");
    expect(await say(store, NEW, reply)).toBe(welcome(name));
    expect((await store.getUser(NEW))?.name).toBe(name);
  });

  it.each(["hey what's up", "not now", "lol", "123", "who is this", "list"])(
    "does not take %s as a name",
    async (reply) => {
      const store = fresh();
      await say(store, NEW, "hi");
      await say(store, NEW, reply);
      expect((await store.getUser(NEW))?.name).toBeNull();
    },
  );

  it("asks again when the answer doesn't look like a name", async () => {
    const store = fresh();
    await say(store, NEW, "hi");
    expect(await say(store, NEW, "who is this")).toBe(ASK_NAME_AGAIN);
  });

  it("saves a birthday sent as the very first text, and asks the name alongside", async () => {
    const store = fresh();
    expect(await say(store, NEW, "Varun 5/6")).toBe(
      "Saved! I'll text you on: Varun (May 6).\n\nBy the way, what's your name?",
    );
    expect(await say(store, NEW, "Vinay")).toBe(welcome("Vinay"));
    expect(await say(store, NEW, "list")).toBe("Your birthdays (1):\nVarun – May 6");
  });

  it("accepts an explicit introduction as the very first text", async () => {
    expect(await say(fresh(), NEW, "Hi, I'm Vinay")).toBe(welcome("Vinay"));
  });

  it("does not treat a bare word as a name on the very first text", async () => {
    const store = fresh();
    expect(await say(store, NEW, "Vinay")).toBe(INTRO);
    expect((await store.getUser(NEW))?.name).toBeNull();
  });

  it("lets people change their name later", async () => {
    const store = await newStore();
    expect(await say(store, ME, "call me V")).toBe("Got it, I'll call you V.");
    expect(await say(store, ME, "thanks")).toBe("Anytime, V! 🎂");
  });

  it("only sometimes uses the name on confirmations and reminders", async () => {
    const store = await newStore();
    expect(await handleText(store, ME, "Varun 5/6", ALWAYS)).toBe("Saved, Vinay! I'll text you on: Varun (May 6).");
    expect(await handleText(store, ME, "Priya 5/6", NEVER)).toBe("Saved! I'll text you on: Priya (May 6).");

    const at9 = new Date("2027-05-06T13:00:00Z");
    expect((await dueReminders(store, at9, NY, 9, ALWAYS)).messages[0]!.text).toBe(
      "Hey Vinay! Birthdays today: Priya and Varun 🎂",
    );
    expect((await dueReminders(store, at9, NY, 9, NEVER)).messages[0]!.text).toBe("Birthdays today: Priya and Varun 🎂");
  });

  it("never personalizes reminders for someone who hasn't given a name", async () => {
    const store = fresh();
    await say(store, NEW, "Varun 5/6");
    const { messages } = await dueReminders(store, new Date("2027-05-06T13:00:00Z"), NY, 9, ALWAYS);
    expect(messages[0]!.text).toBe("It's Varun's bday today 🎂");
  });
});

describe("looking up a birthday", () => {
  // October 13, 2027
  const today = { year: 2027, month: 10, day: 13 };
  const ask = (store: D1Store, body: string) => handleText(store, ME, body, NEVER, today);

  async function storeWithBirthdays() {
    const store = await newStore();
    await say(store, ME, "Varun 5/6\nPriya 10/13\nSam 10/14\nVarun Mehta 1/2");
    return store;
  }

  it.each([
    "When is Varun's bday?",
    "when's varun's birthday",
    "when is varun",
    "What's Varun's birthday?",
    "what is varuns bday",
    "Varun's bday?",
    "varun birthday",
    "search Varun",
    "find varun",
  ])("answers %s", async (q) => {
    expect(await ask(await storeWithBirthdays(), q)).toBe("Varun's birthday is May 6, in 206 days.");
  });

  it("says today and tomorrow", async () => {
    const store = await storeWithBirthdays();
    expect(await ask(store, "when is Priya's bday")).toBe("Priya's birthday is today, October 13! 🎂");
    expect(await ask(store, "when is Sam's bday")).toBe("Sam's birthday is tomorrow, October 14.");
  });

  it("lists every partial match when there's no exact one", async () => {
    const store = await newStore();
    await say(store, ME, "Varun Mehta 1/2\nVarun S 3/4");
    expect(await ask(store, "when is varun's bday")).toBe(
      "Varun Mehta's birthday is January 2, in 81 days.\nVarun S's birthday is March 4, in 143 days.",
    );
  });

  it("keeps a name that really ends in s", async () => {
    const store = await newStore();
    await say(store, ME, "James 7/4");
    expect(await ask(store, "when is james bday")).toBe("James's birthday is July 4, in 265 days.");
  });

  it("says when it has no match", async () => {
    expect(await ask(await storeWithBirthdays(), "when is Zoe's bday?")).toBe(
      `I don't have a birthday saved for Zoe. Text "list" to see them all, or add it like: Zoe 5/6`,
    );
  });

  it("only searches the asker's own list", async () => {
    const store = await storeWithBirthdays();
    expect(await handleText(store, FRIEND, "when is varun's bday", NEVER, today)).toMatch(/^I don't have a birthday saved for varun/);
  });

  it("doesn't mistake small talk or birthdays for a lookup", async () => {
    const store = await newStore();
    expect(await ask(store, "what's up")).toMatch(/^I couldn't read/);
    expect(await ask(store, "happy bday!")).toMatch(/^I couldn't read/);
    expect(await ask(store, "Varun's birthday 5/6")).toBe("Saved! I'll text you on: Varun (May 6).");
  });
});

describe("daysUntil", () => {
  it("counts to this year's date, or next year's once it has passed", () => {
    expect(daysUntil(10, 13, { year: 2027, month: 10, day: 13 })).toBe(0);
    expect(daysUntil(12, 31, { year: 2027, month: 12, day: 30 })).toBe(1);
    expect(daysUntil(1, 1, { year: 2027, month: 12, day: 31 })).toBe(1);
    expect(daysUntil(10, 12, { year: 2027, month: 10, day: 13 })).toBe(365);
  });
  it("counts Feb 29 birthdays to Feb 28 in non-leap years", () => {
    expect(daysUntil(2, 29, { year: 2027, month: 2, day: 28 })).toBe(0);
    expect(daysUntil(2, 29, { year: 2028, month: 2, day: 28 })).toBe(1);
  });
});
