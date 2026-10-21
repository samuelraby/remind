// The steps that rewrite a title a few words at a time: the words both share stay, the rest appear.

export const typingStep = 60;
const mostSteps = 5;

export function typingFrames(from: string, to: string): string[] {
  if (from === to) return [];
  const words = to.match(/\S+\s*/g) ?? [to];
  // Whole words that already match, case included, stay put.
  let kept = 0;
  let length = 0;
  for (const word of words) {
    if (!from.startsWith(to.slice(0, length + word.length))) break;
    length += word.length;
    kept++;
  }
  const left = words.length - kept;
  if (left === 0) return [to];
  const steps = Math.min(mostSteps, left);
  return Array.from({ length: steps }, (_, step) =>
    words
      .slice(0, kept + Math.ceil((left * (step + 1)) / steps))
      .join("")
      .trimEnd(),
  ).map((frame, index, all) => (index === all.length - 1 ? to : frame));
}
