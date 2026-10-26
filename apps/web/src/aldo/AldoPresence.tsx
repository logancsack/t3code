// Aldo’s Home presence: its mark, name and what it's at. It opens an index of
// four lists (what needs you, what moved since you looked, what's working,
// what's coming up), each a count and a line; tapping one opens its list, and
// each item there opens its thread.

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { cn } from "~/lib/utils";
import { ThreadLink } from "./AldoHomeInbox";
import { useAldoAssistant } from "./assistantSession";
import { type AldoHome } from "./homeApi";
import { AldoHiddenFromChat, DismissChatDecision } from "./DismissChatDecision";
import { aldoHiddenFromChat } from "./decisions.logic";
import { AldoFrame } from "./AldoFrame";
import { boardFor, elapsed, isStuck } from "./home.logic";
import { useAldoHomeReadAt } from "./homeFeed";
import { setAldoUnderTheHood } from "./simpleMode";
import { parseAldoPlans } from "./plans.logic";
import {
  FRESH_MS,
  presenceBoard,
  presenceLine,
  readIsFresh,
  type PresenceRow,
  type PresenceSection,
  type PresenceTone,
} from "./presence.logic";
import { useAldoReceipts } from "./receipts";
import "./presence.css";

const SEEN_KEY = "aldo:presence:seen";

