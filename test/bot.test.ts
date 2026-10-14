import { describe, expect, it } from "vitest";
import { dueReminders, handleText, HELP, reminderText } from "../src/bot";
import { birthdayDatesFor, localTime } from "../src/dates";
import { D1Store } from "../src/store";
import { sqliteD1 } from "./sqlite-d1";

const ME = "+15555550100";
const FRIEND = "+15555550199";
const NY = "America/New_York";

const newStore = () => new D1Store(sqliteD1());

describe("handleText", () => {
  it("saves birthdays and lists them in calendar order", async () => {
    const store = newStore();
    expect(await handleText(store, ME, "Varun 5/6\nPriya 1/12")).toBe(
      "Saved! I'll text you on: Varun (May 6), Priya (January 12).",
    );
    expect(await handleText(store, ME, "list")).toBe(
      "Your birthdays (2):\nPriya – January 12\nVarun – May 6",
    );
  });

  it("keeps each person's list separate", async () => {
    const store = newStore();
    await handleText(store, ME, "Varun 5/6");
    expect(await handleText(store, FRIEND, "list")).toMatch(/^No birthdays saved yet/);
  });

  it("updates a birthday when the same name is sent again, ignoring case", async () => {
    const store = newStore();
    await handleText(store, ME, "Varun 5/6");
    await handleText(store, ME, "varun 5/7");
    expect(await handleText(store, ME, "list")).toBe("Your birthdays (1):\nvarun – May 7");
  });

  it("deletes by name, ignoring case", async () => {
    const store = newStore();
    await handleText(store, ME, "Varun 5/6");
    expect(await handleText(store, ME, "delete VARUN")).toBe("Removed VARUN.");
    expect(await handleText(store, ME, "delete Varun")).toMatch(/^I don't have a birthday saved for Varun/);
  });

  it("explains what it couldn't read and points to help", async () => {
    expect(await handleText(newStore(), ME, "what is this")).toBe(
      `I couldn't read "what is this". To save a birthday, text a name and date, like: Varun 5/6\n\n` +
        `Text help to see everything I can do.`,
    );
  });

  it("answers thanks and acknowledgments without saving anything", async () => {
    const store = newStore();
    expect(await handleText(store, ME, "Thanks!")).toBe("Anytime! 🎂");
    expect(await handleText(store, ME, "ok")).toBe("👍");
    expect(await handleText(store, ME, "list")).toMatch(/^No birthdays saved yet/);
  });

  it("answers help", async () => {
    expect(await handleText(newStore(), ME, "help")).toBe(HELP);
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
    const store = newStore();
    await handleText(store, ME, "Varun 5/6\nPriya 5/6\nSam 5/7");
    await handleText(store, FRIEND, "Varun 5/6");

    const early = await dueReminders(store, new Date("2027-05-06T12:00:00Z"), NY, 9);
    expect(early.messages).toEqual([]);

    const { messages } = await dueReminders(store, may6At9, NY, 9);
    expect(messages.map((m) => [m.phone, m.text])).toEqual([
      [ME, "Birthdays today: Priya and Varun 🎂"],
      [FRIEND, "It's Varun's bday today 🎂"],
    ]);
  });

  it("does not send the same reminder twice in a year, but does the next year", async () => {
    const store = newStore();
    await handleText(store, ME, "Varun 5/6");

    const first = await dueReminders(store, may6At9, NY, 9);
    for (const m of first.messages) for (const b of m.birthdays) await store.markSent(b, first.year);

    const laterSameDay = await dueReminders(store, new Date("2027-05-06T15:00:00Z"), NY, 9);
    expect(laterSameDay.messages).toEqual([]);

    const nextYear = await dueReminders(store, new Date("2028-05-06T13:00:00Z"), NY, 9);
    expect(nextYear.messages.map((m) => m.text)).toEqual(["It's Varun's bday today 🎂"]);
  });

  it("retries on a later run if a send failed (left unmarked)", async () => {
    const store = newStore();
    await handleText(store, ME, "Varun 5/6");
    await dueReminders(store, may6At9, NY, 9); // pretend the send failed: not marked
    const retry = await dueReminders(store, new Date("2027-05-06T14:00:00Z"), NY, 9);
    expect(retry.messages).toHaveLength(1);
  });

  it("re-arms a birthday whose date is changed after its reminder went out", async () => {
    const store = newStore();
    await handleText(store, ME, "Varun 5/6");
    const sent = await dueReminders(store, may6At9, NY, 9);
    for (const m of sent.messages) for (const b of m.birthdays) await store.markSent(b, sent.year);

    await handleText(store, ME, "Varun 5/20");
    const may20 = await dueReminders(store, new Date("2027-05-20T13:00:00Z"), NY, 9);
    expect(may20.messages.map((m) => m.text)).toEqual(["It's Varun's bday today 🎂"]);
  });

  it("uses the local date, not UTC, near midnight", async () => {
    const store = newStore();
    await handleText(store, ME, "Varun 5/6");
    // 03:00 UTC on May 7 is still 11pm on May 6 in New York.
    const { messages } = await dueReminders(store, new Date("2027-05-07T03:00:00Z"), NY, 9);
    expect(messages).toHaveLength(1);
  });

  it("sends at 9am in winter too (14:00 UTC under standard time)", async () => {
    const store = newStore();
    await handleText(store, ME, "Varun 12/25");
    expect((await dueReminders(store, new Date("2027-12-25T13:00:00Z"), NY, 9)).messages).toEqual([]);
    expect((await dueReminders(store, new Date("2027-12-25T14:00:00Z"), NY, 9)).messages).toHaveLength(1);
  });

  it("celebrates Feb 29 birthdays on Feb 28 in non-leap years", async () => {
    const store = newStore();
    await handleText(store, ME, "Leap 2/29");
    expect((await dueReminders(store, new Date("2027-02-28T14:00:00Z"), NY, 9)).messages).toHaveLength(1);
    expect((await dueReminders(store, new Date("2028-02-28T14:00:00Z"), NY, 9)).messages).toEqual([]);
    expect((await dueReminders(store, new Date("2028-02-29T14:00:00Z"), NY, 9)).messages).toHaveLength(1);
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
