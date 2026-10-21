import {
  Action,
  ActionPanel,
  Cache,
  closeMainWindow,
  environment,
  Form,
  getPreferenceValues,
  Icon,
  LaunchProps,
  List,
  popToRoot,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { findList } from "./list";
import { Match, when } from "./when";

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
  listId: string | null;
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

// Written to Apple's guidance for the on-device model: a role, one direct task, simple examples,
// and the key rule repeated last. Notes are left out entirely when the Notes field is off.
function titleInstructions(withNotes: boolean): string {
  const examples = [
    ["get coffee", "Get coffee", ""],
    ["pick up dry cleaning", "Pick up dry cleaning", ""],
    ["review slides after 's meeting", "Review slides after meeting", ""],
    ["call the dentist 555 123 4567", "Call the dentist", "555 123 4567"],
    ["send the deck to the team https://example.com/deck", "Send the deck to the team", "https://example.com/deck"],
  ].filter(([, , notes]) => withNotes || !notes);
  const shown = examples.map(([text, title, notes]) =>
    withNotes ? `${text} → {title: "${title}", notes: "${notes}"}` : `${text} → {title: "${title}"}`,
  );
  return [
    "You are an expert at writing reminders. Rewrite the person's text as a short reminder title.",
    "Start with a capital letter. Keep their words in their order. Remove only words that no longer make sense.",
    ...(withNotes ? ["Move a phone number, address or link to notes. Otherwise leave notes empty."] : []),
    "",
    "Examples:",
    ...shown,
    "",
    "Do not add words the person didn't write.",
  ].join("\n");
}

// Dates go stale ("tomorrow"), so detections are kept only while Remind is open.
const detections = new Map<string, Match[]>();
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

async function detect(text: string): Promise<Match[]> {
  const known = detections.get(text);
  if (known) return known;
  const found = JSON.parse(await helper(["detect", text])) as Match[];
  detections.set(text, found);
  return found;
}

function draftFor(text: string, matches: Match[], lists: ReminderList[]): Draft {
  const list = findList(text, lists);
  const { title, date, hasTime } = when(list ? text.replace(list.text, " ") : text, matches);
  return { text, title, date: date === null ? null : new Date(date), hasTime, listId: list?.id ?? null };
}

// Lists change rarely, so the last ones seen show at once while a fresh copy loads behind them.
const listCache = new Cache({ namespace: "lists" });
let listsLoading: Promise<ReminderList[]> | null = null;

function cachedLists(): ReminderList[] {
  try {
    return JSON.parse(listCache.get("lists") ?? "[]") as ReminderList[];
  } catch {
    return [];
  }
}

function loadLists(): Promise<ReminderList[]> {
  listsLoading ??= helper(["lists"], 60000)
    .then((output) => {
      listCache.set("lists", output);
      return JSON.parse(output) as ReminderList[];
    })
    .finally(() => {
      listsLoading = null;
    });
  return listsLoading;
}

function useLists(): { lists: ReminderList[]; failure: string | null; isLoading: boolean } {
  const [lists, setLists] = useState<ReminderList[]>(cachedLists);
  const [failure, setFailure] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    let isCurrent = true;
    loadLists()
      .then((found) => isCurrent && setLists(found))
      .catch((error: Error) => isCurrent && setFailure(error.message))
      .finally(() => isCurrent && setIsLoading(false));
    return () => {
      isCurrent = false;
    };
  }, []);
  return { lists, failure, isLoading };
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
function writeTitle(text: string, withNotes: boolean): Promise<{ title: string; notes: string }> {
  if (!existsSync(fm)) return Promise.reject(new Error("Apple Intelligence in Remind needs macOS 27 or later."));
  const args = ["respond", "--greedy", "--no-stream", "--instructions", titleInstructions(withNotes)];
  args.push("--schema", asset(withNotes ? "title-notes-schema.json" : "title-schema.json"), `Text: ${text}`);
  return new Promise((resolve, reject) =>
    execFile(fm, args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(fmError(String(stderr ?? "") || error.message)));
      const output = String(stdout);
      try {
        const answer = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
        const title = String(answer.title ?? "")
          .replace(/^(?:reminder|text):\s*/i, "")
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
  const { lists, failure: listFailure, isLoading: isLoadingLists } = useLists();
  const [listId, setListId] = useState(draft.listId ?? "");
  const [isWriting, setIsWriting] = useState(appleIntelligence);
  const [isAdding, setIsAdding] = useState(false);
  // All-day when the words name a day without a time, the way Calendar does it.
  const [allDay, setAllDay] = useState(draft.date !== null && !draft.hasTime);
  const titleEdited = useRef(false);
  const notesEdited = useRef(false);

  useEffect(() => {
    if (!appleIntelligence) return;
    let isCurrent = true;
    writeTitle(draft.title, showNotes)
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

  // The named list wins; otherwise the default list, once the lists are known.
  useEffect(() => {
    if (lists.some((list) => list.id === listId)) return;
    const named = lists.find((list) => list.id === draft.listId);
    setListId((named ?? lists.find((list) => list.isDefault) ?? lists[0])?.id ?? "");
  }, [lists]);

  useEffect(() => {
    if (listFailure && showList) {
      showToast({ style: Toast.Style.Failure, title: "Reminders Unavailable", message: listFailure });
    }
  }, [listFailure]);

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
      listId: showList ? listId : (draft.listId ?? ""),
      due: date ? date.getTime() : null,
      hasTime: Boolean(date) && !allDay,
      priority: Number(values.priority ?? 0),
      alertMinutes: Number(values.alert ?? 0),
      recurrence: values.repeat ?? "never",
    };
    try {
      await helper(["add", JSON.stringify(reminder)], 60000);
      await popToRoot({ clearSearchBar: true });
      await closeMainWindow({ clearRootSearch: true });
      await showHUD("Reminder Added");
    } catch (failure) {
      await showToast({ style: Toast.Style.Failure, title: "Reminder Not Added", message: (failure as Error).message });
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <Form
      isLoading={isWriting || (showList && isLoadingLists && lists.length === 0) || isAdding}
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
        type={allDay ? Form.DatePicker.Type.Date : Form.DatePicker.Type.DateTime}
        value={date}
        onChange={setDate}
      />
      <Form.Checkbox id="allDay" label="All-Day" value={allDay} onChange={setAllDay} />
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
      {showEarlyAlert && !allDay ? (
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

// Opened from root search with text, Remind goes straight to the review form.
function FromText({ text }: { text: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    const known = cachedLists();
    const lists = known.length > 0 ? Promise.resolve(known) : loadLists().catch(() => []);
    Promise.all([detect(text), lists])
      .then(([matches, found]) => setDraft(draftFor(text, matches, found)))
      .catch((failure: Error) => {
        setDraft({ text, title: text, date: null, hasTime: false, listId: null });
        showToast({ style: Toast.Style.Failure, title: "Date Unavailable", message: failure.message });
      });
  }, []);

  return draft ? <Review draft={draft} /> : <Form isLoading />;
}

export default function Command(props: LaunchProps) {
  const fallbackText = props.fallbackText?.trim();
  return fallbackText ? <FromText text={fallbackText} /> : <Search />;
}

function Search() {
  const [searchText, setSearchText] = useState("");
  const [found, setFound] = useState<{ text: string; matches: Match[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { lists } = useLists();
  const typed = searchText.trim();
  const draft = found && typed ? draftFor(found.text, found.matches, lists) : null;
  const listTitle = draft?.listId ? lists.find((list) => list.id === draft.listId)?.title : undefined;

  useEffect(() => {
    setError(null);
    if (!typed) {
      setFound(null);
      setIsLoading(false);
      return;
    }
    let isCurrent = true;
    setIsLoading(true);
    const timer = setTimeout(() => {
      detect(typed)
        .then((matches) => isCurrent && setFound({ text: typed, matches }))
        .catch((failure: Error) => {
          if (isCurrent) {
            setFound(null);
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

  const accessories: List.Item.Accessory[] = [];
  if (listTitle) accessories.push({ icon: Icon.List, text: listTitle });
  if (draft?.date) accessories.push({ icon: Icon.Calendar, text: dateLabel(draft.date, draft.hasTime) });

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Start typing to create a reminder…"
    >
      {error ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Reminders Unavailable" description={error} />
      ) : draft ? (
        <List.Item
          icon={Icon.Circle}
          title={draft.title}
          accessories={accessories}
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
