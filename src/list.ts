// Finds a Reminders list named in what you type, like "on my Errands list", and removes it.

export interface NamedList {
  id: string;
  title: string;
}

export interface ListMatch {
  id: string;
  text: string;
}

const linking = new Set(["on", "to", "in", "into", "under"]);
const owning = new Set(["my", "the", "our"]);
const longestName = 5;

// "Errands", "Errands" and "Errands" all read as one name.
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

// A list counts after "on", "to" or "in" ("on my Errands list"), or with "list" after it
// ("Errands list"), so a list named like an ordinary word isn't matched by accident.
export function findList(text: string, lists: NamedList[]): ListMatch | null {
  const byName = new Map(lists.map((list) => [normalize(list.title), list]));
  const words = wordsIn(text);
  let best: { list: NamedList; from: number; to: number; size: number } | null = null;

  for (let start = 0; start < words.length; start++) {
    for (let size = 1; size <= longestName && start + size <= words.length; size++) {
      const name = normalize(text.slice(words[start].start, words[start + size - 1].end));
      const list = name ? byName.get(name) : undefined;
      if (!list) continue;
      let from = start;
      let to = start + size;
      if (from > 0 && owning.has(words[from - 1].text.toLowerCase())) from--;
      const linked = from > 0 && linking.has(words[from - 1].text.toLowerCase());
      if (linked) from--;
      const named = to < words.length && /^lists?$/i.test(words[to].text);
      if (named) to++;
      if (!linked && !named) continue;
      if (!best || size > best.size) best = { list, from, to, size };
    }
  }

  if (!best) return null;
  return { id: best.list.id, text: text.slice(words[best.from].start, words[best.to - 1].end) };
}
