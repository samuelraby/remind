// The steps that type a new title over an old one: what both share stays, the rest types in.

// Slow enough that each step reaches the screen as its own frame, and done in about 300 ms.
export const typingStep = 30;
const mostSteps = 10;

export function typingFrames(from: string, to: string): string[] {
  if (from === to) return [];
  // Case counts, so a title Apple Intelligence only capitalized still visibly rewrites.
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  const left = to.length - shared;
  if (left === 0) return [to];
  const steps = Math.min(mostSteps, left);
  return Array.from({ length: steps }, (_, step) => to.slice(0, shared + Math.ceil((left * (step + 1)) / steps)));
}
