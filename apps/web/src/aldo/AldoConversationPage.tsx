// The home screen as a conversation with Aldo (AldoHome.tsx), made like a
// messaging app's chat with a teammate. At the top, Aldo's face and what it's
// at (AldoPresence.tsx), which opens what's working and coming up. Then the
// conversation, with what happened to the user's agents where it happened
// (feed.logic.ts, AldoFeed.tsx), and at its end what waits on the user, as
// cards to answer in place (AldoUpNext.tsx), so nothing needs a view of its
// own. Then the composer, one pill. Before anything's been said, the page is
// one question with the composer under it. A thread opens in a peek beside
// the conversation (over it on a phone), so someone who only talks to Aldo
// never has to leave it; Aldo's show_thread, and the brief's things to
// decide, peek here too. Setup, and what's wrong with it, come first.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { Kbd } from "../components/ui/kbd";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { SidebarInset } from "../components/ui/sidebar";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  ALDO_SHORTCUT_LABEL,
  AldoAtAGlance,
  AldoCaption,
  AldoComposer,
  AldoConversation,
} from "./AldoAssistant";
import { HealthStrip } from "./AldoHomeBoard";
import { AldoPeekContext } from "./AldoLiveCard";
import { AldoPeek, AldoPeekerContext, peekedConversation, type AldoPeekTarget } from "./AldoPeek";
import { AldoAvatar, AldoPresence } from "./AldoPresence";
import { AldoUpNext } from "./AldoUpNext";
import {
  loadAldoConversation,
  seedAldoComposer,
  setAldoThreadPeeker,
  useAldoAssistant,
} from "./assistantSession";
import type { AldoHome, AldoHomeTarget } from "./cloud";
import { aldoDecisions } from "./decisions.logic";
import { feedEvents } from "./feed.logic";
import type { healthIssues } from "./home.logic";
import { setAldoPeekedThread } from "./screen";
import { ALDO_SUMMON_LABEL } from "./summon.logic";

function inField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(element.tagName) ||
    element.closest("[role=dialog]") !== null
  );
}

/**
 * Keeps the conversation at its end while the user is there, as what's above
 * it loads (setup, what's wrong) and as the peek narrows it; scrolled up, it
 * stays put. Not before anything's been said: that page reads from the top.
 */
function useStickToBottom(ref: RefObject<HTMLDivElement | null>, enabled: boolean): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let atEnd = true;
    let size = `${element.scrollHeight}:${element.clientHeight}`;
    const onScroll = () => {
      // A scroll the layout made as what's on the page grew (the cards at the end
      // arriving, the composer's suggestions) isn't the user leaving the end.
      if (`${element.scrollHeight}:${element.clientHeight}` !== size) return;
      atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    };
    const observer = new ResizeObserver(() => {
      if (atEnd) element.scrollTop = element.scrollHeight;
      size = `${element.scrollHeight}:${element.clientHeight}`;
    });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, [ref, enabled]);
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

  // What happened, from where the conversation starts; what Aldo does from here on it shows itself.
  const [opened] = useState(() => Date.now());
  const loaded = useAldoAssistant((s) => s.historyLoaded);
  const firstAt = useAldoAssistant((s) => {
    const first = s.entries.find((e) => e.kind === "message");
    return first?.kind === "message" ? first.at : null;
  });
  const said = useAldoAssistant((s) => s.entries.length > 0 || s.replying);
  const feed = useMemo(
    () => (home ? feedEvents(home, { now, from: firstAt, until: opened }) : []),
    [home, now, firstAt, opened],
  );
  const waiting = useMemo(() => (home ? aldoDecisions(home, now).length : 0), [home, now]);
  // Nothing said, nothing happened and nothing waiting: the page is one question.
  const fresh = loaded && !said && feed.length === 0 && waiting === 0;
  useStickToBottom(scroller, !fresh);
  const peekAny = useCallback((target: AldoPeekTarget) => setPeek({ target, key: null }), []);

  const peekThread = useCallback(
    (target: AldoHomeTarget) => setPeek({ target: { kind: "thread", target }, key: null }),
    [],
  );
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
      if (event.metaKey || event.ctrlKey || event.altKey || inField(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        seedAldoComposer("");
      } else if (event.key === "Escape" && peek) {
        event.preventDefault();
        setPeek(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek]);

  const close = () => setPeek(null);
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
    <AldoConversation
      empty={props.welcome}
      feed={feed}
      tail={home ? <AldoUpNext home={home} now={now} /> : null}
    />
  );
  const hints = (
    <p className="hidden items-center gap-1.5 text-muted-foreground/80 text-xs lg:flex">
      <Kbd>/</Kbd> type
      <span aria-hidden>·</span>
      <Kbd>{ALDO_SHORTCUT_LABEL}</Kbd> talk
      <span aria-hidden>·</span>
      <Kbd>{ALDO_SUMMON_LABEL}</Kbd> Aldo from any screen
    </p>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <AldoPeekerContext.Provider value={peekAny}>
        <AldoPeekContext.Provider value={peekThread}>
          <div className="flex h-full min-h-0 min-w-0">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Centered, clear of the sidebar's button, which floats at the top left on a phone. */}
              <header className="relative flex shrink-0 flex-col items-center gap-2 px-4 pt-2.5 pb-2 sm:px-5">
                {props.tabs}
                <AldoPresence home={home} now={now} />
                {props.actions ? (
                  <div className="absolute end-4 top-3 hidden sm:block">{props.actions}</div>
                ) : null}
              </header>
              <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
                {fresh ? (
                  <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-5">
                    {props.setup}
                    <HealthStrip issues={props.issues} />
                    <div className="flex flex-col items-center gap-4 text-center">
                      {/* On a phone, the face at the top is enough. */}
                      <AldoAvatar size={60} className="max-sm:hidden" />
                      <div>
                        <h1 className="font-[550] text-[22px] tracking-[-0.02em] sm:text-[26px]">
                          What should we get done?
                        </h1>
                        <p className="mx-auto mt-1.5 max-w-sm text-muted-foreground text-sm">
                          Say it or type it. Aldo gives each job an agent with its own computer,
                          keeps an eye on it, and tells you how it went.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-3">
                      <AldoCaption />
                      <AldoComposer
                        chips={props.chips}
                        onChip={props.onChip}
                        variant="page"
                        chipsBelow
                      />
                      {hints}
                    </div>
                    {props.welcome}
                  </div>
                ) : (
                  <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-3 pb-4 sm:px-5">
                    {props.setup}
                    <HealthStrip issues={props.issues} />
                    {props.supported === false ? <AldoAtAGlance /> : null}
                    {conversation}
                  </div>
                )}
              </div>
              {fresh ? null : (
                <div className="shrink-0" data-aldo-assistant-footer="">
                  <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2 px-4 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                    <AldoCaption />
                    <AldoComposer chips={props.chips} onChip={props.onChip} variant="page" />
                    {hints}
                  </div>
                </div>
              )}
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
