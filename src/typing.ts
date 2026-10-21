// The steps that type a new title over an old one: what both share stays, the rest types in.

export const typingStep = 18;
const mostSteps = 8;

export function typingFrames(from: string, to: string): string[] {
  if (from === to) return [];
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared].toLowerCase() === to[shared].toLowerCase()) {
    shared++;
  }
  const left = to.length - shared;
  if (left === 0) return [to];
  const steps = Math.min(mostSteps, left);
  return Array.from({ length: steps }, (_, step) => to.slice(0, shared + Math.ceil((left * (step + 1)) / steps)));
}
