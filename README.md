# Remind

> **Beta.** Remind is in active development.

Create a reminder without leaving the keyboard. Remind is a [Tinycast](https://github.com/abue-ammar/tinycast) extension that uses the date detector and Apple Intelligence built into macOS. It works offline, and nothing you type leaves your Mac.

## What it does

Type a reminder, like "pick up dry cleaning friday at 5", and Remind shows the date as you type. Press ↵ to review the reminder before it's added.

| Shortcut | Action              |
| -------- | ------------------- |
| ↵        | Review the reminder |
| ⌘↵       | Add the reminder    |
| Esc      | Go back             |

### Settings

| Setting            | Default | Description                                            |
| ------------------ | ------- | ------------------------------------------------------ |
| Apple Intelligence | On      | Writes titles with the on-device model.                |
| List               | On      | Shows the List field.                                  |
| Notes              | On      | Shows the Notes field.                                 |
| Priority           | Off     | Shows the Priority field.                              |
| Early Alert        | Off     | Shows the Early Alert field for reminders with a time. |
| Repeat             | Off     | Shows the Repeat field.                                |

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
