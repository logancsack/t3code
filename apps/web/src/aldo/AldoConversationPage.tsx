// The home screen as a conversation with Aldo (AldoHome.tsx), made like a
// messaging app's chat with a teammate. At the top, Aldo's face and what it's
// at (AldoPresence.tsx), which opens what's working and coming up. Then the
// conversation, with what happened to the user's agents where it happened
// (feed.logic.ts, AldoFeed.tsx), and at its end what waits on the user, as
// cards to answer in place (AldoUpNext.tsx), so nothing needs a view of its
// own. Then the composer. Before anything's been said, the page is Aldo's
// face, one question and the composer under it, which glides down to its
// place with the first message (the same composer: what's typed and focus
// stay). Scrolled up, what arrives waits behind "New from Aldo". A thread
// opens in a peek beside the conversation (over it on a phone), so someone
// who only talks to Aldo never has to leave it; Aldo's show_thread, and the
// brief's things to decide, peek here too. Setup, and what's wrong with it,
// come first.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { ArrowDownIcon } from "lucide-react";

import { Sheet, SheetPopup } from "../components/ui/sheet";
import { SidebarInset } from "../components/ui/sidebar";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { AldoAtAGlance, AldoCaption, AldoComposer, AldoConversation } from "./AldoAssistant";
import { HealthStrip } from "./AldoHomeBoard";
import { AldoPeekContext } from "./AldoLiveCard";
import { AldoPeek, AldoPeekerContext, peekedConversation, type AldoPeekTarget } from "./AldoPeek";
import { AldoAvatar, AldoPresence } from "./AldoPresence";
import { AldoUpNext } from "./AldoUpNext";
import { settleAldoConversation, unsettleAldoConversation } from "./arrive";
import {
  loadAldoConversation,
  seedAldoComposer,
  setAldoThreadPeeker,
  useAldoAssistant,
} from "./assistantSession";
import type { AldoHome, AldoHomeTarget } from "./cloud";
import { aldoDecisions } from "./decisions.logic";
import { feedEvents, withReceipts } from "./feed.logic";
import type { healthIssues } from "./home.logic";
import { useAldoReceipts } from "./receipts";
import { blinkAldo } from "./face";
import { aldoGlide } from "./morph";
import { setAldoPeekedThread } from "./screen";
import { scrollMotion } from "./show";

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

/** Within this of the end, the user is at the end. */
const AT_END_PX = 48;

/**
 * Keeps the conversation at its end while the user is there, as what's above
 * it loads (setup, what's wrong) and as the peek narrows it; scrolled up, it
 * stays put, and says when something new arrived below (true until they're
 * back at the end). Not before anything's been said: that page reads from
 * the top.
 */
function useStickToBottom(ref: RefObject<HTMLDivElement | null>, enabled: boolean): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
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

