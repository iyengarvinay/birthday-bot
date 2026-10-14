import { describe, expect, it } from "vitest";
import { parseEntry, parseMessage } from "../src/parse";

describe("parseEntry", () => {
  it.each([
    ["Varun 5/6", "Varun", 5, 6],
    ["Varun: 5/6", "Varun", 5, 6],
    ["Varun - 05-06", "Varun", 5, 6],
    ["Varun 5.6.1990", "Varun", 5, 6],
    ["Varun 5/6/90", "Varun", 5, 6],
    ["5/6 Varun", "Varun", 5, 6],
    ["Varun May 6", "Varun", 5, 6],
    ["Varun may 6th", "Varun", 5, 6],
    ["Varun September 21st, 1990", "Varun", 9, 21],
    ["Varun Sept 21", "Varun", 9, 21],
    ["May 6 Varun", "Varun", 5, 6],
    ["Mary Jane Watson 12/25", "Mary Jane Watson", 12, 25],
    ["Varun's birthday 5/6", "Varun", 5, 6],
    ["Leap Baby 2/29", "Leap Baby", 2, 29],
  ])("%s", (text, name, month, day) => {
    expect(parseEntry(text)).toEqual({ name, month, day });
  });

  it.each(["Varun", "5/6", "Varun 13/1", "Varun 4/31", "Varun 2/30", "Varun Mayday 6", "Varun Ma 6"])(
    "rejects %s",
    (text) => expect(parseEntry(text)).toBeNull(),
  );

  it("treats a name that starts like a month as a name", () => {
    expect(parseEntry("Mayra 7/1")).toEqual({ name: "Mayra", month: 7, day: 1 });
  });
});

describe("parseMessage", () => {
  it("recognizes commands regardless of case and spacing", () => {
    expect(parseMessage(" HELP ")).toEqual({ kind: "help" });
    expect(parseMessage("")).toEqual({ kind: "help" });
    expect(parseMessage("List")).toEqual({ kind: "list" });
    expect(parseMessage("delete Varun")).toEqual({ kind: "delete", name: "Varun" });
    expect(parseMessage("Remove  Mary Jane")).toEqual({ kind: "delete", name: "Mary Jane" });
  });

  it("reads several birthdays separated by newlines, commas or semicolons", () => {
    expect(parseMessage("Varun 5/6\nPriya 7/12, Sam 1/2; Ana 3/4")).toEqual({
      kind: "add",
      entries: [
        { name: "Varun", month: 5, day: 6 },
        { name: "Priya", month: 7, day: 12 },
        { name: "Sam", month: 1, day: 2 },
        { name: "Ana", month: 3, day: 4 },
      ],
      unreadable: [],
    });
  });

  it("keeps a comma before a year inside the date", () => {
    expect(parseMessage("Varun May 6, 1990")).toEqual({
      kind: "add",
      entries: [{ name: "Varun", month: 5, day: 6 }],
      unreadable: [],
    });
  });

  it("reports lines it can't read and still saves the rest", () => {
    expect(parseMessage("Varun 5/6\nsomething else")).toEqual({
      kind: "add",
      entries: [{ name: "Varun", month: 5, day: 6 }],
      unreadable: ["something else"],
    });
  });
});
