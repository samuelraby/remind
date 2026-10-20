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
const leading = new RegExp(`^(?:(?:please\\s+)?remind me(?:\\s+to)?\\s+|(?:${leftoverWords})\\s+)+`, "i");
const trailing = new RegExp(`(?:\\s+(?:${leftoverWords}))+$`, "i");

function within(inner: [number, number], outer: [number, number]): boolean {
  return inner[0] >= outer[0] && inner[1] <= outer[1];
}

export function when(text: string, matches: Match[]): When {
  const own = text.match(fourDigitTime) ?? text.match(colonTime);
  const ownRange: [number, number] | null = own ? [own.index ?? 0, (own.index ?? 0) + own[0].length] : null;

  // A detector match that's only the 24-hour time reads it wrong (as a year, say), so it's dropped.
  // One that reaches past it ("17:00 tomorrow") still gives the day, and the 24-hour time wins.
  const usable = matches.filter((match) => {
    const start = text.indexOf(match.matched);
    return !ownRange || start < 0 || !within([start, start + match.matched.length], ownRange);
  });
  const timed = usable.find((match) => namedTime.test(match.matched));
  const day = usable.find((match) => match !== timed) ?? timed;

  let date: Date | null = day ? new Date(day.date) : null;
  if (date && timed && timed !== day) {
    const time = new Date(timed.date);
    date.setHours(time.getHours(), time.getMinutes(), 0, 0);
  }
  if (own) {
    const [hours, minutes] = own.slice(1).filter((part) => part !== undefined).map(Number);
    date ??= new Date();
    date.setHours(hours, minutes, 0, 0);
  }

  let rest = text;
  for (const part of [...usable.map((match) => match.matched), ...(own ? [own[0]] : [])]) {
    rest = rest.replace(part, " ");
  }
  rest = rest.replace(/\s+/g, " ").trim();
  const title = rest.replace(leading, "").replace(trailing, "").trim() || text.trim();

  return { title, date: date ? date.getTime() : null, hasTime: Boolean(own || timed) };
}
