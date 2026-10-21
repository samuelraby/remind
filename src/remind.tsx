import {
  Action,
  ActionPanel,
  Cache,
  closeMainWindow,
  environment,
  Form,
  getPreferenceValues,
  Icon,
  launchCommand,
  LaunchProps,
  LaunchType,
  List,
  popToRoot,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { withoutLinks } from "./links";
import { findList, findListHint, hintKey } from "./list";
import { listInstructions, spellingInstructions, titleInstructions } from "./prompts";
import { isRough, onlyFixesGrammar, onlyRemovesWords } from "./rough";
import { Match, when } from "./when";

interface ReminderList {
  id: string;
  title: string;
  account?: string;
  isDefault: boolean;
}

// Lists that share a name across accounts are told apart by their account.
function listLabel(list: ReminderList, lists: ReminderList[]): string {
  const shared = lists.filter((other) => other.title === list.title).length > 1;
  return shared && list.account ? `${list.title} (${list.account})` : list.title;
}

// What the helper read: the text with sure spelling fixes, its dates and links, and words it wasn't sure of.
interface Unsure {
  word: string;
  guesses: string[];
}

interface Reading {
  text: string;
  dates: Match[];
  links: string[];
  unsure: Unsure[];
}

interface Draft {
  text: string;
  title: string;
  date: Date | null;
  hasTime: boolean;
  listId: string | null;
  // A list name that isn't one of the person's lists, like "grocery", and the title if no list fits.
  hint: { name: string; title: string } | null;
  // Web links, which go in the notes.
  links: string[];
  unsure: Unsure[];
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

// Dates go stale ("tomorrow"), so detections are kept only while Remind is open.
const detections = new Map<string, Reading>();
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

// With Spelling and Grammar on, the helper fixes spelling before it reads dates.
function readingKey(text: string): string {
  return `${getPreferenceValues<Preferences.Remind>().fixSpelling ? "spell" : "plain"}:${text}`;
}

async function detect(text: string): Promise<Reading> {
  const key = readingKey(text);
  const known = detections.get(key);
  if (known) return known;
  const spell = getPreferenceValues<Preferences.Remind>().fixSpelling ? ["--spell"] : [];
  const reading = JSON.parse(await helper(["detect", ...spell, text])) as Reading;
  detections.set(key, reading);
  return reading;
}

function readDates(text: string, matches: Match[]) {
  // A date inside a list's name ("on my Today list") isn't a date.
  return when(
    text,
    matches.filter((match) => text.includes(match.matched)),
  );
}

function draftFor(reading: Reading, lists: ReminderList[]): Draft {
  const { dates: matches, unsure } = reading;
  // Links go in the notes, unless there's nothing else to remind about, like "today https://…".
  const plain = withoutLinks(reading.text, reading.links);
  const useLinks = reading.links.length > 0 && readDates(plain, matches).hasContent;
  const links = useLinks ? reading.links : [];
  const text = useLinks ? plain : reading.text;
  const list = findList(text, lists);
  const hinted = list || lists.length === 0 ? null : findListHint(text);
  const picked = hinted ? pickedList(hinted.name, lists) : null;
  const cut = list ?? hinted;
  let rest = cut ? `${text.slice(0, cut.start)} ${text.slice(cut.end)}` : text;
  // "add eggs to my Groceries list" is about the list, so "add" goes with it, the way Siri reads it.
  if (cut && /^(?:to|onto|into)\b/i.test(text.slice(cut.start))) {
    rest = rest.replace(/^(\s*(?:please\s+)?(?:remind\s+me(?:\s+to)?\s+)?)add\s+/i, "$1");
  }
  const { title, date, hasTime } = readDates(rest, matches);
  const whole = hinted ? readDates(text, matches).title : title;
  const willAsk = hinted && !picked && getPreferenceValues<Preferences.Remind>().appleIntelligence;
  return {
    text,
    title: hinted && !picked && !willAsk ? whole : title,
    date: date === null ? null : new Date(date),
    hasTime,
    listId: list?.id ?? picked ?? null,
    hint: hinted ? { name: hinted.name, title: whole } : null,
    links,
    unsure,
  };
}

// The list each name led to last time, so "grocery" goes straight to Supermarket after the first.
const pickCache = new Cache({ namespace: "list-picks" });

function pickedList(name: string, lists: ReminderList[]): string | null {
  const id = pickCache.get(hintKey(name));
  return id && lists.some((list) => list.id === id) ? id : null;
}

// Forgets every remembered list match and the saved copy of the lists.
async function clearCache() {
  pickCache.clear();
  listCache.clear();
  detections.clear();
  await showToast({ title: "Cache Cleared" });
}

function ClearCacheAction() {
  return (
    <Action
      title="Clear Cache"
      icon={Icon.Trash}
      style={Action.Style.Destructive}
      shortcut={{ modifiers: ["shift"], key: "delete" }}
      onAction={clearCache}
    />
  );
}

function rememberPick(name: string, listId: string) {
  if (listId) pickCache.set(hintKey(name), listId);
}

// Lists change rarely, so the last ones seen show at once while a fresh copy loads behind them.
// They load once per open, so the search and the review screen share one request.
const listCache = new Cache({ namespace: "lists" });
let listsLoading: Promise<ReminderList[]> | null = null;
let loadedLists: ReminderList[] | null = null;

function cachedLists(): ReminderList[] {
  if (loadedLists) return loadedLists;
  try {
    return JSON.parse(listCache.get("lists") ?? "[]") as ReminderList[];
  } catch {
    return [];
  }
}

function loadLists(): Promise<ReminderList[]> {
  listsLoading ??= helper(["lists"], 60000).then(
    (output) => {
      listCache.set("lists", output);
      loadedLists = JSON.parse(output) as ReminderList[];
      return loadedLists;
    },
    (error: Error) => {
      listsLoading = null;
      throw error;
    },
  );
  return listsLoading;
}

function useLists(): { lists: ReminderList[]; failure: string | null; isLoading: boolean } {
  const [lists, setLists] = useState<ReminderList[]>(cachedLists);
  const [failure, setFailure] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(loadedLists === null);
  useEffect(() => {
    if (loadedLists) return;
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

// Runs the on-device model once and reads its JSON answer. The prompt is prefixed so it never
// reads as an option.
function askModel(instructions: string, schema: string, prompt: string): Promise<Record<string, unknown>> {
  if (!existsSync(fm)) return Promise.reject(new Error("Apple Intelligence in Remind needs macOS 27 or later."));
  const args = ["respond", "--greedy", "--no-stream", "--instructions", instructions, "--schema", asset(schema), prompt];
  return new Promise((resolve, reject) =>
    execFile(fm, args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(fmError(String(stderr ?? "") || error.message)));
      const output = String(stdout);
      try {
        resolve(JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)));
      } catch {
        reject(new Error("The on-device model returned an answer Remind couldn't read."));
      }
    }),
  );
}

// Rewrites a title. Without spelling and grammar it may only take words out; with it, it may also
// respell words and add small grammar words. Anything else, or an empty answer, is no rewrite.
async function rewriteTitle(text: string, fixGrammar: boolean): Promise<string | null> {
  const answer = await askModel(titleInstructions(fixGrammar), "title-schema.json", `Text: ${text}`);
  const said = String(answer.title ?? "")
    .replace(/^(?:reminder|text):\s*/i, "")
    .trim();
  const allowed = fixGrammar ? onlyFixesGrammar(text, said) : onlyRemovesWords(text, said);
  if (!allowed) return null;
  // The model doesn't always start with a capital letter, so Remind makes sure.
  return said.charAt(0).toLocaleUpperCase() + said.slice(1);
}

// Asks the on-device model which of the spell checker's suggestions the person meant. Anything else
// keeps the word as typed.
async function pickSpelling(text: string, unsure: Unsure): Promise<string | null> {
  const prompt = `Text: ${text}. Word: ${unsure.word}. Options: ${unsure.guesses.join(", ")}`;
  const answer = await askModel(spellingInstructions, "word-schema.json", prompt);
  const said = String(answer.word ?? "").trim().toLowerCase();
  return unsure.guesses.find((guess) => guess.toLowerCase() === said) ?? null;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Asks the on-device model which list a name like "grocery" means. Anything not on the list is no list.
async function pickList(name: string, lists: ReminderList[]): Promise<string | null> {
  const titles = [...new Set(lists.map((list) => list.title))];
  const answer = await askModel(listInstructions, "list-schema.json", `Lists: ${titles.join(", ")}. Name: ${name}`);
  const said = normalizeTitle(String(answer.list ?? ""));
  const match = lists.filter((list) => normalizeTitle(list.title) === said);
  return (match.find((list) => list.isDefault) ?? match[0])?.id ?? null;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// Back to the typing screen with the sentence as typed, so it can be fixed and read again.
function EditTextAction({ onEdit }: { onEdit: () => void }) {
  return <Action title="Edit Text" icon={Icon.Pencil} shortcut={{ modifiers: ["cmd"], key: "e" }} onAction={onEdit} />;
}

function Review({ draft, onEdit }: { draft: Draft; onEdit: () => void }) {
  const { appleIntelligence, fixSpelling, showList, showNotes, showPriority, showEarlyAlert, showRepeat } =
    getPreferenceValues<Preferences.Remind>();
  const [title, setTitle] = useState(draft.title);
  const [notes, setNotes] = useState(draft.links.join("\n"));
  const [date, setDate] = useState<Date | null>(draft.date);
  const { lists, failure: listFailure, isLoading: isLoadingLists } = useLists();
  const [listId, setListId] = useState(draft.listId ?? "");
  const [isAdding, setIsAdding] = useState(false);
  // All-day when the words name a day without a time, the way Calendar does it.
  const [allDay, setAllDay] = useState(draft.date !== null && !draft.hasTime);
  const titleEdited = useRef(false);
  const listChosen = useRef(false);
  const listPicked = useRef(false);
  const shownTitle = useRef(draft.title);

  function showTitle(value: string) {
    shownTitle.current = value;
    setTitle(value);
  }

  // Apple Intelligence matches a list name that isn't one of the lists, like "grocery", and
  // rewrites a title that's still rough. Both start together.
  const hint = draft.hint && !draft.listId ? draft.hint : null;
  // With spelling and grammar on, every title goes to the model; otherwise only rough ones.
  const needsRewrite = (text: string) => fixSpelling || isRough(text, draft.links.length > 0);
  const unsureIn = (text: string) =>
    fixSpelling ? draft.unsure.filter((unsure) => new RegExp(`\\b${escaped(unsure.word)}\\b`, "i").test(text)) : [];
  const [isWorking, setIsWorking] = useState(
    appleIntelligence && (Boolean(hint) || needsRewrite(draft.title) || unsureIn(draft.title).length > 0),
  );

  useEffect(() => {
    if (!appleIntelligence) return;
    let isCurrent = true;
    const warn = (failure: Error) => {
      if (isCurrent && !warnedAboutAppleIntelligence) {
        warnedAboutAppleIntelligence = true;
        showToast({ style: Toast.Style.Failure, title: "Apple Intelligence Unavailable", message: failure.message });
      }
      return null;
    };
    // Words the spell checker wasn't sure of go to the model first, then grammar or a rough title.
    const polish = async (text: string): Promise<string | null> => {
      let next = text;
      const picks = await Promise.all(unsureIn(text).map((unsure) => pickSpelling(text, unsure).catch(warn)));
      unsureIn(text).forEach((unsure, index) => {
        const pick = picks[index];
        if (!pick) return;
        next = next.replace(new RegExp(`\\b${escaped(unsure.word)}\\b`, "i"), (typed) =>
          typed[0] === typed[0].toUpperCase() ? pick.charAt(0).toUpperCase() + pick.slice(1) : pick,
        );
      });
      const rewritten = needsRewrite(next) ? await rewriteTitle(next, fixSpelling).catch(warn) : null;
      const result = rewritten ?? next;
      return result === text ? null : result;
    };
    const known = cachedLists();
    const picking = hint
      ? (known.length > 0 ? Promise.resolve(known) : loadLists()).then((found) => pickList(hint.name, found)).catch(warn)
      : Promise.resolve(null);

    Promise.all([picking, polish(draft.title)])
      .then(async ([picked, polished]) => {
        if (!isCurrent) return;
        let next = polished;
        if (hint && picked) {
          listPicked.current = true;
          setListId(picked);
        } else if (hint) {
          // No list fits, so the list words go back into the title, then get the same polish.
          next = (await polish(hint.title)) ?? hint.title;
        }
        if (isCurrent && next && !titleEdited.current) showTitle(next);
      })
      .finally(() => isCurrent && setIsWorking(false));
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
    const finalTitle = title.trim();
    if (!finalTitle) {
      await showToast({ style: Toast.Style.Failure, title: "Add a Title" });
      return;
    }
    setIsAdding(true);
    // Once the reminder is added, a name like "grocery" goes to that list next time, whether the
    // model picked it or the person did. Going back without adding remembers nothing.
    if (draft.hint && (listPicked.current || listChosen.current)) rememberPick(draft.hint.name, listId);
    const reminder = {
      title: finalTitle,
      // With the Notes field hidden, links still go in the notes.
      notes: showNotes ? notes.trim() : draft.links.join("\n"),
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
      isLoading={isWorking || (showList && isLoadingLists && lists.length === 0) || isAdding}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Reminder" icon={Icon.Plus} onSubmit={add} />
          <EditTextAction onEdit={onEdit} />
          <ClearCacheAction />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        value={title}
        onChange={(value) => {
          // Tinycast can echo a value Remind set; only a real edit keeps the person's title.
          if (value === shownTitle.current) return;
          titleEdited.current = true;
          showTitle(value);
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
        <Form.Dropdown
          id="list"
          title="List"
          value={listId}
          onChange={(value) => {
            if (value !== listId) listChosen.current = true;
            setListId(value);
          }}
        >
          {lists.map((list) => (
            <Form.Dropdown.Item key={list.id} value={list.id} title={listLabel(list, lists)} />
          ))}
        </Form.Dropdown>
      ) : null}
      {showNotes ? (
        <Form.TextArea
          id="notes"
          title="Notes"
          value={notes}
          onChange={setNotes}
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
function FromText({ text, onEdit }: { text: string; onEdit?: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    let isCurrent = true;
    const known = cachedLists();
    const lists = known.length > 0 ? Promise.resolve(known) : loadLists().catch(() => []);
    Promise.all([detect(text), lists])
      .then(([reading, found]) => isCurrent && setDraft(draftFor(reading, found)))
      .catch((failure: Error) => {
        if (!isCurrent) return;
        setDraft({ text, title: text, date: null, hasTime: false, listId: null, hint: null, links: [], unsure: [] });
        showToast({ style: Toast.Style.Failure, title: "Date Unavailable", message: failure.message });
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  // Opened from root search there's no typing screen underneath, so Remind reopens on one.
  const edit = () =>
    launchCommand({ name: "remind", type: LaunchType.UserInitiated, fallbackText: text, context: { edit: true } });

  return draft ? <Review draft={draft} onEdit={onEdit ?? edit} /> : <Form isLoading />;
}

export default function Command(props: LaunchProps<{ launchContext: { edit?: boolean } }>) {
  const fallbackText = props.fallbackText?.trim();
  // Tinycast puts the text in the search field itself, so editing opens the typing screen.
  return fallbackText && !props.launchContext?.edit ? <FromText text={fallbackText} /> : <Search />;
}

function Search() {
  const { pop } = useNavigation();
  const [searchText, setSearchText] = useState("");
  const [found, setFound] = useState<{ typed: string; reading: Reading } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { lists } = useLists();
  const typed = searchText.trim();
  const draft = found && typed ? draftFor(found.reading, lists) : null;
  const namedList = draft?.listId ? lists.find((list) => list.id === draft.listId) : undefined;
  const listTitle = namedList ? listLabel(namedList, lists) : undefined;

  useEffect(() => {
    setError(null);
    if (!typed) {
      setFound(null);
      setIsLoading(false);
      return;
    }
    // Text already read, like after a backspace, shows at once with no pause.
    const known = detections.get(readingKey(typed));
    if (known) {
      setFound({ typed, reading: known });
      setIsLoading(false);
      return;
    }
    let isCurrent = true;
    setIsLoading(true);
    const timer = setTimeout(() => {
      detect(typed)
        .then((reading) => isCurrent && setFound({ typed, reading }))
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
              <Action.Push
                title="Review Reminder"
                icon={Icon.Pencil}
                target={
                  // ↵ before the latest text is read reviews that text, never the one before it.
                  found?.typed === typed ? <Review draft={draft} onEdit={pop} /> : <FromText text={typed} onEdit={pop} />
                }
              />
              <ClearCacheAction />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}