export function AldoConversationPage(props: {
  readonly home: AldoHome | null;
  /** Whether this Aldo has the home read; null until it's known. */
  readonly supported: boolean | null;
  readonly now: number;
  /** Simple mode's places, on a phone: over Aldo's face. */
  readonly tabs: ReactNode;
  /** At the top's end, on a wider screen: what to start. */
  readonly actions: ReactNode;
  readonly setup: ReactNode;
  /** Under the empty conversation's welcome: the first run's starters. */
  readonly welcome: ReactNode;
  readonly issues: ReturnType<typeof healthIssues>;
  readonly chips: ReadonlyArray<string>;
  readonly onChip: (chip: string) => void;
}) {
  const { home, now } = props;
  const wide = useMediaQuery("(min-width: 1024px)");
  const [peek, setPeek] = useState<{ target: AldoPeekTarget; key: string | null } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadAldoConversation();
  }, []);
  // What's there once the conversation has loaded is just there; what comes after arrives.
  useEffect(() => () => unsettleAldoConversation(), []);
  useEffect(() => {
    // The user back at the page: Aldo notices, with a blink.
    const onVisible = () => {
      if (document.visibilityState === "visible") blinkAldo();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // What happened, from where the conversation starts; what Aldo does from here on it shows itself.
  const [opened] = useState(() => Date.now());
  const loaded = useAldoAssistant((s) => s.historyLoaded);
  const firstAt = useAldoAssistant((s) => {
    const first = s.entries.find((e) => e.kind === "message");
    return first?.kind === "message" ? first.at : null;
  });
  const said = useAldoAssistant((s) => s.entries.length > 0 || s.replying);
  const receipts = useAldoReceipts((s) => s.receipts);
  const feed = useMemo(
    () =>
      withReceipts(home ? feedEvents(home, { now, from: firstAt, until: opened }) : [], receipts),
    [home, now, firstAt, opened, receipts],
  );
  const waiting = useMemo(() => (home ? aldoDecisions(home, now).length : 0), [home, now]);
  // Nothing said, nothing happened and nothing waiting: the page is one question.
  const fresh = loaded && !said && feed.length === 0 && waiting === 0;
  useEffect(() => {
    if (!loaded || !home) return;
    // Past the first paint of what was there: from now on, what appears arrives.
    const frame = requestAnimationFrame(() => settleAldoConversation());
    return () => cancelAnimationFrame(frame);
  }, [loaded, home]);
  const below = useStickToBottom(scroller, !fresh);
  const dock = useRef<HTMLDivElement>(null);
  // What had focus when a peek opened, for it to go back to when it closes.
  const peekFrom = useRef<HTMLElement | null>(null);
  const peekAny = useCallback((target: AldoPeekTarget) => {
    peekFrom.current ??= document.activeElement as HTMLElement | null;
    setPeek({ target, key: null });
  }, []);

  const peekThread = useCallback(
    (target: AldoHomeTarget) => peekAny({ kind: "thread", target }),
    [peekAny],
  );
  const close = useCallback(() => {
    setPeek(null);
    const from = peekFrom.current;
    peekFrom.current = null;
    if (from?.isConnected && from !== document.body)
      requestAnimationFrame(() => from.focus({ preventScroll: true }));
  }, []);
  // A thread Aldo shows opens here rather than taking the page away.
  useEffect(() => {
    setAldoThreadPeeker(peekThread);
    return () => setAldoThreadPeeker(null);
  }, [peekThread]);

  // While a thread is peeked at, it's what Aldo hears is on screen.
  const peeked = peekedConversation(home, peek?.target ?? null);
  useEffect(() => {
    setAldoPeekedThread(
      peeked
        ? {
            environmentId: peeked.thread.environmentId,
            threadId: peeked.thread.threadId,
            title: peeked.title,
          }
        : null,
    );
  }, [peeked]);
  useEffect(() => () => setAldoPeekedThread(null), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        // The nearest thing closes first: a menu or dialog its own, words being typed keep theirs.
        const element = event.target as HTMLElement | null;
        if (!peek || event.defaultPrevented || typing(element) || element?.closest("[role=dialog]"))
          return;
        event.preventDefault();
        close();
        return;
      }
      if (inField(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        seedAldoComposer("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek, close]);

  const peekView =
    peek && home ? (
      <AldoPeek
        peek={peek.target}
        home={home}
        now={now}
        onClose={close}
        {...(wide ? {} : { onAsked: close })}
        className={wide ? "w-[30rem] shrink-0 border-border/60 border-l" : "h-full"}
      />
    ) : null;

  const conversation = (
    <AldoConversation feed={feed} tail={home ? <AldoUpNext home={home} now={now} /> : null} />
  );
  const column = "mx-auto w-full max-w-[640px] px-4 sm:px-6";
  // The empty page's few things to say (the first run's starters say them instead);
  // once something's been said, the composer stands alone.
  const chips = fresh && !props.welcome ? props.chips.slice(0, 3) : [];

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <AldoPeekerContext.Provider value={peekAny}>
        <AldoPeekContext.Provider value={peekThread}>
          <div className="flex h-full min-h-0 min-w-0">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Centered, clear of the sidebar's button, which floats at the top left on a phone. */}
              <header className="relative flex min-h-14 shrink-0 flex-col items-center justify-center gap-2 px-4 pt-2 pb-1.5 sm:px-6">
                {props.tabs}
                {fresh ? null : <AldoPresence home={home} now={now} />}
                {props.actions ? (
                  <div className="absolute end-3 top-2.5 hidden sm:block">{props.actions}</div>
                ) : null}
              </header>
              {/* The empty page centers its question and composer, a little above the middle; then it's the conversation over the composer. */}
              {fresh ? <div aria-hidden className="min-h-4 flex-[1_1_0]" /> : null}
              <div
                ref={scroller}
                className={cn(
                  fresh
                    ? "min-h-0 shrink overflow-y-auto"
                    : "relative min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]",
                )}
              >
                {fresh ? (
                  <div className={cn(column, "flex flex-col gap-6")}>
                    {props.setup}
                    <HealthStrip issues={props.issues} />
                    <div className="flex flex-col items-center text-center">
                      <AldoAvatar size={48} aware />
                      <h1 className="mt-5 font-semibold text-[24px] leading-[30px] tracking-[-0.02em] sm:text-[28px] sm:leading-[34px]">
                        What should we get done?
                      </h1>
                      <p className="mt-2 max-w-md text-balance text-[14px] text-muted-foreground leading-5">
                        Tell me what you need. I'll get it moving and keep you posted.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className={cn(column, "flex flex-col gap-4 pt-3 pb-6")}>
                    {props.setup}
                    <HealthStrip issues={props.issues} />
                    {props.supported === false ? <AldoAtAGlance /> : null}
                    {conversation}
                  </div>
                )}
              </div>
              {/* The same composer, empty page or not, so what's typed and focus stay as it glides into place. */}
              <div className="relative shrink-0" data-aldo-assistant-footer="">
                {below ? (
                  <button
                    type="button"
                    data-aldo-arrive=""
                    className="absolute -top-11 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-foreground/[0.10] bg-popover ps-2.5 pe-3 font-medium text-[13px] shadow-composer outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-composer-dark"
                    onClick={() =>
                      scroller.current?.scrollTo({
                        top: scroller.current.scrollHeight,
                        behavior: scrollMotion(),
                      })
                    }
                  >
                    <ArrowDownIcon aria-hidden className="size-3.5" strokeWidth={2} />
                    New from Aldo
                  </button>
                ) : null}
                <div
                  ref={dock}
                  className={cn(
                    column,
                    "flex flex-col items-center gap-2",
                    fresh ? "pt-6" : "pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
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
                <div className="flex min-h-6 flex-[1.4_1_0] flex-col overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                  {props.welcome ? <div className={cn(column, "pt-4")}>{props.welcome}</div> : null}
                </div>
              ) : null}
            </div>
            {wide ? peekView : null}
          </div>
          {!wide && peekView ? (
            <Sheet open onOpenChange={(open) => (open ? undefined : close())}>
              <SheetPopup
                side="right"
                showCloseButton={false}
                className="max-w-none p-0 sm:max-w-md"
              >
                {peekView}
              </SheetPopup>
            </Sheet>
          ) : null}
        </AldoPeekContext.Provider>
      </AldoPeekerContext.Provider>
    </SidebarInset>
  );
}
