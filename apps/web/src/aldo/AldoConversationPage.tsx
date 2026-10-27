// The home screen as a conversation with Aldo (AldoHome.tsx), made like a
// messaging app's chat with a teammate. At the top, Aldo’s mark and what it's
// at (AldoPresence.tsx), which opens what's working and coming up. Then the
// conversation, with what happened to the user's agents where it happened
// (feed.logic.ts, AldoFeed.tsx), and what waits on the user where it came up, as
// cards to answer in place (a plan to start, AldoPlanCard.tsx; the rest,
// AldoUpNext.tsx), so nothing needs a view of its own. Then the composer.
// Before anything's been said, the page is Aldo’s mark, one question and the
// composer under it, which glides down to its place with the first message
// (the same composer: what's typed and focus stay). Scrolled up, what arrives
// waits behind "New from Aldo". A thread tapped anywhere in it opens: the
// thread itself, where its agent is. Setup, and what's wrong with it, come
// first.

import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { ArrowDownIcon } from "lucide-react";

import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "~/lib/utils";
import { AldoAtAGlance, AldoCaption, AldoComposer, AldoConversation } from "./AldoAssistant";
import { HealthStrip } from "./AldoHomeBoard";
import { AldoOpenContext } from "./AldoLiveCard";
import { AldoPresence } from "./AldoPresence";
import { AldoFrame } from "./AldoFrame";
import { AldoUpNext } from "./AldoUpNext";
import { settleAldoConversation, unsettleAldoConversation } from "./arrive";
import { showAldoCards } from "./assistantApi";
import { seedAldoComposer, useAldoAssistant } from "./assistantSession";
import { type AldoHome, type AldoHomeTarget } from "./homeApi";
import { aldoChatDecisions, aldoWaitingCount, decisionAt, pausedInChat } from "./decisions.logic";
import { AldoComputerRequest } from "./AldoComputerRequest";
import { computerRequests, dismissedNeedsYou, pendingNeedsYou } from "./needsYou.logic";
import { NeedsYouPill } from "./NeedsYouPill";
import { COMPOSER_ACTION, HomeComposerActions } from "./HomeComposerActions";
import { feedEvents, withPlans, withReceipts } from "./feed.logic";
import { parseAldoPlans } from "./plans.logic";
import { useAldoFirstViewHold } from "./firstView";
import type { healthIssues } from "./home.logic";
import { useAldoReceipts } from "./receipts";
import { acknowledgeAldo } from "./presenceReactions";
import { aldoGlide, aldoMorphSource, morphIntoThread } from "./morph";
import { refreshAldoHome } from "./homeFeed";
import { scrollMotion } from "./show";
import { SECONDARY, SURFACE } from "./surface";

function inField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    typing(element) || element.tagName === "BUTTON" || element.closest("[role=dialog]") !== null
  );
}

/** Words being typed in. */
function typing(element: HTMLElement | null): boolean {
  return (
    element !== null &&
    (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
  );
}

/** The cards this page shows for what Aldo would otherwise say in words. */
const CARDS: ReadonlyArray<string> = ["plan"];

/** Within this of the end, the user is at the end. */
const AT_END_PX = 48;
/** History gets the first view briefly; a stalled read must not hide the rest of Home. */
const HISTORY_WAIT_MS = 8_000;

/**
 * Keeps the conversation at its end while the user is there, as what's above
 * it loads (what's wrong) and as the window narrows it; scrolled up, it
 * stays put, and says when something new arrived below (true until they're
 * back at the end). Not before anything's been said: that page reads from
 * the top.
 */
function useStickToBottom(ref: RefObject<HTMLDivElement | null>, enabled: boolean): boolean {
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    // Position cached or newly loaded history before its first paint. The
    // observer only follows later size changes; installing it after paint flashes the top.
    element.scrollTop = element.scrollHeight;
    let atEnd = true;
    let size = `${element.scrollHeight}:${element.clientHeight}`;
    let height = element.scrollHeight;
    const onScroll = () => {
      // A scroll the layout made as what's on the page grew (the cards at the end
      // arriving, the composer growing) isn't the user leaving the end.
      if (`${element.scrollHeight}:${element.clientHeight}` !== size) return;
      atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < AT_END_PX;
      if (atEnd) setBelow(false);
    };
    const observer = new ResizeObserver(() => {
      if (atEnd) element.scrollTop = element.scrollHeight;
      else if (element.scrollHeight > height + 1) setBelow(true);
      size = `${element.scrollHeight}:${element.clientHeight}`;
      height = element.scrollHeight;
    });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, [ref, enabled]);
  return below && enabled;
}

