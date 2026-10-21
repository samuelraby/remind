# Remind

> **Beta.** Remind is in active development.

Create a reminder without leaving the keyboard. Remind is a [Tinycast](https://github.com/abue-ammar/tinycast) extension that uses the date detector and Apple Intelligence built into macOS. It works offline, and nothing you type leaves your Mac.

## What it does

Type a reminder, like "pick up dry cleaning friday at 5", and Remind shows the date as you type. Press ↵ to review the reminder before it's added.

To add it to a list, name the list: "on my Work list", "to Groceries" or "Work list". The list has to exist in Reminders.

| Shortcut | Action              |
| -------- | ------------------- |
| ↵        | Review the reminder |
| ⌘↵       | Add the reminder    |
| Esc      | Go back             |

### From root search

Type a reminder in Tinycast's root search and go right to the review. To set it up, create a quicklink named **Remind** with this link:

```
tinycast://extensions/samuel/remind/remind?fallbackText={argument name="Reminder"}
```

Then use it either way:

- Type **remind**, press ⇥, type the reminder in the **Reminder** field, and press ↵.
- Type the reminder and choose **Use "…" with Remind**. To make it the first fallback, move **Remind** to the top in **Settings › Fallbacks**.

If Remind doesn't appear when you type **remind**, turn on **Show in launcher** in **Settings › Quicklinks**.

### Settings

| Setting            | Default | Description                                                         |
| ------------------ | ------- | ------------------------------------------------------------------- |
| Apple Intelligence | On      | Writes titles with the on-device model.                             |
| List               | On      | Shows the List field when you review a reminder.                    |
| Notes              | On      | Shows the Notes field when you review a reminder.                   |
| Priority           | Off     | Shows the Priority field when you review a reminder.                |
| Early Alert        | Off     | Shows the Early Alert field when you review a reminder with a time. |
| Repeat             | Off     | Shows the Repeat field when you review a reminder.                  |

### Apple Intelligence

Remind uses the on-device Apple Foundation Model to write titles. Dates come from the macOS date detector.

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
