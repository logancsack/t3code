// Aldo’s Home presence: its mark, name and what it's at. It opens an index of
// four lists (what needs you, what moved since you looked, what's working,
// what's coming up), each a count and a line; tapping one opens its list, and
// each item there opens its thread. A working one goes to its card in the
// conversation instead, opened, with the step it's on in its line, the way
// its card says it; one the conversation has no card for opens its thread.

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { cn } from "~/lib/utils";
import { ThreadLink } from "./AldoHomeInbox";
import { useAldoLiveNow, useAldoLiveWork } from "./liveWork";
import { liveLineOf, liveLineText } from "./liveWork.logic";
import { showAldoThreadCard } from "./show";
import { useAldoAssistant } from "./assistantSession";
import { type AldoHome, type AldoHomeTarget } from "./homeApi";
import { AldoHiddenFromChat, DismissChatDecision } from "./DismissChatDecision";
import { aldoHiddenFromChat } from "./decisions.logic";
import { AldoFrame } from "./AldoFrame";
import { dismissNeedsYou, restoreNeedsYou } from "./clearNeedsYou";
import {
  clearDismissed,
  CLEAR_UNDO_MS,
  sendClearedDismissed,
  undoClearDismissed,
  useAldoClearing,
} from "./clearDismissed";
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
import { isSideways, swipedAway } from "./swipeAway.logic";
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

type View = "index" | "needsYou" | "dismissed" | "moved" | "working" | "coming";

const TITLES: Record<Exclude<View, "index">, string> = {
  needsYou: "Needs you",
  dismissed: "Dismissed",
  moved: "Moved since you looked",
  working: "Working",
  coming: "Coming up",
};

