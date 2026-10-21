// Checks how typed reminders become a title, a date and a list. Run with npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { findList, NamedList } from "../src/list";
import { typingFrames } from "../src/typing";
import { Match, when } from "../src/when";

// Wednesday, October 21, 2026, 9:00 AM.
const now = new Date(2026, 9, 21, 9, 0);
const day = (offset: number, hours = 12, minutes = 0) =>
  new Date(2026, 9, 21 + offset, hours, minutes).getTime();

const lists: NamedList[] = [
  { id: "main", title: "Main", isDefault: true },
  { id: "cc", title: "Errands" },
  { id: "groceries", title: "🛒 Groceries" },
  { id: "trip", title: "Summer Road Trip" },
  { id: "work", title: "Work" },
  { id: "home", title: "Home" },
  { id: "today", title: "Today" },
  { id: "shopping", title: "Shopping List" },
  { id: "reading", title: "Reading" },
  { id: "reading-list", title: "Reading List" },
  { id: "packing", title: "Packing" },
  { id: "sam", title: "Sam's Stuff" },
  { id: "icloud-reminders", title: "Reminders" },
  { id: "exchange-reminders", title: "Reminders", isDefault: true },
];

// The same pipeline the extension runs: find the list, cut it out, then read the dates.
function read(text: string, matches: Match[] = []) {
  const list = findList(text, lists);
  const rest = list ? `${text.slice(0, list.start)} ${text.slice(list.end)}` : text;
  const result = when(
    rest,
    matches.filter((match) => rest.includes(match.matched)),
    now,
  );
  return { ...result, list: list?.id ?? null };
}

const at = (date: number | null) => (date === null ? null : new Date(date).toString());

test("a list named with on, to or in", () => {
  assert.deepEqual(read("remind me today 1700 on my Errands list get coffee", [{ matched: "today", date: day(0) }]), {
    title: "get coffee",
    date: day(0, 17),
    hasTime: true,
    list: "cc",
  });
  assert.equal(read("add eggs to my groceries list").list, "groceries");
  assert.equal(read("add eggs to my groceries list").title, "add eggs");
  assert.equal(read("book hotel in my Summer Road Trip list").list, "trip");
  assert.equal(read("book hotel in my Summer Road Trip list").title, "book hotel");
  assert.equal(read("put it on the Work list").list, "work");
  assert.equal(read("check items on the packing list").list, "packing");
});

test("a list that opens the text", () => {
  assert.deepEqual(read("Errands list check slides friday", [{ matched: "friday", date: day(2) }]), {
    title: "check slides",
    date: day(2),
    hasTime: false,
    list: "cc",
  });
  assert.equal(read("remind me work list send the deck").list, "work");
  assert.equal(read("remind me work list send the deck").title, "send the deck");
});

test("ordinary words never pick a list", () => {
  for (const text of [
    "work on the deck tomorrow",
    "remind me to work out",
    "head to work",
    "drive to home depot",
    "finish the report for work",
    "make a grocery list",
    "update the packing list",
    "send the packing list to mom",
    "get milk to groceries",
    "call mom today",
  ]) {
    assert.equal(read(text).list, null, text);
  }
});

test("names match whatever the case, spacing or symbols", () => {
  assert.equal(read("on my Errands list call Alex").list, "cc");
  assert.equal(read("on my Errands list call Alex").list, "cc");
  assert.equal(read("to my groceries list: eggs").list, "groceries");
  assert.equal(read("to my groceries list: eggs").title, "eggs");
  assert.equal(read("on my sams stuff list return the drill").list, "sam");
  assert.equal(read("on my sam's stuff list, return the drill").title, "return the drill");
  assert.equal(read("pay rent on my work list.").title, "pay rent");
});

test("a list whose own name ends in list", () => {
  assert.equal(read("add batteries to my shopping list").list, "shopping");
  assert.equal(read("add batteries to my shopping list").title, "add batteries");
  assert.equal(read("shopping list batteries").list, "shopping");
});

