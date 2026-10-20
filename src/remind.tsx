import {
  Action,
  ActionPanel,
  environment,
  Form,
  getPreferenceValues,
  Icon,
  List,
  popToRoot,
  showToast,
  Toast,
} from "@raycast/api";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useRef, useState } from "react";

interface Detection {
  date: number | null;
  matched: string | null;
}

interface ReminderList {
  id: string;
  title: string;
  isDefault: boolean;
}

interface Draft {
  text: string;
  title: string;
  date: Date | null;
  hasTime: boolean;
}

interface FormValues {
  priority?: string;
  alert?: string;
  repeat?: string;
}

const asset = (name: string) => join(environment.assetsPath, name);
const swiftSource = asset("remind-helper.swift");
const fastHelper = join(environment.supportPath, "remind-helper");
const fastHelperStamp = `${fastHelper}.source-hash`;
const fm = "/usr/bin/fm";
const typingPause = 40;

// Each compiler runs directly with its own SDK, so neither xcode-select nor xcrun is consulted.
const toolchains = [
  ["/Library/Developer/CommandLineTools/usr/bin/swiftc", "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"],
  [
    "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc",
    "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
  ],
];

// Compiles, renames and stamps in one step, so it finishes even if the window closes first.
const buildScript = 't="$4.building"; "$1" -sdk "$2" -O "$3" -o "$t" && mv -f "$t" "$4" && printf %s "$5" > "$4.source-hash"';

const titleInstructions =
  "Write a short title for this reminder. Keep the person's own words. Leave out the date and time. Put any other detail in notes, or leave notes empty.";

// Dates go stale ("tomorrow"), so detections are kept only while Remind is open.
const detections = new Map<string, Detection>();
let sourceHash: string | undefined;
let fastHelperReady = false;
let fastHelperBroken = false;
let buildStarted = false;
let warnedAboutAppleIntelligence = false;

class HelperError extends Error {
  // True when the helper ran and reported a problem, rather than failing to run at all.
  constructor(
    message: string,
    readonly reported: boolean,
  ) {
    super(message);
  }
}

function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout }, (error, stdout, stderr) => {
      if (!error) return resolve(String(stdout));
      const message = String(stderr ?? "")
        .replace(/^.*?execution error: (?:Error: )?/s, "")
        .replace(/\s*\(-?\d+\)\s*$/, "")
        .trim();
      reject(new HelperError(message || error.message, error.code === 1));
    }),
  );
}

function currentSourceHash(): string {
  sourceHash ??= createHash("sha256").update(readFileSync(swiftSource)).digest("hex");
  return sourceHash;
}

// True once the compiled helper exists and was built from the Swift source that ships now.
function isFastHelperReady(): boolean {
  if (!fastHelperReady && !fastHelperBroken) {
    try {
      fastHelperReady = existsSync(fastHelper) && readFileSync(fastHelperStamp, "utf8") === currentSourceHash();
    } catch {
      return false;
    }
  }
  return fastHelperReady;
}

// Builds the faster helper where Apple's developer tools exist; Remind uses the script helper meanwhile.
function buildFastHelper() {
  if (buildStarted || isFastHelperReady()) return;
  buildStarted = true;
  const toolchain = toolchains.find((paths) => paths.every((path) => existsSync(path)));
  if (!toolchain) return;
  try {
    if (Date.now() - statSync(`${fastHelper}.building`).mtimeMs < 120000) return;
  } catch {
    // No build in progress.
  }
  mkdirSync(environment.supportPath, { recursive: true });
  spawn("/bin/sh", ["-c", buildScript, "build", ...toolchain, swiftSource, fastHelper, currentSourceHash()], {
    detached: true,
    stdio: "ignore",
  });
}

// A problem the helper reports is final; a helper that fails to run falls back to the script helper.
async function helper(args: string[], timeout = 5000): Promise<string> {
  buildFastHelper();
  if (isFastHelperReady()) {
    try {
      return await run(fastHelper, args, timeout);
    } catch (error) {
      if (error instanceof HelperError && error.reported) throw error;
      fastHelperBroken = true;
      fastHelperReady = false;
    }
  }
  return run("/usr/bin/osascript", ["-l", "JavaScript", asset("remind-helper.js"), ...args], timeout + 5000);
}

async function detect(text: string): Promise<Detection> {
  const known = detections.get(text);
  if (known) return known;
  const detection = JSON.parse(await helper(["detect", text])) as Detection;
  detections.set(text, detection);
  return detection;
}

