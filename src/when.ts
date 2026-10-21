// Turns what you type, plus the date detector's matches, into a title and a due date.

export interface Match {
  date: number;
  matched: string;
}

export interface When {
  title: string;
  date: number | null;
  hasTime: boolean;
}

// The date detector always returns a time, so a time counts only when the words name one.
const namedTime = /\d\s*(?:am|pm|a\.m\.|p\.m\.)|\d:\d{2}|\bat\s+\d|\b(?:noon|midnight|morning|afternoon|evening|tonight)\b/i;

// 24-hour times the date detector doesn't read reliably: "at 1700", "0930 hrs", "17:00".
// A bare four-digit number needs "at" or "hrs" around it, so "room 1205" stays in the title.
const fourDigitTime = /\b(?:at|by|before|around)\s+([01]\d|2[0-3])([0-5]\d)\b(?:\s*(?:hrs|hours)\b)?|\b([01]\d|2[0-3])([0-5]\d)\s*(?:hrs|hours)\b/i;
const colonTime = /(?:\b(?:at|by|before|around)\s+)?\b(1[3-9]|2[0-3]|0\d):([0-5]\d)\b/i;

const leftoverWords = "on|at|by|for|in|due|before|around|this|next";
const leading = new RegExp(`^(?:(?:please\\s+)?remind me(?:\\s+to)?[\\s,:]+|(?:${leftoverWords})\\s+)+`, "i");
const edges = /^[\s,;:\-–—]+|[\s,;:\-–—]+$/g;
const trailing = new RegExp(`(?:\\s+(?:${leftoverWords}))+$`, "i");

function within(inner: [number, number], outer: [number, number]): boolean {
  return inner[0] >= outer[0] && inner[1] <= outer[1];
}

interface Clock {
  hours: number;
  minutes: number;
  text: string;
}

const bareFourDigit = "([01]\\d|2[0-3])([0-5]\\d)";
const afterDay = new RegExp(`^[\\s,]+${bareFourDigit}\\b`);
// Before the day only when nothing else comes first, so "room 1205 friday" stays a room.
const beforeDay = new RegExp(`^(?:(?:please\\s+)?remind me(?:\\s+to)?\\s+)?${bareFourDigit}[\\s,]+$`, "i");
const insideDay = new RegExp(`\\b${bareFourDigit}\\b`);

function clock(found: RegExpMatchArray, text = found[0]): Clock {
  const [hours, minutes] = found.slice(1).filter((part) => part !== undefined).map(Number);
  return { hours, minutes, text };
}

// A bare four-digit time right after a day ("today 1700"), or opening the text ("0930 tomorrow").
function clockBesideDay(text: string, matches: Match[]): Clock | null {
  for (const match of matches) {
    const start = text.indexOf(match.matched);
    if (start < 0) continue;
    const end = start + match.matched.length;
    const after = text.slice(end).match(afterDay);
    if (after) return clock(after);
    const before = text.slice(0, start).match(beforeDay);
    if (before) return clock(before, before[0].replace(/^.*?(?=\d)/s, ""));
    const inside = match.matched.match(insideDay);
    if (inside && inside[0] !== match.matched.trim()) return clock(inside);
  }
  return null;
}

export function when(text: string, matches: Match[], now = new Date()): When {
  const own = text.match(fourDigitTime) ?? text.match(colonTime);
  const ownRange: [number, number] | null = own ? [own.index ?? 0, (own.index ?? 0) + own[0].length] : null;

  // A detector match that's only the 24-hour time reads it wrong (as a year, say), so it's dropped,
  // and so is any match dated more than a year back. One that reaches past the time ("17:00
  // tomorrow") still gives the day, and the 24-hour time wins.
  const usable = matches.filter((match) => {
    if (new Date(match.date).getFullYear() < now.getFullYear() - 1) return false;
    const start = text.indexOf(match.matched);
    return !ownRange || start < 0 || !within([start, start + match.matched.length], ownRange);
  });
  const time = own ? clock(own) : clockBesideDay(text, matches);
  const timed = usable.find((match) => namedTime.test(match.matched));
  const day = usable.find((match) => match !== timed) ?? timed;

  let date: Date | null = day ? new Date(day.date) : null;
  if (date && timed && timed !== day) {
    const named = new Date(timed.date);
    date.setHours(named.getHours(), named.getMinutes(), 0, 0);
  }
  if (time) {
    date ??= new Date(now);
    date.setHours(time.hours, time.minutes, 0, 0);
  }

  // Every match leaves the title, used or not, along with the time.
  let rest = text;
  for (const part of [...matches.map((match) => match.matched), ...(time ? [time.text] : [])]) {
    rest = rest.replace(part, " ");
  }
  rest = rest
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/([,;:])(?=[,;:.!?])/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const title = rest.replace(edges, "").replace(leading, "").replace(trailing, "").replace(edges, "") || text.trim();

  return { title, date: date ? date.getTime() : null, hasTime: Boolean(time || timed) };
}
