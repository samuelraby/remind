// Takes web links out of a reminder, so they can go in its notes.

// Words that hand over a link: "and add this link", "with the link", "here's the link:".
const handsOver =
  /(?:^|[\s,]+)(?:and\s+)?(?:add|attach|include|with|here['’]s|here\s+is)\s+(?:(?:this|the|a)\s+)?(?:link|url)\s*:?\s*$/i;
// A label right before a link: "link:" or "url:".
const labels = /(?:^|[\s,]+)(?:link|url)\s*:\s*$/i;

// Only "and", "&" or a comma between two links: "https://a.com and https://b.com".
const joins = /^[\s,]*(?:and|&)?[\s,]*$/i;

// The text without its links, and the words that hand them over.
export function withoutLinks(text: string, links: string[]): string {
  let rest = "";
  let from = 0;
  let afterLink = false;
  for (const link of links) {
    const at = text.indexOf(link, from);
    if (at < 0) continue;
    const before = text.slice(from, at);
    rest += afterLink && joins.test(before) ? " " : `${before.replace(handsOver, " ").replace(labels, " ")} `;
    from = at + link.length;
    afterLink = true;
  }
  return `${rest}${text.slice(from)}`
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
