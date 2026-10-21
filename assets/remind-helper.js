// Remind helper that runs on any Mac: osascript -l JavaScript remind-helper.js detect [--spell] <text> | lists | add <json>
ObjC.import("Foundation");
ObjC.import("EventKit");

const reminderEntity = 1;
const fullAccess = 3;
const frequencies = { daily: 0, weekly: 1, monthly: 2, yearly: 3 };

// Fixes the words the macOS spell checker is sure of, and lists the ones it isn't. Links are left alone.
function spellCheck(text, links) {
  ObjC.import("AppKit");
  const checker = $.NSSpellChecker.sharedSpellChecker;
  if (!checker.setLanguage("en")) return { text, unsure: [] };
  const string = $(text);
  const fixes = [];
  const unsure = [];
  let start = 0;
  while (start < text.length) {
    const range = checker.checkSpellingOfStringStartingAt(string, start);
    // Struct fields arrive here as strings ("0"), so convert them to numbers.
    const location = Number(range.location);
    const length = Number(range.length);
    // The search wraps around to the start, so a match behind the last one means it's done.
    if (length === 0 || location < start) break;
    start = location + length;
    if (links.some((link) => location < link.location + link.length && link.location < location + length)) continue;
    const word = text.substr(location, length);
    const nsRange = { location, length };
    const fix = checker.correctionForWordRangeInStringLanguageInSpellDocumentWithTag(nsRange, string, "en", 0);
    if (!fix.isNil()) {
      fixes.push({ location, length, fix: ObjC.unwrap(fix) });
    } else {
      const found = checker.guessesForWordRangeInStringLanguageInSpellDocumentWithTag(nsRange, string, "en", 0);
      const guesses = found.isNil() ? [] : ObjC.deepUnwrap(found).slice(0, 5);
      if (guesses.length) unsure.push({ word, guesses });
    }
  }
  let fixed = text;
  for (const { location, length, fix } of fixes.reverse()) {
    fixed = fixed.slice(0, location) + fix + fixed.slice(location + length);
  }
  return { text: fixed, unsure };
}

// Every date and web link in the text, in order. Remind combines the dates, so "today" and "at 5" can
// come apart. Both are read in one pass, so a date inside a link stays part of the link.
function find(text) {
  const dateType = 8;
  const linkType = 32;
  const detector = $.NSDataDetector.dataDetectorWithTypesError(dateType | linkType, null);
  const matches = detector.matchesInStringOptionsRange($(text), 0, { location: 0, length: text.length });
  const found = { dates: [], links: [], linkRanges: [] };
  for (let index = 0; index < matches.count; index++) {
    const match = matches.objectAtIndex(index);
    // Struct fields arrive here as strings ("0"), so convert them to numbers.
    const location = Number(match.range.location);
    const length = Number(match.range.length);
    const matched = text.substr(location, length);
    if (Number(match.resultType) === dateType && !match.date.isNil()) {
      found.dates.push({ date: Number(match.date.timeIntervalSince1970) * 1000, matched });
    } else if (Number(match.resultType) === linkType && !match.URL.isNil()) {
      // Web links only, so an email address stays in the title.
      const scheme = match.URL.scheme.isNil() ? "" : match.URL.scheme.js.toLowerCase();
      if (scheme !== "http" && scheme !== "https") continue;
      found.links.push(matched);
      found.linkRanges.push({ location, length });
    }
  }
  return found;
}

// Spelling comes first, so a fixed "tommorow" is read as a date.
function detect(text, spell) {
  const checked = spell ? spellCheck(text, find(text).linkRanges) : { text, unsure: [] };
  const found = find(checked.text);
  return { text: checked.text, dates: found.dates, links: found.links, unsure: checked.unsure };
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
    // A shared list you can only view can't take a new reminder, so it isn't offered.
    if (!calendar.allowsContentModifications) continue;
    const id = calendar.calendarIdentifier.js;
    result.push({ id, title: calendar.title.js, account: calendar.source.title.js, isDefault: id === fallbackId });
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
  if (command === "detect" && rest[0] === "--spell") return JSON.stringify(detect(rest.slice(1).join(" "), true));
  if (command === "detect") return JSON.stringify(detect(rest.join(" "), false));
  if (command === "lists") return JSON.stringify(lists());
  if (command === "add" && rest.length === 1) return JSON.stringify(add(rest[0]));
  throw new Error("Usage: remind-helper.js detect [--spell] <text> | lists | add <json>");
}
