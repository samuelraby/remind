// Finds the dates in a reminder, lists Reminders lists, and adds reminders. Prints JSON.
// Usage: remind-helper detect [--spell] <text>
//        remind-helper lists
//        remind-helper add <json>
import AppKit
import EventKit
import Foundation

struct Detection: Encodable {
    let date: Double
    let matched: String
}

// A word the spell checker flagged but couldn't fix on its own, with what it suggests.
struct Unsure: Encodable {
    let word: String
    let guesses: [String]
}

struct Reading: Encodable {
    let text: String
    let dates: [Detection]
    let unsure: [Unsure]
}

struct ReminderList: Encodable {
    let id: String
    let title: String
    let account: String
    let isDefault: Bool
}

struct NewReminder: Decodable {
    let title: String
    let notes: String?
    let listId: String?
    let due: Double?
    let hasTime: Bool
    let priority: Int
    let alertMinutes: Int
    let recurrence: String?
}

final class Answer: @unchecked Sendable {
    var finished = false
}

func emit<T: Encodable>(_ value: T) {
    print(String(decoding: try! JSONEncoder().encode(value), as: UTF8.self))
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// Fixes the words the macOS spell checker is sure of, and lists the ones it isn't.
func spellCheck(_ text: String) -> (String, [Unsure]) {
    let checker = NSSpellChecker.shared
    guard checker.setLanguage("en") else { return (text, []) }
    let original = text as NSString
    var fixes: [(NSRange, String)] = []
    var unsure: [Unsure] = []
    var start = 0
    while start < original.length {
        let range = checker.checkSpelling(of: text, startingAt: start)
        // The search wraps around to the start, so a match behind the last one means it's done.
        if range.location == NSNotFound || range.location < start { break }
        let word = original.substring(with: range)
        if let fix = checker.correction(forWordRange: range, in: text, language: "en", inSpellDocumentWithTag: 0) {
            fixes.append((range, fix))
        } else {
            let guesses = checker.guesses(forWordRange: range, in: text, language: "en", inSpellDocumentWithTag: 0) ?? []
            if !guesses.isEmpty { unsure.append(Unsure(word: word, guesses: Array(guesses.prefix(5)))) }
        }
        start = range.location + range.length
    }
    let fixed = NSMutableString(string: text)
    for (range, fix) in fixes.reversed() { fixed.replaceCharacters(in: range, with: fix) }
    return (fixed as String, unsure)
}

// Every date in the text, in order. Remind combines them, so "today" and "at 5" can come apart.
func dates(in text: String) -> [Detection] {
    let detector = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue)
    return detector.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap {
        match -> Detection? in
        guard let date = match.date, let range = Range(match.range, in: text) else { return nil }
        return Detection(date: date.timeIntervalSince1970 * 1000, matched: String(text[range]))
    }
}

// Spelling comes first, so a fixed "tommorow" is read as a date.
func detect(_ text: String, spell: Bool) {
    let (fixed, unsure) = spell ? spellCheck(text) : (text, [])
    emit(Reading(text: fixed, dates: dates(in: fixed), unsure: unsure))
}

// Asks once, then needs full access. The answer can arrive on the main queue, so the run loop keeps turning.
func reminders() -> EKEventStore {
    let store = EKEventStore()
    if EKEventStore.authorizationStatus(for: .reminder) == .fullAccess { return store }
    if EKEventStore.authorizationStatus(for: .reminder) == .notDetermined {
        let answer = Answer()
        store.requestFullAccessToReminders { _, _ in answer.finished = true }
        let deadline = Date(timeIntervalSinceNow: 45)
        while !answer.finished && Date() < deadline {
            RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
        }
    }
    guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
        fail("Remind needs access to Reminders. Allow it in System Settings › Privacy & Security › Reminders.")
    }
    // A store made before access was granted may not see the lists, so a new one does.
    return EKEventStore()
}

func lists() {
    let store = reminders()
    let fallback = store.defaultCalendarForNewReminders()?.calendarIdentifier
    // A shared list you can only view can't take a new reminder, so it isn't offered.
    emit(store.calendars(for: .reminder).filter(\.allowsContentModifications).map {
        ReminderList(
            id: $0.calendarIdentifier, title: $0.title, account: $0.source.title,
            isDefault: $0.calendarIdentifier == fallback)
    })
}

func add(_ json: String) {
    guard let new = try? JSONDecoder().decode(NewReminder.self, from: Data(json.utf8)) else {
        fail("Remind couldn't read the reminder.")
    }
    let store = reminders()
    let reminder = EKReminder(eventStore: store)
    reminder.title = new.title
    reminder.notes = new.notes?.isEmpty == false ? new.notes : nil
    reminder.priority = new.priority
    guard let list = new.listId.flatMap({ store.calendar(withIdentifier: $0) }) ?? store.defaultCalendarForNewReminders()
    else { fail("Create a list in Reminders first.") }
    reminder.calendar = list

    if let due = new.due {
        let date = Date(timeIntervalSince1970: due / 1000)
        let units: Set<Calendar.Component> = new.hasTime ? [.year, .month, .day, .hour, .minute] : [.year, .month, .day]
        reminder.dueDateComponents = Calendar.current.dateComponents(units, from: date)
        if new.hasTime {
            reminder.addAlarm(EKAlarm(absoluteDate: date.addingTimeInterval(-Double(new.alertMinutes) * 60)))
        }
        let frequencies: [String: EKRecurrenceFrequency] = [
            "daily": .daily, "weekly": .weekly, "monthly": .monthly, "yearly": .yearly,
        ]
        if let frequency = new.recurrence.flatMap({ frequencies[$0] }) {
            reminder.addRecurrenceRule(EKRecurrenceRule(recurrenceWith: frequency, interval: 1, end: nil))
        }
    }

    do {
        try store.save(reminder, commit: true)
    } catch {
        fail(error.localizedDescription)
    }
    emit(["id": reminder.calendarItemIdentifier])
}

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "detect" where arguments.dropFirst().first == "--spell": detect(arguments.dropFirst(2).joined(separator: " "), spell: true)
case "detect": detect(arguments.dropFirst().joined(separator: " "), spell: false)
case "lists": lists()
case "add" where arguments.count == 2: add(arguments[1])
default: fail("Usage: remind-helper detect [--spell] <text> | lists | add <json>")
}
