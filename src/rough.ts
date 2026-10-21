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

// With Spelling and Grammar on, a rewrite may also add small grammar words. Spelling is the spell
// checker's job, so any other new word is thrown away.
export function onlyFixesGrammar(before: string, after: string): boolean {
  const typed = new Set(words(before));
  const kept = words(after);
  return kept.length > 0 && kept.every((word) => typed.has(word) || addable.has(word));
}