test("the longest name wins", () => {
  assert.equal(read("add Dune to my reading list").list, "reading-list");
});

test("lists that share a name use the default one", () => {
  assert.equal(read("on my reminders list call Sam").list, "exchange-reminders");
});

test("a date inside a list's name isn't a date", () => {
  const result = read("on my Today list call mom", [{ matched: "Today", date: day(0) }]);
  assert.equal(result.list, "today");
  assert.equal(result.date, null);
  assert.equal(result.title, "call mom");
  const both = read("on my Today list call mom today", [
    { matched: "Today", date: day(0) },
    { matched: "today", date: day(0) },
  ]);
  assert.equal(at(both.date), at(day(0)));
});

test("24-hour times", () => {
  assert.equal(read("remind me today get cofee at 1700", [{ matched: "today", date: day(0) }]).title, "get cofee");
  assert.equal(at(read("remind me today 1700 get coffee", [{ matched: "today", date: day(0) }]).date), at(day(0, 17)));
  assert.equal(at(read("1700 today get coffee", [{ matched: "today", date: day(0) }]).date), at(day(0, 17)));
  assert.equal(at(read("get coffee tomorrow, 0930", [{ matched: "tomorrow", date: day(1) }]).date), at(day(1, 9, 30)));
  assert.equal(at(read("standup 0930 hrs").date), at(day(0, 9, 30)));
  assert.equal(at(read("get coffee at 17:00 tomorrow", [{ matched: "17:00 tomorrow", date: day(1, 17) }]).date), at(day(1, 17)));
  assert.equal(at(read("get coffee at 1700", [{ matched: "1700", date: new Date(1700, 0, 1).getTime() }]).date), at(day(0, 17)));
});

test("numbers that aren't times stay in the title", () => {
  const room = read("check in at room 1205 friday", [{ matched: "friday", date: day(2) }]);
  assert.equal(room.title, "check in at room 1205");
  assert.equal(room.hasTime, false);
  assert.equal(read("pay 1500 to landlord friday", [{ matched: "friday", date: day(2) }]).title, "pay 1500 to landlord");
});

test("a day and a time apart in the sentence", () => {
  const result = read("today get coffee at 5pm", [
    { matched: "today", date: day(0) },
    { matched: "at 5pm", date: day(0, 17) },
  ]);
  assert.equal(result.title, "get coffee");
  assert.equal(at(result.date), at(day(0, 17)));
});

test("a day without a time is all-day", () => {
  const result = read("submit expense report next tuesday", [{ matched: "next tuesday", date: day(6) }]);
  assert.equal(result.title, "submit expense report");
  assert.equal(result.hasTime, false);
});

test("lead-ins and leftovers leave the title", () => {
  assert.equal(read("remind me to call mom tomorrow at noon", [{ matched: "tomorrow at noon", date: day(1) }]).title, "call mom");
  assert.equal(read("please remind me to call mom").title, "call mom");
  assert.equal(read("remind me: call mom").title, "call mom");
  assert.equal(read("pick up dry cleaning friday at 5", [{ matched: "friday at 5", date: day(2, 17) }]).title, "pick up dry cleaning");
});

test("text that is only a date keeps it as the title", () => {
  assert.equal(read("tomorrow", [{ matched: "tomorrow", date: day(1) }]).title, "tomorrow");
});

test("typing keeps what the titles share and types the rest", () => {
  assert.deepEqual(typingFrames("Get coffee", "Get coffee"), []);
  assert.deepEqual(typingFrames("get coffee", "Get coffee"), ["Get coffee"]);
  const frames = typingFrames("get cofee", "Get coffee");
  assert.equal(frames[0].startsWith("Get cof"), true);
  assert.equal(frames.at(-1), "Get coffee");
  assert.ok(typingFrames("x", "Review slides after meeting").length <= 8);
  assert.equal(typingFrames("long old title", "Short").at(-1), "Short");
});
