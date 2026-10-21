// Finds a Reminders list named in what you type, like "on my Errands list", and where it sits.

interface NamedList {
  id: string;
  title: string;
  isDefault?: boolean;
}

interface ListMatch {
  id: string;
  start: number;
  end: number;
}

const linking = new Set(["on", "to", "in", "into", "onto", "under"]);
const owning = new Set(["my", "the", "our"]);
const listWord = /^lists?[.,;:!?)]*$/i;

// "Side Projects", "SideProjects", "side-projects" and "🛠 Side Projects" all read as one name.
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

interface Word {
  text: string;
  start: number;
  end: number;
}

function wordsIn(text: string): Word[] {
  return [...text.matchAll(/[^\s,]+/g)].map((found) => ({
    text: found[0],
    start: found.index ?? 0,
    end: (found.index ?? 0) + found[0].length,
  }));
}

function bare(word: Word | undefined): string {
  return word ? word.text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") : "";
}

// Two lists can share a name across accounts, so the default list wins, then the first.
function byName(lists: NamedList[]): Map<string, NamedList> {
  const named = new Map<string, NamedList>();
  for (const list of lists) {
    const key = normalize(list.title);
    if (!key) continue;
    const known = named.get(key);
    if (!known || (list.isDefault && !known.isDefault)) named.set(key, list);
  }
  return named;
}

const leadIn = /^(?:please\s+)?remind\s+me(?:\s+to)?$/i;

// The word "list" is required, so a list named like an ordinary word ("Work", "Home") is never
// matched by accident. It also needs "on", "to" or "in" before it ("on my Work list"), or to open
// the text ("Work list call Sam"), so "make a grocery list" stays a reminder about a list.
export function findList(text: string, lists: NamedList[]): ListMatch | null {
  const named = byName(lists);
  const longest = Math.max(1, ...lists.map((list) => list.title.split(/\s+/).length)) + 1;
  const words = wordsIn(text);
  let best: (ListMatch & { size: number }) | null = null;

  for (let first = 0; first < words.length; first++) {
    for (let size = 1; size <= longest && first + size <= words.length; size++) {
      const last = words[first + size - 1];
      const list = named.get(normalize(text.slice(words[first].start, last.end)));
      if (!list) continue;
      // A list whose own name ends in "list" ("Reading List") already says it.
      const saysList = /\blists?$/i.test(list.title.trim()) || listWord.test(words[first + size]?.text ?? "");
      if (!saysList) continue;
      const to = /\blists?$/i.test(list.title.trim()) ? first + size : first + size + 1;
      let from = first;
      if (owning.has(bare(words[from - 1]))) from--;
      const linked = linking.has(bare(words[from - 1]));
      if (linked) from--;
      const opens = from === 0 || leadIn.test(text.slice(0, words[from].start).trim());
      if (!linked && !(opens && from === first)) continue;
      if (!best || size > best.size) {
        best = { id: list.id, start: words[from].start, end: words[to - 1].end, size };
      }
    }
  }

  return best ? { id: best.id, start: best.start, end: best.end } : null;
}

interface ListHint {
  name: string;
  start: number;
  end: number;
}

const notNames = new Set(["a", "an", "this", "that", "your", "his", "her", "their", "its", "list", "lists"]);
const longestHint = 4;

// A list named that isn't one of the person's lists, like "to my grocery list" with no Grocery
// list. Only the "on", "to" or "in" form counts, so "make a grocery list" is never a hint.
export function findListHint(text: string): ListHint | null {
  const words = wordsIn(text);
  for (let at = 0; at < words.length; at++) {
    if (!listWord.test(words[at].text)) continue;
    let first = at;
    while (first > 0 && at - first < longestHint) {
      const word = bare(words[first - 1]);
      if (!word || owning.has(word) || linking.has(word) || notNames.has(word)) break;
      first--;
    }
    if (first === at) continue;
    let from = first;
    if (owning.has(bare(words[from - 1]))) from--;
    if (!linking.has(bare(words[from - 1]))) continue;
    from--;
    return { name: text.slice(words[first].start, words[at - 1].end), start: words[from].start, end: words[at].end };
  }
  return null;
}

// Remembered matches are keyed this way, so "Grocery" and "grocery" are one name.
export function hintKey(name: string): string {
  return normalize(name);
}
