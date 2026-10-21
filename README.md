# Remind

> **Beta.** Remind is in active development.

Create a reminder without leaving the keyboard. Remind is a [Tinycast](https://github.com/abue-ammar/tinycast) extension that uses the date detector and Apple Intelligence built into macOS. It works offline, and nothing you type leaves your Mac.

## What it does

Type a reminder, like "pick up dry cleaning friday at 5", and Remind shows the date as you type. Press ↵ to open the review screen, where you can change anything before the reminder is added.

| Shortcut | Action                 |
| -------- | ---------------------- |
| ↵        | Open the review screen |
| ⌘↵       | Add the reminder       |
| ⌘E       | Edit what you typed    |
| Esc      | Go back                |
| ⇧⌫       | Clear the cache        |

### Lists

Name a list, including the word "list", to add the reminder to it.

| You type                       | List      | Title         |
| ------------------------------ | --------- | ------------- |
| get coffee on my Errands list  | Errands   | get coffee    |
| add eggs to the Groceries list | Groceries | eggs          |
| Work list send the deck        | Work      | send the deck |

The list must already exist in Reminders. Capitalization, spaces, and symbols don't matter, so "sideprojects" finds Side Projects.

With Apple Intelligence on, a name that isn't one of your lists goes to the list it fits. "add to my grocery list" goes to a list named Supermarket, for example. Remind remembers the match, so it's instant next time. To change it, pick another list on the review screen, and Remind remembers that instead.

A phrase that only mentions a list, like "make a grocery list", stays in the title. A list named like a date, such as Today, doesn't set the date.

If lists in two accounts share a name, the List field shows the account next to each. Shared lists you can only view aren't available.

### From root search

Type a reminder in Tinycast's root search and go right to the review screen. To set it up, create a quicklink named **Remind** with this link:

```
tinycast://extensions/samuel/remind/remind?fallbackText={argument name="Reminder"}
```

Then use it either way:

- Type **remind**, press ⇥, type the reminder in the **Reminder** field, and press ↵.
- Type the reminder and choose **Use "…" with Remind**. To make it the first fallback, move **Remind** to the top in **Settings › Fallbacks**.

If Remind doesn't appear when you type **remind**, turn on **Show in launcher** in **Settings › Quicklinks**.

### Settings

| Setting              | Default | Description                                                                                 |
| -------------------- | ------- | ------------------------------------------------------------------------------------------- |
| Apple Intelligence   | On      | Matches list names and rewrites titles that read badly, with the on-device model.           |
| Spelling and Grammar | Off     | Corrects spelling and grammar in titles with the on-device model. Needs Apple Intelligence. |
| List                 | On      | Shows the List field on the review screen.                                                  |
| Notes                | On      | Shows the Notes field on the review screen.                                                 |
| Priority             | Off     | Shows the Priority field on the review screen.                                              |
| Early Alert          | Off     | Shows the Early Alert field on the review screen, for reminders with a time.                |
| Repeat               | Off     | Shows the Repeat field on the review screen.                                                |

## How it works

Remind reads what you type in three steps. Each step uses fixed rules first. Apple Intelligence only steps in where the rules can't finish the job.

### 1. Date and time

The date detector built into macOS finds every date in the text, like "friday", "tomorrow at noon" or "in two weeks". Remind combines them, so a day and a time can sit apart: "today get coffee at 5pm".

Remind reads 24-hour times itself, because the date detector misses them:

- "at 1700", "by 1700", "before 1700" or "around 1700".
- "1700 hrs" or "1700 hours".
- "17:00", for hours 13 to 23 or with a leading zero.
- A bare "1700" right after a day ("today 1700"), at the start ("1700 today"), or at the start or end of a reminder that names a day.

A number stays a number after "room", "suite", "apt", "unit", "gate", "flight", "order", "ext", "building", "floor", "code", "pin", "zip", "no", "number", "route", "hwy", "highway", "version", "v", "$" or "#", or before "dollars", "bucks", "usd", "calories", "cal", "miles", "mi", "km", "steps", "words", "points" or "pts". A year, like "April 2026", stays a year.

A reminder has a time only when you name one: "am", "pm", "noon", "midnight", "morning", "afternoon", "evening", "tonight", "at 5", "5:30" or a 24-hour time. Otherwise it's all-day.

### 2. List

A list counts when you name it with the word "list", and either:

- "on", "to", "in", "into", "onto" or "under" comes before it, with "my", "the" or "our" optional: "on my Work list".
- It opens the reminder, after an optional "remind me": "Work list send the deck".

A list whose own name ends in "list", like Reading List, doesn't need the word twice. Names match whatever the capitalization, spacing or symbols. When two names fit, the longer one wins. When lists in two accounts share a name, your default list wins.

If the name isn't one of your lists, Apple Intelligence picks the list it fits. This only happens for the "on", "to" or "in" form, with a name of one to four words that doesn't include "a", "an", "this", "that", "your", "his", "her", "their" or "its". Once you add the reminder, Remind remembers the list for that name.

### 3. Title

Remind takes out, in order:

- Every date and time it read, and the list phrase. A date inside a list's name, like Today, stays part of the list.
- "add" at the start, when the list comes after "to", "onto" or "into": "add eggs to the Groceries list" gives "eggs".
- "remind me", "remind me to" and "please remind me" at the start.
- "on", "at", "by", "for", "in", "due", "before", "around", "this" and "next" left over at the start or end.
- Stray punctuation at the start or end.

If nothing is left, the title is everything you typed.

If what's left still reads badly, Apple Intelligence rewrites it. A title reads badly when it:

- Starts with "don't forget", "do not forget to", "remember to", "make sure", "I need to", "I have to", "I've got to", "I got to", "I gotta", "I should", "I must", "need to", "have to", "got to", "gotta", "can you", "could you", "would you" or "please".
- Ends with "after", "before", "with", "to", "from", "about", "and", "or", "the", "a", "an", "of", "until", "during", "than", "but", "so", "my" or "your".
- Has a stray "'s", like "after 's meeting".

Apple Intelligence can only take words out. If its title has a word you didn't type, Remind keeps its own.

With **Spelling and Grammar** on, Apple Intelligence also corrects every title, not only the ones that read badly. It may respell a word of five letters or more, one letter for every four, so "cofee" becomes "coffee" and "recieve" becomes "receive". It may add "a", "an", "the", "to", "from", "at", "in", "on", "for", "of", "with", "and", "is" or "are". Shorter words must stay as typed, so "ice" can't become "rice". Any other change, and Remind keeps its own title.

### Apple Intelligence

Remind uses the on-device Apple Foundation Model only when the rules above can't finish the job, or when you ask it to correct spelling and grammar.

| Task                         | Runs when                                                         | Takes          |
| ---------------------------- | ----------------------------------------------------------------- | -------------- |
| Match a list name            | The name isn't one of your lists, and no match is remembered yet. | About a second |
| Rewrite the title            | The title reads badly after step 3.                               | About a second |
| Correct spelling and grammar | Spelling and Grammar is on. Runs on every title.                  | About a second |

They run together on the review screen, never while you type. They never change the date, the time or your notes. Everything else opens instantly.

Requires macOS 27 with Apple Intelligence turned on. Run this once to accept the Foundation Models terms:

```
sudo fm license
```

When Apple Intelligence is off, Remind skips all of these. List names must match a list exactly, and the title is what's left after step 3.

## How the code works

Remind is a Tinycast extension written in TypeScript, with a small Swift helper for the parts only macOS can do.

| File                          | What it does                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `src/remind.tsx`              | The typing screen, the review screen and settings. Calls the helper and Apple Intelligence.   |
| `src/when.ts`                 | Step 1 and the title cleanup in step 3.                                                       |
| `src/list.ts`                 | Step 2: finds a list you named, or a name for Apple Intelligence to match.                    |
| `src/rough.ts`                | Decides when a title reads badly, and checks that a rewrite only made allowed changes.        |
| `assets/remind-helper.swift`  | Reads dates with the macOS date detector, reads your lists and adds reminders to Reminders.   |
| `assets/remind-helper.js`     | The same helper as a script, used until the Swift helper is built.                            |
| `assets/list-schema.json`     | The shape of Apple Intelligence's list answer.                                                |
| `assets/title-schema.json`    | The shape of Apple Intelligence's title answer.                                               |

The first time Remind runs, it builds the Swift helper in the background with Apple's command line developer tools and keeps it in Tinycast's support folder. Until then, or on a Mac without the tools, the script helper does the same work, a little slower. Remind rebuilds the helper whenever its source changes.

Every helper call is a short process that answers and quits. Apple Intelligence runs through `fm`, the Foundation Models command built into macOS 27, with greedy sampling and a schema, so each answer comes back as structured data. Nothing keeps running when Remind is closed.

Remind keeps three things on your Mac:

- **Your lists**, so they show at once. A fresh copy loads each time Remind opens.
- **List matches**, like "grocery" to Supermarket.
- **Dates it has read**, while Remind is open, so going back over text is instant.

⇧⌫ clears all three.

## Install

1. Download **Remind.zip** from Releases and unzip it.
2. In Tinycast, open **Settings › Extensions**.
3. Click **Add from folder** and choose the **Remind** folder.
4. Open **Create Reminder** in Tinycast.

Tinycast keeps its own copy, so you can delete the download afterward.

To update, remove the current version in **Settings › Extensions**, then repeat these steps.

## License

[MIT](LICENSE)

Remind is an independent project and is not affiliated with, authorized, sponsored, or approved by Apple Inc., Raycast, or Tinycast. macOS is a trademark of Apple Inc., registered in the U.S. and other countries and regions. Apple Intelligence is a trademark of Apple Inc.
