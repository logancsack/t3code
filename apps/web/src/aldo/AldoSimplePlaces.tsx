// Simple mode's places besides Aldo's conversation (AldoHome.tsx shows them,
// AldoSimpleRail.tsx goes to them). Needs you is what waits on the user, each
// answered in place as on the board: Aldo's approvals, then threads, then pull
// requests ready to merge. The Library is everything the user's agents
// shared. Asking Aldo from either (Ask Aldo, or "/") goes to Aldo's place,
// where its composer is.

import { useEffect, useMemo, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "~/lib/utils";
import { QuickButton } from "./AldoAgentsTab";
import { ApprovalsSection } from "./AldoApprovals";
import { DecisionIcon } from "./AldoBrief";
import { HealthStrip, Section } from "./AldoHomeBoard";
import { NeedsYouCard, ThreadLink } from "./AldoHomeInbox";
import { AldoSharedFiles } from "./AldoLibrary";
import { waitingApprovals } from "./approvals.logic";
import { seedAldoComposer, useAldoAssistant } from "./assistantSession";
import type { AldoHome } from "./cloud";
import {
  aldoDecisions,
  aldoWaitingCount,
  decisionAsk,
  decisionTitle,
  type AldoDecision,
} from "./decisions.logic";
import { refreshAldoHome } from "./homeFeed";
import { repoChips, type healthIssues } from "./home.logic";
import { setAldoSimplePlace } from "./simpleMode";
import { simpleNeedsYou } from "./simpleMode.logic";
import { startAldoWalkthrough } from "./walkthrough";

function inField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(element.tagName) ||
    element.closest("[role=dialog]") !== null
  );
}

/** Words seeded for Aldo's composer (Ask Aldo, "/") take the user to it. */
function useAskingGoesToAldo(): void {
  useEffect(
    () =>
      useAldoAssistant.subscribe((state) => {
        if (state.unsent !== null) setAldoSimplePlace("aldo");
      }),
    [],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || inField(event.target)) return;
      if (event.key !== "/") return;
      event.preventDefault();
      seedAldoComposer("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function PlacePage(props: {
  readonly title: string;
  readonly count?: number;
  /** On a phone, the places as tabs; the title is then for screen readers. */
  readonly tabs: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  useAskingGoesToAldo();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-3 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-5 sm:pt-6">
          {props.tabs ? <div className="flex justify-center">{props.tabs}</div> : null}
          <header className="flex min-h-8 flex-wrap items-center gap-2">
            <h1 className={cn("font-semibold text-lg", props.tabs && "sr-only")}>
              {props.title}
              {props.count ? (
                <span className="ms-2 font-normal text-muted-foreground text-sm">
                  {props.count}
                </span>
              ) : null}
            </h1>
            {props.action ? <span className="ms-auto">{props.action}</span> : null}
          </header>
          {props.children}
        </div>
      </div>
    </SidebarInset>
  );
}

export function AldoSimpleNeedsYou(props: {
  readonly home: AldoHome | null;
  /** Whether this Aldo has the home read; null until it's known. */
  readonly supported: boolean | null;
  readonly now: number;
  readonly tabs: ReactNode;
  readonly issues: ReturnType<typeof healthIssues>;
  readonly assistant: boolean;
}) {
  const { home, now } = props;
  const list = useMemo(() => (home ? simpleNeedsYou(home, now) : null), [home, now]);
  const decisions = useMemo(() => (home ? aldoDecisions(home, now) : []), [home, now]);
  const repos = useMemo(() => (home ? repoChips(home) : []), [home]);
  const refresh = () => void refreshAldoHome();
  const nothing =
    list !== null &&
    list.conversations.length === 0 &&
    list.merges.length === 0 &&
    waitingApprovals(home?.approvals).length === 0;
  return (
    <PlacePage
      title="Needs you"
      count={home ? aldoWaitingCount(home, now) : 0}
      tabs={props.tabs}
      action={
        props.assistant && decisions.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => startAldoWalkthrough(decisions)}
          >
            <span
              aria-hidden
              className="size-2.5 rounded-full bg-gradient-to-br from-primary/90 to-primary/50"
            />
            Go through them with Aldo
          </Button>
        ) : null
      }
    >
      <HealthStrip issues={props.issues} />
      {props.supported === false ? (
        <p className="text-muted-foreground text-sm">
          This Aldo can't list what needs you yet. Ask Aldo instead.
        </p>
      ) : null}
      {props.supported === null && !home ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : null}
      {home?.approvals ? (
        <ApprovalsSection approvals={home.approvals} now={now} onActed={refresh} />
      ) : null}
      {list && list.conversations.length > 0 ? (
        <Section title="Threads" count={list.conversations.length}>
          <ul className="flex flex-col gap-2">
            {list.conversations.map((c) => (
              <NeedsYouCard
                key={c.ref}
                conversation={c}
                repos={repos}
                now={now}
                isNew={false}
                selected={false}
                assistant={props.assistant}
                onSelect={() => undefined}
                onActed={refresh}
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {list && list.merges.length > 0 ? (
        <Section title="Ready to merge" count={list.merges.length}>
          <ul className="flex flex-col gap-2">
            {list.merges.map((d) => (
              <MergeRow key={d.key} decision={d} />
            ))}
          </ul>
        </Section>
      ) : null}
      {nothing ? (
        <div className="rounded-xl border border-border/60 border-dashed px-5 py-8 text-center">
          <p className="font-medium text-sm">Nothing needs you</p>
          <p className="mt-1 text-muted-foreground text-xs">
            When an agent has a question, wants your OK, or needs you on a site, it shows here, and
            you can answer it right here.
          </p>
        </div>
      ) : null}
    </PlacePage>
  );
}

function MergeRow(props: { readonly decision: Extract<AldoDecision, { kind: "merge" }> }) {
  const d = props.decision;
  const thread = d.pullRequest.thread;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/30 p-3">
      <DecisionIcon decision={d} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{decisionTitle(d)}</p>
        <p className="truncate text-muted-foreground text-xs">
          {decisionAsk(d)}
          {thread ? (
            <>
              {" · "}
              <ThreadLink target={thread} className="hover:text-foreground hover:underline">
                {d.pullRequest.threadTitle}
              </ThreadLink>
            </>
          ) : null}
        </p>
      </div>
      <QuickButton decision={d} />
    </li>
  );
}

export function AldoSimpleLibrary(props: { readonly tabs: ReactNode }) {
  return (
    <PlacePage title="Library" tabs={props.tabs}>
      <p className="text-muted-foreground text-sm">
        Pages and files your agents shared by link, newest first. Open one, copy its link, or stop
        sharing it.
      </p>
      {/* The list lines up with the page; it's inset for settings. */}
      <div className="-mx-3 flex flex-col gap-2 sm:-mx-4">
        <AldoSharedFiles />
      </div>
    </PlacePage>
  );
}