/**
 * The empty page splits the room around its question and composer by a fixed
 * share, a little above the middle, so the first run's starters under it
 * scrolled (by 6px at 820px tall, half a row at 720) with the space over the
 * question standing empty. Short of their share, their box takes what they
 * need instead, the space over the question the rest down to its least, and
 * it gives way first when the page runs short (the composer grows, the window
 * shrinks), so the question keeps its place. Decided again a frame after a
 * change: a size set as the observer reports one is a loop it reports as an
 * error, which the splash takes for a failed start.
 */
function useStartersRoom(enabled: boolean): {
  readonly above: RefObject<HTMLDivElement | null>;
  readonly below: RefObject<HTMLDivElement | null>;
} {
  const above = useRef<HTMLDivElement>(null);
  const below = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const spacer = above.current;
    const box = below.current;
    const starters = box?.firstElementChild;
    if (!enabled || !spacer || !box || !starters) return;
    const fit = () => {
      box.style.flex = "";
      if (box.scrollHeight > box.clientHeight) box.style.flex = "0 1000 auto";
    };
    fit();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    for (const element of [spacer, box, starters]) observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      box.style.flex = "";
    };
  }, [enabled]);
  return { above, below };
}

export function AldoConversationPage(props: {
  readonly home: AldoHome | null;
  /** Whether this Aldo has the home read; null until it's known. */
  readonly supported: boolean | null;
  /** Why the home read failed, if it did. */
  readonly error: string | null;
  readonly now: number;
  /** Simple mode's places, on a phone: at the foot, under the composer. */
  readonly tabs: ReactNode;
  /** At the top's end, on a wider screen: what to start. */
  readonly actions: ReactNode;
  /** Under the empty conversation's welcome: the first run's starters. */
  readonly welcome: ReactNode;
  readonly issues: ReturnType<typeof healthIssues>;
  readonly chips: ReadonlyArray<string>;
  readonly onChip: (chip: string) => void;
}) {
  const { home, now } = props;
  const navigate = useNavigate();
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);

  // What's there once the conversation has loaded is just there; what comes after arrives.
  useEffect(() => () => unsettleAldoConversation(), []);
  // A plan Aldo proposes here is a card (AldoPlanCard.tsx), while Home reads well and has its plans
  // (an Aldo with them); elsewhere, or while it doesn't, Aldo says the plan in words.
  const cardsShow = home !== null && props.error === null && home.plans !== undefined;
  useEffect(() => (cardsShow ? showAldoCards(CARDS) : undefined), [cardsShow]);
  useEffect(() => {
    // Acknowledge the user returning to Home.
    const onVisible = () => {
      if (document.visibilityState === "visible") acknowledgeAldo();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // What happened, from where the conversation starts; local actions already show themselves.
  const entries = useAldoAssistant((s) => s.entries);
  const here = useMemo(
    () =>
      entries.flatMap((e) =>
        e.kind === "action" && !e.failed ? [{ tool: e.tool, thread: e.open ?? null }] : [],
      ),
    [entries],
  );
  // What Aldo said: a thread it told the user about needs no line of its own.
  const told = useMemo(
    () =>
      entries.flatMap((e) =>
        e.kind === "message" && e.role === "assistant" ? [{ text: e.text, at: e.at }] : [],
      ),
    [entries],
  );
  const loaded = useAldoAssistant((s) => s.historyLoaded);
  const [historySlow, setHistorySlow] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const timer = window.setTimeout(() => setHistorySlow(true), HISTORY_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [loaded]);
  const firstAt = useAldoAssistant((s) => {
    const first = s.entries.find((e) => e.kind === "message");
    return first?.kind === "message" ? first.at : null;
  });
  const said = useAldoAssistant((s) => s.entries.length > 0 || s.replying);
  // Newly sent words and replies show even while earlier messages are pending.
  const loading = !loaded && !said && !historySlow;
  useAldoFirstViewHold(loading);
  const receipts = useAldoReceipts((s) => s.receipts);
  // Plans keep their proposal time through Start and subsequent reads.
  // One dismissed from Needs you leaves the conversation too, as a prompt hidden from chat does.
  const plans = useMemo(
    () =>
      parseAldoPlans(home?.plans).filter(
        (p) => p.status !== "proposed" || !p.chatDecision?.cleared,
      ),
    [home],
  );
  const feed = useMemo(
    () =>
      withReceipts(
        home
          ? withPlans(feedEvents(home, { now, from: firstAt, here, told }), plans, {
              now,
              // Pending plans remain reachable even before the loaded message window.
              from: null,
            })
          : [],
        receipts.filter(
          (r) => !home?.approvals?.some((a) => `aldo:${a.id}` === r.key && a.status !== "pending"),
        ),
      ),
    [home, now, firstAt, here, told, receipts, plans],
  );
  // Every interactive card uses its creation time, including decided approvals
  // supplied by persisted history. Local receipts replace pending cards in place.
  const decisions = useMemo(() => {
    if (!home) return [];
    return [
      ...aldoChatDecisions(home, now)
        .filter(
          (d) =>
            !receipts.some((r) => r.key === d.key) &&
            !(d.kind === "waiting" && d.conversation.computers?.some((c) => c.status === "asked")),
        )
        .map((d) => ({ key: d.key, at: decisionAt(d, home) })),
      ...(home.approvals ?? [])
        .filter(
          (a) => a.status !== "pending" && a.status !== "withdrawn" && !a.chatDecision?.dismissed,
        )
        .map((a) => ({ key: `aldo:${a.id}`, at: a.createdAt })),
      ...pausedInChat(home, now)
        .filter((c) => !c.computers?.some((computer) => computer.status === "asked"))
        .map((c) => ({ key: `paused:${c.ref}`, at: c.stateAt ?? c.at })),
    ];
  }, [home, now, receipts]);
  const pending = useMemo(
    () =>
      home
        ? pendingNeedsYou(
            home,
            now,
            receipts.map((r) => r.key),
          )
        : [],
    [home, now, receipts],
  );
  const computers = useMemo(
    () =>
      home ? computerRequests(home).filter((c) => pending.some((item) => item.key === c.key)) : [],
    [home, pending],
  );
  const placed = useMemo(
    () => [...decisions, ...computers.map(({ key, at }) => ({ key, at }))],
    [decisions, computers],
  );
  const renderDecisions = useCallback(
    (keys: ReadonlyArray<string> | null, placedAt: ReadonlyMap<string, string>) =>
      home ? (
        <>
          <AldoUpNext home={home} now={now} only={keys} placedAt={placedAt} />
          {computers
            .filter((c) => keys?.includes(c.key))
            .map((request) => (
              <AldoComputerRequest key={request.key} request={request} />
            ))}
        </>
      ) : null,
    [home, now, computers],
  );
  const waiting = useMemo(() => (home ? aldoWaitingCount(home, now) : 0), [home, now]);
  // Nothing read yet, and the read failed: that's said, not taken for nothing to show.
  const unread = home === null && props.error !== null;
  // What they dismissed from Needs you keeps the header (and so the way to restore it).
  const dismissed = useMemo(() => (home ? dismissedNeedsYou(home, now).length : 0), [home, now]);
  // Nothing said, nothing happened and nothing waiting: the page is one question.
  // An older Aldo without the home read shows its overview, which the empty page has no room for.
  const fresh =
    loaded &&
    !said &&
    feed.length === 0 &&
    placed.length === 0 &&
    waiting === 0 &&
    dismissed === 0 &&
    !unread &&
    props.supported !== false;
  useEffect(() => {
    if (!loaded || !home) return;
    // Past the first paint of what was there: from now on, what appears arrives.
    const frame = requestAnimationFrame(() => settleAldoConversation());
    return () => cancelAnimationFrame(frame);
  }, [loaded, home]);
  const below = useStickToBottom(scroller, !loading && !fresh);
  const dock = useRef<HTMLDivElement>(null);
  const { above: roomAboveRef, below: startersRef } = useStartersRoom(
    fresh && Boolean(props.welcome),
  );
  // A thread tapped in the conversation opens: the thread itself, growing out of what was tapped.
  const openThread = useCallback(
    (target: AldoHomeTarget, from?: HTMLElement | null) => {
      const morph = morphIntoThread(router, from ? (aldoMorphSource(from) ?? from) : null);
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: target.environmentId as EnvironmentId,
          threadId: target.threadId as ThreadId,
        },
        viewTransition: morph,
      });
    },
    [navigate, router],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || inField(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        seedAldoComposer("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const conversation = (
    <AldoConversation feed={feed} decisions={placed} renderDecisions={renderDecisions} />
  );
  const column = "mx-auto w-full max-w-[640px] px-4 sm:px-6";
  // The empty page's few things to say (the first run's starters say them instead);
  // once something's been said, the composer stands alone.
  const chips = fresh && !props.welcome ? props.chips.slice(0, 3) : [];

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <AldoOpenContext.Provider value={openThread}>
        <div className="flex h-full min-h-0 min-w-0">
          <div className="group/page flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Centered, clear of the sidebar's button, which floats at the top left on a phone. */}
            <header className="relative flex min-h-14 shrink-0 flex-col items-center justify-center px-4 pt-2 pb-1 sm:px-6">
              {fresh ? null : <AldoPresence home={home} now={now} unread={unread} />}
              {props.actions ? (
                <div className="absolute end-3 top-2.5 hidden sm:block">{props.actions}</div>
              ) : null}
            </header>
            {/* The empty page centers its question and composer, a little above the middle; then it's the conversation over the composer. */}
            {fresh ? <div ref={roomAboveRef} aria-hidden className="min-h-4 flex-[1_1_0]" /> : null}
            <div
              ref={scroller}
              aria-busy={loading}
              className={cn(
                // Never sideways: what's too wide for the column wraps or scrolls inside its own box.
                fresh
                  ? "min-h-0 shrink overflow-x-hidden overflow-y-auto"
                  : "relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]",
              )}
            >
              {loading ? (
                <div
                  role="status"
                  className="grid min-h-full place-content-center text-sm text-muted-foreground"
                >
                  Loading conversation…
                </div>
              ) : fresh ? (
                <div className={cn(column, "flex flex-col gap-6")}>
                  <HealthStrip issues={props.issues} />
                  <div className="flex flex-col items-center text-center">
                    <AldoFrame size={48} aware />
                    <h1 className="mt-5 font-semibold text-[24px] leading-[30px] tracking-[-0.02em] sm:text-[28px] sm:leading-[34px]">
                      What should we get done?
                    </h1>
                    <p className="mt-2 max-w-md text-balance text-[14px] text-muted-foreground leading-5">
                      Tell me what you need. I'll get it moving and keep you posted.
                    </p>
                  </div>
                </div>
              ) : (
                <div
                  className={cn(
                    column,
                    // Words with no break in them (a link, a path, a token) wrap at the column's edge.
                    "min-w-0 wrap-anywhere",
                    "flex flex-col gap-4 pt-3 pb-6",
                  )}
                >
                  <HealthStrip issues={props.issues} />
                  {unread ? <HomeUnread error={props.error!} /> : null}
                  {props.supported === false ? <AldoAtAGlance /> : null}
                  {conversation}
                  {!loaded && historySlow ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      Earlier messages are taking longer to load. You can keep talking to Aldo.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            {/* The same composer, empty page or not, so what's typed and focus stay as it glides into place. */}
            <div className="relative shrink-0" data-aldo-assistant-footer="">
              {/* The actions have their own room, clear of messages, captions and the input. */}
              <div className={column}>
                <HomeComposerActions active={below || (!fresh && !loading && pending.length > 0)}>
                  {fresh || loading ? null : <NeedsYouPill scroller={scroller} items={pending} />}
                  {below ? (
                    <button
                      type="button"
                      className={COMPOSER_ACTION}
                      onClick={() =>
                        scroller.current?.scrollTo({
                          top: scroller.current.scrollHeight,
                          behavior: scrollMotion(),
                        })
                      }
                    >
                      {!fresh && !loading && pending.length > 0 ? (
                        <span
                          aria-hidden
                          className="absolute inset-y-3.5 start-0 w-px bg-foreground/[0.10]"
                        />
                      ) : null}
                      <ArrowDownIcon aria-hidden className="size-4 shrink-0" strokeWidth={2} />
                      <span className="min-w-0 wrap-anywhere">New from Aldo</span>
                    </button>
                  ) : null}
                </HomeComposerActions>
              </div>
              <div
                ref={dock}
                className={cn(
                  column,
                  "flex flex-col items-center gap-2",
                  fresh
                    ? "pt-6"
                    : props.tabs
                      ? "pt-1"
                      : "pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
                )}
              >
                <AldoCaption />
                <AldoComposer
                  chips={chips}
                  onChip={props.onChip}
                  {...(fresh
                    ? { onSend: (send: () => void) => aldoGlide(dock.current, send) }
                    : {})}
                />
              </div>
            </div>
            {fresh ? (
              <div
                ref={startersRef}
                className={cn(
                  "flex min-h-6 flex-[1.4_1_0] flex-col overflow-y-auto",
                  props.tabs ? "pb-3" : "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
                )}
              >
                {props.welcome ? <div className={cn(column, "pt-4")}>{props.welcome}</div> : null}
              </div>
            ) : null}
            {props.tabs ? (
              <div className="shrink-0 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {props.tabs}
              </div>
            ) : null}
          </div>
        </div>
      </AldoOpenContext.Provider>
    </SidebarInset>
  );
}

/** The home read failed before anything was read: what's waiting and working isn't known, so it isn't shown as nothing. */
function HomeUnread(props: { readonly error: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="status"
      className={cn(SURFACE, "flex items-center gap-3 px-4 py-3 text-[14px] leading-5")}
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium">Couldn't check on your agents.</span>{" "}
        <span className="text-muted-foreground">{props.error}</span>
      </span>
      <button
        type="button"
        className={cn(SECONDARY, "h-9 shrink-0 px-4 text-sm")}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void refreshAldoHome().finally(() => setBusy(false));
        }}
      >
        {busy ? "Trying…" : "Try again"}
      </button>
    </div>
  );
}
