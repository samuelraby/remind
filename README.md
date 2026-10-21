# Remind

> **Beta.** Remind is in active development.

Create a reminder without leaving the keyboard. Remind is a [Tinycast](https://github.com/abue-ammar/tinycast) extension that uses the date detector and Apple Intelligence built into macOS. It works offline, and nothing you type leaves your Mac.

## What it does

Type a reminder, like "pick up dry cleaning friday at 5", and Remind shows the date as you type. Press ↵ to open the review screen, where you can change anything before the reminder is added.

| Shortcut | Action                        |
| -------- | ----------------------------- |
| ↵        | Open the review screen        |
| ⌘↵       | Add the reminder              |
| ⌘E       | Edit what you typed           |
| Esc      | Go back                       |
| ⇧⌫       | Clear remembered list matches |

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

| Setting            | Default | Description                                                                  |
| ------------------ | ------- | ---------------------------------------------------------------------------- |
| Apple Intelligence | On      | Writes titles and matches list names with the on-device model.               |
| List               | On      | Shows the List field on the review screen.                                   |
| Notes              | On      | Shows the Notes field on the review screen.                                  |
| Priority           | Off     | Shows the Priority field on the review screen.                               |
| Early Alert        | Off     | Shows the Early Alert field on the review screen, for reminders with a time. |
| Repeat             | Off     | Shows the Repeat field on the review screen.                                 |

### Apple Intelligence

Remind uses the on-device Apple Foundation Model to write titles and to match list names to your lists. Dates come from the macOS date detector.

Requires macOS 27 with Apple Intelligence turned on. Run this once to accept the Foundation Models terms:

```
sudo fm license
```

When Apple Intelligence is off, Remind uses your text as the title, without the date.

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