const leftoverWords = "on|at|by|for|in|due|before|this|next";
const leadingLeftovers = new RegExp(`^(?:(?:${leftoverWords})\\s+)+`, "i");
const trailingLeftovers = new RegExp(`(?:\\s+(?:${leftoverWords}))+$`, "i");

// The text without the date, and without the small words the date leaves behind.
function titleWithout(text: string, matched: string | null): string {
  const rest = (matched ? text.replace(matched, " ") : text).replace(/\s+/g, " ").trim();
  return rest.replace(leadingLeftovers, "").replace(trailingLeftovers, "").trim() || text.trim();
}

// The date detector always returns a time, so a time counts only when the words name one.
const namedTime = /\d\s*(?:am|pm|a\.m\.|p\.m\.)|\d:\d{2}|\bat\s+\d|\b(?:noon|midnight|morning|afternoon|evening|tonight)\b/i;

function draftFor(text: string, detection: Detection): Draft {
  return {
    text,
    title: titleWithout(text, detection.matched),
    date: detection.date === null ? null : new Date(detection.date),
    hasTime: detection.date !== null && namedTime.test(detection.matched ?? ""),
  };
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function dateLabel(date: Date, hasTime: boolean): string {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const day = isSameDay(date, today)
    ? "Today"
    : isSameDay(date, tomorrow)
      ? "Tomorrow"
      : date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return hasTime ? `${day}, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : day;
}

function fmError(output: string): string {
  const text = output.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (/legal notice/i.test(text)) return "Run sudo fm license in Terminal to accept the Foundation Models terms.";
  return text.split("\n").find((line) => line.trim()) ?? "The on-device model didn't respond.";
}

// Asks the on-device model for a title and notes. The text is prefixed so it never reads as an option.
function writeTitle(text: string): Promise<{ title: string; notes: string }> {
  if (!existsSync(fm)) return Promise.reject(new Error("Apple Intelligence in Remind needs macOS 27 or later."));
  const args = ["respond", "--greedy", "--no-stream", "--instructions", titleInstructions];
  args.push("--schema", asset("title-schema.json"), `Reminder: ${text}`);
  return new Promise((resolve, reject) =>
    execFile(fm, args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(fmError(String(stderr ?? "") || error.message)));
      const output = String(stdout);
      try {
        const answer = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
        const title = String(answer.title ?? "")
          .replace(/^reminder:\s*/i, "")
          .trim();
        resolve({ title, notes: String(answer.notes ?? "").trim() });
      } catch {
        reject(new Error("The on-device model returned an answer Remind couldn't read."));
      }
    }),
  );
}

function Review({ draft }: { draft: Draft }) {
  const { appleIntelligence, showList, showNotes, showPriority, showEarlyAlert, showRepeat } =
    getPreferenceValues<Preferences.Remind>();
  const [title, setTitle] = useState(draft.title);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState<Date | null>(draft.date);
  const [lists, setLists] = useState<ReminderList[]>([]);
  const [listId, setListId] = useState("");
  const [isWriting, setIsWriting] = useState(appleIntelligence);
  const [isLoadingLists, setIsLoadingLists] = useState(showList);
  const [isAdding, setIsAdding] = useState(false);
  const titleEdited = useRef(false);
  const notesEdited = useRef(false);
  // Date only when the words name a day without a time; otherwise the picker offers a time too.
  const withTime = draft.hasTime || draft.date === null;

  useEffect(() => {
    if (!appleIntelligence) return;
    let isCurrent = true;
    writeTitle(draft.text)
      .then((answer) => {
        if (!isCurrent) return;
        if (answer.title && !titleEdited.current) setTitle(answer.title);
        if (answer.notes && showNotes && !notesEdited.current) setNotes(answer.notes);
      })
      .catch((failure: Error) => {
        if (!isCurrent || warnedAboutAppleIntelligence) return;
        warnedAboutAppleIntelligence = true;
        showToast({ style: Toast.Style.Failure, title: "Apple Intelligence Unavailable", message: failure.message });
      })
      .finally(() => isCurrent && setIsWriting(false));
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (!showList) return;
    let isCurrent = true;
    helper(["lists"], 60000)
      .then((output) => {
        if (!isCurrent) return;
        const found = JSON.parse(output) as ReminderList[];
        setLists(found);
        setListId((found.find((list) => list.isDefault) ?? found[0])?.id ?? "");
      })
      .catch((failure: Error) => {
        if (isCurrent) showToast({ style: Toast.Style.Failure, title: "Reminders Unavailable", message: failure.message });
      })
      .finally(() => isCurrent && setIsLoadingLists(false));
    return () => {
      isCurrent = false;
    };
  }, []);

  async function add(values: FormValues) {
    if (isAdding) return;
    if (!title.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Add a Title" });
      return;
    }
    setIsAdding(true);
    const reminder = {
      title: title.trim(),
      notes: showNotes ? notes.trim() : "",
      listId: showList ? listId : "",
      due: date ? date.getTime() : null,
      hasTime: Boolean(date) && withTime,
      priority: Number(values.priority ?? 0),
      alertMinutes: Number(values.alert ?? 0),
      recurrence: values.repeat ?? "never",
    };
    try {
      await helper(["add", JSON.stringify(reminder)], 60000);
      await showToast({ title: "Reminder Added" });
      await popToRoot({ clearSearchBar: true });
    } catch (failure) {
      await showToast({ style: Toast.Style.Failure, title: "Reminder Not Added", message: (failure as Error).message });
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <Form
      isLoading={isWriting || isLoadingLists || isAdding}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Reminder" icon={Icon.Plus} onSubmit={add} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        value={title}
        onChange={(value) => {
          titleEdited.current = true;
          setTitle(value);
        }}
      />
      <Form.DatePicker
        id="date"
        title="Date"
        type={withTime ? Form.DatePicker.Type.DateTime : Form.DatePicker.Type.Date}
        value={date}
        onChange={setDate}
      />
      {showList ? (
        <Form.Dropdown id="list" title="List" value={listId} onChange={setListId}>
          {lists.map((list) => (
            <Form.Dropdown.Item key={list.id} value={list.id} title={list.title} />
          ))}
        </Form.Dropdown>
      ) : null}
      {showNotes ? (
        <Form.TextArea
          id="notes"
          title="Notes"
          value={notes}
          onChange={(value) => {
            notesEdited.current = true;
            setNotes(value);
          }}
        />
      ) : null}
      {showPriority ? (
        <Form.Dropdown id="priority" title="Priority" defaultValue="0">
          <Form.Dropdown.Item value="0" title="None" />
          <Form.Dropdown.Item value="9" title="Low" />
          <Form.Dropdown.Item value="5" title="Medium" />
          <Form.Dropdown.Item value="1" title="High" />
        </Form.Dropdown>
      ) : null}
      {showEarlyAlert && withTime ? (
        <Form.Dropdown id="alert" title="Early Alert" defaultValue="0">
          <Form.Dropdown.Item value="0" title="None" />
          <Form.Dropdown.Item value="5" title="5 minutes before" />
          <Form.Dropdown.Item value="15" title="15 minutes before" />
          <Form.Dropdown.Item value="30" title="30 minutes before" />
          <Form.Dropdown.Item value="60" title="1 hour before" />
          <Form.Dropdown.Item value="1440" title="1 day before" />
        </Form.Dropdown>
      ) : null}
      {showRepeat ? (
        <Form.Dropdown id="repeat" title="Repeat" defaultValue="never">
          <Form.Dropdown.Item value="never" title="Never" />
          <Form.Dropdown.Item value="daily" title="Daily" />
          <Form.Dropdown.Item value="weekly" title="Weekly" />
          <Form.Dropdown.Item value="monthly" title="Monthly" />
          <Form.Dropdown.Item value="yearly" title="Yearly" />
        </Form.Dropdown>
      ) : null}
    </Form>
  );
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = searchText.trim();

  useEffect(() => {
    setError(null);
    if (!typed) {
      setDraft(null);
      setIsLoading(false);
      return;
    }
    let isCurrent = true;
    setIsLoading(true);
    const timer = setTimeout(() => {
      detect(typed)
        .then((detection) => isCurrent && setDraft(draftFor(typed, detection)))
        .catch((failure: Error) => {
          if (isCurrent) {
            setDraft(null);
            setError(failure.message);
          }
        })
        .finally(() => isCurrent && setIsLoading(false));
    }, typingPause);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [typed]);

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Start typing to create a reminder…"
    >
      {error ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Reminders Unavailable" description={error} />
      ) : draft && typed ? (
        <List.Item
          icon={Icon.Circle}
          title={draft.title}
          accessories={draft.date ? [{ icon: Icon.Calendar, text: dateLabel(draft.date, draft.hasTime) }] : undefined}
          actions={
            <ActionPanel>
              <Action.Push title="Review Reminder" icon={Icon.Pencil} target={<Review draft={draft} />} />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}
