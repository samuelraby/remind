// When a title still reads badly after the rules have cleaned it, Apple Intelligence rewrites it.

// Words that start a reminder without being part of it.
export const leadIns = [
  "don't forget to",
  "don't forget",
  "dont forget to",
  "dont forget",
  "do not forget to",
  "remember to",
  "make sure to",
  "make sure",
  "i need to",
  "i have to",
  "i've got to",
  "i got to",
  "i gotta",
  "i should",
  "i must",
  "need to",
  "have to",
  "got to",
  "gotta",
  "can you",
  "could you",
  "would you",
  "please",
];

// Words that leave a title hanging when they come last.
export const danglingWords = [
  "after",
  "before",
  "with",
  "to",
  "from",
  "about",
  "and",
  "or",
  "the",
  "a",
  "an",
  "of",
  "until",
  "during",
  "than",
  "but",
  "so",
  "my",
  "your",
];

const startsWithLeadIn = new RegExp(`^(?:${leadIns.map((lead) => lead.replace(/'/g, "['’]")).join("|")})\\b`, "i");
const endsDangling = new RegExp(`\\b(?:${danglingWords.join("|")})$`, "i");
// "after 's meeting": a possessive whose owner was a date the rules took out.
const strayPossessive = /(?:^|\s)['’]s\b/i;

export function isRough(title: string): boolean {
  const text = title.trim();
  return startsWithLeadIn.test(text) || endsDangling.test(text) || strayPossessive.test(text);
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

// The model may only remove words. A title with a word that wasn't typed is thrown away.
export function onlyRemovesWords(before: string, after: string): boolean {
  const typed = new Set(words(before));
  const kept = words(after);
  return kept.length > 0 && kept.every((word) => typed.has(word));
}

// Small words grammar fixes may add, like "from" in "pick up kids from school".
export const grammarWords = ["a", "an", "the", "to", "from", "at", "in", "on", "for", "of", "with", "and", "is", "are"];
const addable = new Set(grammarWords);

// Letters added, removed, changed or swapped with a neighbor, each counting one.
function distance(a: string, b: string): number {
  const table = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        table[i][j] = Math.min(table[i][j], table[i - 2][j - 2] + 1);
      }
    }
  }
  return table[a.length][b.length];
}

// A respelling of a typed word five letters or longer, one letter off for every four. Shorter words
// must match, so "ice" can't become "rice".
function isRespelling(word: string, typed: Set<string>): boolean {
  if (word.length < 5) return false;
  const allowed = Math.floor(word.length / 4);
  for (const original of typed) if (original.length >= 4 && distance(word, original) <= allowed) return true;
  return false;
}

// With spelling and grammar on, a title may also respell typed words and add small grammar words.
export function onlyCorrects(before: string, after: string): boolean {
  const typed = new Set(words(before));
  const kept = words(after);
  return kept.length > 0 && kept.every((word) => typed.has(word) || addable.has(word) || isRespelling(word, typed));
}