/** When they last closed the drop-down on this device, for what's moved since. */
function readSeen(): number | null {
  try {
    const at = Number(window.localStorage.getItem(SEEN_KEY));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

function writeSeen(at: number): void {
  try {
    window.localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // No storage: what moved shows again next time.
  }
}

type View = "index" | "needsYou" | "moved" | "working" | "coming";

const TITLES: Record<Exclude<View, "index">, string> = {
  needsYou: "Needs you",
  moved: "Moved since you looked",
  working: "Working",
  coming: "Coming up",
};

const DOT: Record<PresenceTone, string> = {
  good: "bg-success",
  bad: "bg-destructive",
  attention: "bg-warning",
  live: "animate-pulse bg-primary motion-reduce:animate-none",
  quiet: "border border-muted-foreground/60",
};

const ROW =
  "flex min-h-[52px] w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring";

/** The top of Aldo's conversation: its mark, name and what it's at, opening what needs you, moved, is working and is coming up. */
export function AldoPresence(props: {
  readonly home: AldoHome | null;
  readonly now: number;
  /** The home read failed before anything was read. */
  readonly unread?: boolean;
}) {
  const { home, now } = props;
  const phase = useAldoAssistant((s) => s.phase);
  const replying = useAldoAssistant((s) => s.replying);
  // What was just decided here no longer waits, though the home read still has it.
  const receipts = useAldoReceipts((s) => s.receipts);
  const readAt = useAldoHomeReadAt((s) => s.at);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("index");
  // What moved is counted from when they last closed this; it holds while it's open, so a list doesn't change as it's read.
  const [seenAt, setSeenAt] = useState(readSeen);
  const opened = useRef(false);
  // Leaving by opening a thread from it counts as closing it.
  useEffect(
    () => () => {
      if (opened.current) writeSeen(Date.now());
    },
    [],
  );
  const board = useMemo(
    () =>
      home ? presenceBoard(home, { now, seenAt, answered: receipts.map((r) => r.key) }) : null,
    [home, now, seenAt, receipts],
  );
  const working = useMemo(
    () => (home ? boardFor(home.conversations, now).working.filter((c) => !isStuck(c, now)) : []),
    [home, now],
  );
  const line = presenceLine({
    phase,
    replying,
    working,
    stuck: board?.stuck ?? 0,
    waiting: board?.needsYou.rows.length ?? 0,
    moved: board?.moved.rows.length ?? 0,
    fresh: readIsFresh(readAt, now),
    unread: props.unread === true,
  });
  const mark = (
    <>
      <AldoFrame size={40} state={line.state} aware />
      <span className="sr-only">Aldo: </span>
      <span
        className={cn(
          "flex max-w-64 items-center gap-1.5 text-[13px] text-muted-foreground leading-[18px] sm:max-w-80",
          line.dim && "opacity-60",
        )}
      >
        {line.dot ? (
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              line.dot === "needs-you" ? "bg-warning" : "bg-primary",
            )}
          />
        ) : null}
        <span className="truncate">{line.text}</span>
        {board ? (
          <ChevronDownIcon aria-hidden className="size-3 shrink-0 opacity-60" strokeWidth={2} />
        ) : null}
      </span>
    </>
  );
  const layout = "flex flex-col items-center gap-1 rounded-2xl px-3 py-1 outline-none";
  if (!home || !board)
    return (
      <div className={layout} data-aldo-presence="">
        {mark}
      </div>
    );
  const sections: Record<Exclude<View, "index">, PresenceSection> = {
    needsYou: board.needsYou,
    moved: board.moved,
    working: board.working,
    coming: board.coming,
  };
  // Put off (Not now) waits, but isn't counted: it's listed under what needs you, to bring back.
  const putOff = aldoHiddenFromChat(home, now).filter((item) => item.chatDecision.until);
  const plans = parseAldoPlans(home.plans);
  const age = now - readAt;
  const freshness =
    readAt === 0
      ? "From your last visit"
      : age < 60_000
        ? "Updated just now"
        : `Updated ${elapsed(new Date(readAt).toISOString(), now)} ago`;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        opened.current = next;
        setOpen(next);
        if (next) {
          setView("index");
          setSeenAt(readSeen());
        } else {
          const at = Date.now();
          writeSeen(at);
          setSeenAt(at);
        }
      }}
    >
      <PopoverTrigger
        className={cn(
          layout,
          "transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label={`Aldo: ${line.text}`}
        data-aldo-presence=""
      >
        {mark}
      </PopoverTrigger>
      <PopoverPopup width="lg" padding="compact" align="center">
        <div className="flex max-h-[min(34rem,calc(100dvh-9rem))] flex-col overflow-y-auto py-1">
          {view === "index" ? (
            <>
              <ul className="flex flex-col">
                <IndexRow
                  tone="attention"
                  title={TITLES.needsYou}
                  section={board.needsYou}
                  openable={board.needsYou.rows.length + board.putOff > 0}
                  onOpen={() => setView("needsYou")}
                />
                <IndexRow
                  tone="live"
                  title={TITLES.moved}
                  section={board.moved}
                  dot="bg-primary"
                  onOpen={() => setView("moved")}
                />
                <IndexRow
                  tone="live"
                  title={TITLES.working}
                  section={board.working}
                  onOpen={() => setView("working")}
                />
                <IndexRow
                  tone="quiet"
                  title={TITLES.coming}
                  section={board.coming}
                  onOpen={() => setView("coming")}
                />
              </ul>
              <div className="mt-1 border-foreground/[0.06] border-t pt-1">
                <button
                  type="button"
                  className={cn(ROW, "items-center")}
                  onClick={() => setAldoUnderTheHood(true)}
                >
                  <SlidersHorizontalIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 font-medium text-sm">Under the hood</span>
                  <ChevronRightIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex min-h-11 items-center gap-1">
                <button
                  type="button"
                  aria-label="Back"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setView("index")}
                >
                  <ChevronLeftIcon aria-hidden className="size-4" />
                </button>
                <h3 className="min-w-0 flex-1 truncate font-semibold text-sm">{TITLES[view]}</h3>
                {sections[view].rows.length > 0 ? (
                  <span className="pe-3 text-[12px] text-muted-foreground tabular-nums">
                    {sections[view].rows.length}
                  </span>
                ) : null}
              </div>
              <ul className="flex flex-col">
                {sections[view].rows.map((row) => (
                  <ItemRow key={row.key} row={row} />
                ))}
              </ul>
              {view === "needsYou" ? (
                <div className="mt-2 flex flex-col gap-3">
                  <AldoHiddenFromChat items={putOff} plans={plans} now={now} />
                </div>
              ) : null}
            </>
          )}
          <p className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground tabular-nums">
            {freshness}
            {age >= FRESH_MS || readAt === 0 ? " · checking" : ""}
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** One of the four lists in the index: a dot, its name, a line on what's in it, how many. */
function IndexRow(props: {
  readonly tone: PresenceTone;
  readonly title: string;
  readonly section: PresenceSection;
  /** Its dot where that isn't the tone's. */
  readonly dot?: string;
  /** Has something to open though its count is none (what's put off). */
  readonly openable?: boolean;
  readonly onOpen: () => void;
}) {
  const count = props.section.rows.length;
  const openable = props.openable ?? count > 0;
  return (
    <li>
      <button
        type="button"
        disabled={!openable}
        className={cn(
          ROW,
          "min-h-16 items-center disabled:opacity-60 disabled:hover:bg-transparent",
        )}
        onClick={props.onOpen}
      >
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", props.dot ?? DOT[props.tone])}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-[15px] leading-5">{props.title}</span>
          <span className="block truncate text-[12px] text-muted-foreground leading-4">
            {props.section.preview}
          </span>
        </span>
        {count > 0 ? (
          <span className="font-semibold text-xl tabular-nums leading-6">{count}</span>
        ) : null}
        {openable ? (
          <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </button>
    </li>
  );
}

/** An item in a list: opens its thread; one hidden from chat has a way to show it there again. */
function ItemRow(props: { readonly row: PresenceRow }) {
  const { row } = props;
  const body = (
    <>
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[row.tone])} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm leading-5">{row.title}</span>
        <span className="block truncate text-[12px] text-muted-foreground leading-4 tabular-nums">
          {row.detail}
        </span>
      </span>
    </>
  );
  return (
    <li className="flex items-center">
      {row.target ? (
        <ThreadLink target={row.target} className={cn(ROW, "flex-1")}>
          {body}
        </ThreadLink>
      ) : (
        <div className={cn(ROW, "flex-1 hover:bg-transparent")}>{body}</div>
      )}
      {row.hidden ? <DismissChatDecision decision={row.hidden} title={row.title} restore /> : null}
    </li>
  );
}
