// The home screen as a conversation with Aldo (AldoHome.tsx's default view):
// what's waiting on the user and what's running pinned on top (the "Now"
// strip), then the conversation, where what Aldo did shows live, then one
// large composer with the orb in it. A thread opens in a peek beside the
// conversation (over it on a phone), so someone who only talks to Aldo never
// has to leave it; Aldo's show_thread peeks here too. Setup, and what's wrong
// with it, come first, as on the board.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

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
import { AldoNowStrip } from "./AldoNowStrip";
import { AldoPeek, peekedConversation, type AldoPeekTarget } from "./AldoPeek";
import { loadAldoConversation, seedAldoComposer, setAldoThreadPeeker } from "./assistantSession";
import type { AldoHome, AldoHomeTarget } from "./cloud";
import { nowItems, type healthIssues } from "./home.logic";
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

export function AldoConversationPage(props: {
  readonly home: AldoHome | null;
  /** Whether this Aldo has the home read; null until it's known. */
  readonly supported: boolean | null;
  readonly now: number;
  readonly viewSwitch: ReactNode;
  readonly setup: ReactNode;
  readonly issues: ReturnType<typeof healthIssues>;
  readonly onEnableNotifications: () => void;
  readonly chips: ReadonlyArray<string>;
  readonly onChip: (chip: string) => void;
}) {
  const { home, now } = props;
  const wide = useMediaQuery("(min-width: 1024px)");
  const [peek, setPeek] = useState<{ target: AldoPeekTarget; key: string | null } | null>(null);
  const items = useMemo(() => (home ? nowItems(home, now) : []), [home, now]);

  useEffect(() => {
    void loadAldoConversation();
  }, []);

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

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex h-full min-h-0 min-w-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 flex-col gap-2.5 px-4 pt-14 pb-2.5 sm:px-5 sm:pt-3">
            <div className="flex items-center gap-2">
              {props.viewSwitch}
              {home && home.usage.agents.running > 0 ? (
                <span className="ms-auto text-muted-foreground text-xs">
                  {home.usage.agents.running === 1
                    ? "1 agent working"
                    : `${home.usage.agents.running} agents working`}
                </span>
              ) : null}
            </div>
            <AldoNowStrip
              items={items}
              now={now}
              active={peek?.key ?? null}
              onPeek={(target, key) => setPeek({ target, key })}
            />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto border-border/50 border-t">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-5 pb-4 sm:px-5">
              {props.setup}
              <HealthStrip
                issues={props.issues}
                onEnableNotifications={props.onEnableNotifications}
              />
              {props.supported === false ? <AldoAtAGlance /> : null}
              <AldoPeekContext.Provider value={peekThread}>
                <AldoConversation />
              </AldoPeekContext.Provider>
            </div>
          </div>
          <div className="shrink-0 bg-background/95 backdrop-blur" data-aldo-assistant-footer="">
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              <AldoCaption />
              <AldoComposer chips={props.chips} onChip={props.onChip} variant="page" />
              <p className="hidden items-center gap-1.5 text-muted-foreground text-xs lg:flex">
                <Kbd>/</Kbd> type
                <span aria-hidden>·</span>
                <Kbd>{ALDO_SHORTCUT_LABEL}</Kbd> talk
                <span aria-hidden>·</span>
                <Kbd>{ALDO_SUMMON_LABEL}</Kbd> Aldo from any screen
              </p>
            </div>
          </div>
        </div>
        {wide ? peekView : null}
      </div>
      {!wide && peekView ? (
        <Sheet open onOpenChange={(open) => (open ? undefined : close())}>
          <SheetPopup side="right" showCloseButton={false} className="max-w-none p-0 sm:max-w-md">
            {peekView}
          </SheetPopup>
        </Sheet>
      ) : null}
    </SidebarInset>
  );
}
