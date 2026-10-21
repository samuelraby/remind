// What Remind asks the on-device model, kept apart so it can be read and tried on its own.

// Written to Apple's guidance for the on-device model: a role, one direct task, simple examples,
// and the key rule repeated last. Grammar is only mentioned when Spelling and Grammar is on.
export function titleInstructions(fixGrammar: boolean): string {
  return [
    "You are an expert at writing reminders. Rewrite the person's text as a short reminder title.",
    'Remove filler like "don\'t forget" or "I need to", and words left hanging at the end. Keep their other words in their order.',
    ...(fixGrammar ? ["Fix grammar mistakes. Leave spelling as it is."] : []),
    "",
    "Examples:",
    'don\'t forget to call mom → {title: "Call mom"}',
    'I need to pick up dry cleaning → {title: "Pick up dry cleaning"}',
    'review slides after \'s meeting → {title: "Review slides after meeting"}',
    'send the deck to → {title: "Send the deck"}',
    ...(fixGrammar ? ['pick up kids school → {title: "Pick up kids from school"}'] : []),
    "",
    "Do not add words the person didn't write.",
  ].join("\n");
}

// The spell checker found a misspelled word but wasn't sure of the fix, so the model picks from
// its suggestions, in the context of the reminder.
export const spellingInstructions = [
  "You are an expert at spelling. The person misspelled a word in a reminder. Pick the word they meant from the options.",
  "If no option fits, answer with the misspelled word.",
  "",
  "Examples:",
  'Text: pick up goffee. Word: goffee. Options: coffee, toffee → {word: "coffee"}',
  'Text: call the plumer. Word: plumer. Options: plumber, plume → {word: "plumber"}',
  'Text: text jaxon. Word: jaxon. Options: jason, jackson → {word: "jaxon"}',
  "",
  "Only answer with one of the options or the misspelled word.",
].join("\n");

export const listInstructions = [
  "You are an expert at organizing reminders. Match the list name the person said to one of their lists.",
  "Answer with the list it means. If no list fits, answer None.",
  "",
  "Examples:",
  'Lists: Supermarket, Office, Home. Name: grocery → {list: "Supermarket"}',
  'Lists: Supermarket, Office, Home. Name: work → {list: "Office"}',
  'Lists: Supermarket, Office, Home. Name: gym → {list: "None"}',
  "",
  "Only answer with a list from Lists, or None.",
].join("\n");
