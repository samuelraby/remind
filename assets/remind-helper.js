// Remind helper that runs on any Mac: osascript -l JavaScript remind-helper.js detect <text> | lists | add <json>
ObjC.import("Foundation");
ObjC.import("EventKit");

const reminderEntity = 1;
const fullAccess = 3;
const frequencies = { daily: 0, weekly: 1, monthly: 2, yearly: 3 };

// Every date in the text, in order. Remind combines them, so "today" and "at 5" can come apart.
function detect(text) {
  const detector = $.NSDataDetector.dataDetectorWithTypesError(8, null);
  const matches = detector.matchesInStringOptionsRange($(text), 0, { location: 0, length: text.length });
  const found = [];
  for (let index = 0; index < matches.count; index++) {
    const match = matches.objectAtIndex(index);
    if (match.date.isNil()) continue;
    // Struct fields arrive here as strings ("0"), so convert them to numbers.
    const start = Number(match.range.location);
    const length = Number(match.range.length);
    found.push({ date: Number(match.date.timeIntervalSince1970) * 1000, matched: text.substr(start, length) });
  }
  return found;
}

// The script helper can't ask for access, so it needs access granted already.
function reminders() {
  if (Number($.EKEventStore.authorizationStatusForEntityType(reminderEntity)) !== fullAccess) {
    throw new Error("Remind needs access to Reminders. Allow it in System Settings › Privacy & Security › Reminders.");
  }
  return $.EKEventStore.alloc.init;
}

function lists() {
  const store = reminders();
  const fallback = store.defaultCalendarForNewReminders;
  const fallbackId = !fallback || fallback.isNil() ? null : fallback.calendarIdentifier.js;
  const calendars = store.calendarsForEntityType(reminderEntity);
  const result = [];
  for (let index = 0; index < calendars.count; index++) {
    const calendar = calendars.objectAtIndex(index);
    const id = calendar.calendarIdentifier.js;
    result.push({ id, title: calendar.title.js, isDefault: id === fallbackId });
  }
  return result;
}

function add(json) {
  const reminder = JSON.parse(json);
  const store = reminders();
  const item = $.EKReminder.reminderWithEventStore(store);
  item.setTitle($(reminder.title));
  if (reminder.notes) item.setNotes($(reminder.notes));
  item.setPriority(reminder.priority);
  let list = reminder.listId ? store.calendarWithIdentifier($(reminder.listId)) : null;
  if (!list || list.isNil()) list = store.defaultCalendarForNewReminders;
  if (!list || list.isNil()) throw new Error("Create a list in Reminders first.");
  item.setCalendar(list);

  if (reminder.due !== null) {
    const date = $.NSDate.dateWithTimeIntervalSince1970(reminder.due / 1000);
    // Year, month and day, plus hour and minute when the reminder has a time.
    const units = reminder.hasTime ? 4 | 8 | 16 | 32 | 64 : 4 | 8 | 16;
    item.setDueDateComponents($.NSCalendar.currentCalendar.componentsFromDate(units, date));
    if (reminder.hasTime) {
      const alert = $.NSDate.dateWithTimeIntervalSince1970((reminder.due - reminder.alertMinutes * 60000) / 1000);
      item.addAlarm($.EKAlarm.alarmWithAbsoluteDate(alert));
    }
    if (reminder.recurrence in frequencies) {
      const rule = $.EKRecurrenceRule.alloc.initRecurrenceWithFrequencyIntervalEnd(frequencies[reminder.recurrence], 1, null);
      item.addRecurrenceRule(rule);
    }
  }

  const error = Ref();
  if (!store.saveReminderCommitError(item, true, error)) {
    const failure = error[0];
    throw new Error(failure && !failure.isNil() ? failure.localizedDescription.js : "Reminders didn't save the reminder.");
  }
  return { id: item.calendarItemIdentifier.js };
}

function run(argv) {
  const [command, ...rest] = argv;
  if (command === "detect") return JSON.stringify(detect(rest.join(" ")));
  if (command === "lists") return JSON.stringify(lists());
  if (command === "add" && rest.length === 1) return JSON.stringify(add(rest[0]));
  throw new Error("Usage: remind-helper.js detect <text> | lists | add <json>");
}