const DOT: Record<PresenceTone, string> = {
  good: "bg-success",
  bad: "bg-destructive",
  attention: "bg-warning",
  live: "bg-primary",
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
  const [asked, setView] = useState<View>("index");
  // What they just dismissed, with an Undo while it's fresh (a toast would sit behind the open list).
  const [note, setNote] = useState<{
    text: string;
    sub?: string;
    undo?: () => void;
  } | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), CLEAR_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [note]);
  const dismiss = (ids: ReadonlyArray<string>, what: string) => {
    setNote({
      text: `Dismissed ${what}`,
      sub: "Still waiting in its thread. Nothing was answered.",
      undo: () => restore(ids, null),
    });
    dismissNeedsYou(ids).catch(() => setNote({ text: "Couldn't dismiss it" }));
  };
  // Gone from Dismissed at once; their threads are archived when the undo time is up (clearDismissed.ts).
  const clearing = useAldoClearing();
  const clearingIds = useMemo(() => new Set(clearing), [clearing]);
  const clear = (ids: ReadonlyArray<string>, what: string) => {
    setNote({
      text: `Cleared ${what}`,
      sub: "Threads are archived, not deleted.",
      undo: () => {
        undoClearDismissed();
        setNote(null);
      },
    });
    clearDismissed(ids, () => setNote({ text: "Couldn't clear it" }));
  };
  const restore = (ids: ReadonlyArray<string>, then: string | null) => {
    setNote(then ? { text: then } : null);
    restoreNeedsYou(ids).catch(() => setNote({ text: "Couldn't restore it" }));
  };
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
      home
        ? presenceBoard(home, {
            now,
            seenAt,
            answered: receipts.map((r) => r.key),
            clearing: clearingIds,
          })
        : null,
    [home, now, seenAt, receipts, clearingIds],
  );
  const working = useMemo(
    () => (home ? boardFor(home.conversations, now).working.filter((c) => !isStuck(c, now)) : []),
    [home, now],
  );
  const change = (next: boolean) => {
    opened.current = next;
    setOpen(next);
    setNote(null);
    // Closing ends the time to undo.
    if (!next) void sendClearedDismissed();
    if (next) {
      setView("index");
      setSeenAt(readSeen());
    } else {
      const at = Date.now();
      writeSeen(at);
      setSeenAt(at);
    }
  };
  // To a working thread's card, closing this; false where the conversation has none.
  const showCard = (target: AldoHomeTarget) => {
    if (!showAldoThreadCard(target)) return false;
    change(false);
    return true;
  };
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
  // Restoring the last dismissed item leaves an empty list: back to Needs you. Clearing it stays, with its Undo.
  const view =
    asked === "dismissed" && board.dismissed.length === 0 && !note?.undo ? "needsYou" : asked;
  const sections: Record<Exclude<View, "index">, PresenceSection> = {
    needsYou: board.needsYou,
    dismissed: { rows: board.dismissed, preview: "" },
    moved: board.moved,
    working: board.working,
    coming: board.coming,
  };
  // Put off (Not now) waits, but isn't counted: it's listed under what needs you, to bring back.
  const putOff = aldoHiddenFromChat(home, now).filter((item) => item.chatDecision.until);
  // What each Needs you row can dismiss (an Aldo that can't gives them no way to).
  const dismissable = board.needsYou.rows.filter((row) => row.decision);
  const plans = parseAldoPlans(home.plans);
  const age = now - readAt;
  const freshness =
    readAt === 0
      ? "From your last visit"
      : age < 60_000
        ? "Updated just now"
        : `Updated ${elapsed(new Date(readAt).toISOString(), now)} ago`;
  return (
    <Popover open={open} onOpenChange={change}>
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
                  openable={board.needsYou.rows.length + board.putOff + board.dismissed.length > 0}
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
                {view === "dismissed" && board.dismissed.length > 0 ? (
                  <button
                    type="button"
                    className="me-1 min-h-11 rounded-lg px-3 font-medium text-[13px] text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      clear(
                        board.dismissed.map((r) => r.decision!.id),
                        board.dismissed.length === 1
                          ? "1 thing"
                          : `${board.dismissed.length} things`,
                      )
                    }
                  >
                    Clear all
                  </button>
                ) : null}
                {view === "needsYou" && dismissable.length > 0 ? (
                  <button
                    type="button"
                    className="me-1 min-h-11 rounded-lg px-3 font-medium text-[13px] text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      dismiss(
                        dismissable.map((r) => r.decision!.id),
                        dismissable.length === 1 ? "1 thing" : `${dismissable.length} things`,
                      )
                    }
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
              {view === "dismissed" && board.dismissed.length === 0 ? (
                <p className="px-2 py-3 text-[13px] text-muted-foreground">Nothing dismissed</p>
              ) : null}
              {view === "needsYou" && sections.needsYou.rows.length === 0 ? (
                <p className="px-2 py-3 text-[13px] text-muted-foreground">
                  Nothing waiting on you
                </p>
              ) : null}
              <ul className="flex flex-col">
                {sections[view].rows.map((row) => (
                  <ItemRow
                    key={row.key}
                    row={row}
                    {...(view === "working" ? { onShow: showCard } : {})}
                    {...(view === "needsYou" && row.decision
                      ? { onDismiss: () => dismiss([row.decision!.id], `“${row.title}”`) }
                      : {})}
                    {...(view === "dismissed" && row.decision
                      ? {
                          onRestore: () => restore([row.decision!.id], null),
                          onClear: () => clear([row.decision!.id], `“${row.title}”`),
                        }
                      : {})}
                  />
                ))}
              </ul>
              {view === "needsYou" ? (
                <div className="mt-2 flex flex-col gap-3">
                  <AldoHiddenFromChat items={putOff} plans={plans} now={now} />
                  {board.dismissed.length > 0 ? (
                    <button
                      type="button"
                      className={cn(ROW, "min-h-11 items-center py-1.5 text-muted-foreground")}
                      onClick={() => setView("dismissed")}
                    >
                      <span className="min-w-0 flex-1 text-[13px]">Dismissed</span>
                      <span className="text-[12px] tabular-nums">{board.dismissed.length}</span>
                      <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
          {note ? (
            <div
              role="status"
              className="mt-1 flex items-center gap-2 rounded-lg bg-foreground/[0.06] ps-3"
            >
              <p className="min-w-0 flex-1 py-2 text-[13px] leading-4">
                <span className="block truncate">{note.text}</span>
                {note.sub ? (
                  <span className="block text-[12px] text-muted-foreground">{note.sub}</span>
                ) : null}
              </p>
              {note.undo ? (
                <button
                  type="button"
                  className="me-1 min-h-11 shrink-0 rounded-lg px-3 font-medium text-[13px] outline-none hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={note.undo}
                >
                  Undo
                </button>
              ) : null}
            </div>
          ) : null}
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

/** A working row's line: the step it's on, live, as its card says it; else what Aldo's read has. */
function LiveDetail(props: { readonly target: AldoHomeTarget; readonly fallback: string }) {
  const work = useAldoLiveWork(props.target);
  const now = useAldoLiveNow();
  const line = liveLineOf(work, now);
  return <>{line ? liveLineText(line, now) : props.fallback}</>;
}

/**
 * An item in a list: opens its thread. In Needs you it has a way to dismiss it (a ✕, and a swipe on a
 * phone); one hidden from chat has a way to show it there again; in Dismissed, a way to restore it
 * and to clear it for good (the same ✕ and swipe, and its title may take two lines for the room).
 */
function ItemRow(props: {
  readonly row: PresenceRow;
  readonly onDismiss?: () => void;
  readonly onRestore?: () => void;
  readonly onClear?: () => void;
  /** Goes to its card in the conversation instead of opening it; false where there's none. */
  readonly onShow?: (target: AldoHomeTarget) => boolean;
}) {
  const { row, onDismiss, onRestore, onClear, onShow } = props;
  const away = onDismiss ?? onClear;
  const word = onClear ? "Clear" : "Dismiss";
  const swipe = useSwipeAway(away);
  const body = (
    <>
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[row.tone])} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block font-medium text-sm leading-5",
            onClear ? "line-clamp-2" : "truncate",
          )}
        >
          {row.title}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground leading-4 tabular-nums">
          {onShow && row.target && row.tone === "live" ? (
            <LiveDetail target={row.target} fallback={row.detail} />
          ) : (
            row.detail
          )}
        </span>
      </span>
    </>
  );
  return (
    <li
      className="relative overflow-hidden"
      data-aldo-need-row=""
      // Its card, where the conversation has one, before the link opens the thread.
      onClickCapture={(event) => {
        const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey;
        if (!onShow || !row.target || !plain || !(event.target as HTMLElement).closest("a")) return;
        if (!onShow(row.target)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {swipe.dx !== 0 ? (
        <span
          aria-hidden
          style={{ width: Math.abs(swipe.dx) }}
          className={cn(
            "absolute inset-y-0 flex items-center justify-center overflow-hidden whitespace-nowrap bg-foreground/[0.06] font-medium text-[13px] text-muted-foreground",
            swipe.dx < 0 ? "right-0" : "left-0",
          )}
        >
          {word}
        </span>
      ) : null}
      <div
        {...swipe.handlers}
        style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
        className={cn(
          "relative",
          away && "touch-pan-y",
          swipe.settling && "transition-transform duration-150 motion-reduce:transition-none",
        )}
      >
        <div className="flex items-center">
          {row.target ? (
            <ThreadLink target={row.target} className={cn(ROW, "min-w-0 flex-1")}>
              {body}
            </ThreadLink>
          ) : (
            <div className={cn(ROW, "min-w-0 flex-1 hover:bg-transparent")}>{body}</div>
          )}
          {onRestore ? (
            <button
              type="button"
              aria-label={`Restore ${row.title}`}
              className="min-h-11 shrink-0 rounded-lg px-2.5 font-medium text-[13px] text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onRestore}
            >
              Restore
            </button>
          ) : null}
          {away ? (
            <button
              type="button"
              aria-label={`${word} ${row.title}`}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={away}
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
        {row.hidden ? (
          <div className="pb-1 ps-7">
            <DismissChatDecision decision={row.hidden} title={row.title} restore />
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * A row that a finger drags sideways and lets go of past the threshold: `onAway` (the row slides off
 * first). Pointer events with `touch-action: pan-y`, so scrolling the list stays the page's; a mouse
 * has the ✕ instead. A drag that moved the row doesn't also open the thread it sits on.
 */
function useSwipeAway(onAway: (() => void) | undefined) {
  // Bookkeeping that needs no render: where the finger went down, and whether this touch moved the row.
  const bookkeeping = useRef<{
    from: { x: number; y: number; id: number; taken: boolean } | null;
    moved: boolean;
  }>({ from: null, moved: false });
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  if (!onAway) return { dx: 0, settling: false, handlers: {} };
  const end = (event: PointerEvent, cancelled: boolean) => {
    const drag = bookkeeping.current;
    const start = drag.from;
    drag.from = null;
    if (!start?.taken) return;
    drag.moved = true;
    const sideways = { dx: event.clientX - start.x, dy: event.clientY - start.y };
    const width = event.currentTarget.clientWidth;
    setSettling(true);
    if (!cancelled && swipedAway(sideways, width)) {
      setDx(sideways.dx < 0 ? -width : width);
      window.setTimeout(onAway, 150);
    } else setDx(0);
  };
  return {
    dx,
    settling,
    handlers: {
      onPointerDown: (event: PointerEvent) => {
        if (event.pointerType !== "touch") return;
        const drag = bookkeeping.current;
        drag.moved = false;
        drag.from = { x: event.clientX, y: event.clientY, id: event.pointerId, taken: false };
        setSettling(false);
      },
      onPointerMove: (event: PointerEvent) => {
        const start = bookkeeping.current.from;
        if (!start || start.id !== event.pointerId) return;
        const sideways = { dx: event.clientX - start.x, dy: event.clientY - start.y };
        // A drag is the row's once it is mostly sideways; until then the page may still scroll.
        if (!start.taken && isSideways(sideways)) {
          start.taken = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        if (start.taken) setDx(sideways.dx);
      },
      onPointerUp: (event: PointerEvent) => end(event, false),
      onPointerCancel: (event: PointerEvent) => end(event, true),
      // The tap that ends a drag isn't a tap on the thread.
      onClickCapture: (event: MouseEvent) => {
        if (bookkeeping.current.moved) event.preventDefault();
        bookkeeping.current.moved = false;
      },
    },
  };
}
