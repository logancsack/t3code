// The phone's Agents tab (AldoHome.tsx): every thread by what it needs from
// the user, as Aldo's sidebar groups them (useAldoThreadList.ts), in rows made
// for a thumb: how many wait, work, land and are unread, then each group.
// What takes one tap has its button on the row (send, merge); tapping a row
// opens it in place: what the agent last said, what it asks (answered right
// there), its pull requests, a reply to the agent, talking to Aldo about it,
// and the thread itself. Going through what waits with Aldo starts here too.

import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  AlarmClockOffIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
  MicIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SidebarInset } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import { useThreadActions } from "../hooks/useThreadActions";
import { ApprovalCard } from "./AldoApprovals";
import { confirmQuickChoice, DecisionIcon, quickChoice } from "./AldoBrief";
import { HealthStrip } from "./AldoHomeBoard";
import { PendingForm } from "./AldoHomeInbox";
import { pullRequestsOf, PullRequestLine } from "./AldoLiveCard";
import { RowIcon, rowTime } from "./AldoSidebar";
import { connectAldo } from "./assistantSession";
import {
  sendAldoThreadMessage,
  type AldoApproval,
  type AldoHome,
  type AldoHomeConversation,
} from "./cloud";
import { decideAldo } from "./decide";
import { aldoDecisions, aldoWaitingCount, type AldoDecision } from "./decisions.logic";
import { refreshAldoHome } from "./homeFeed";
import { needsYouKind, relativeTime, type healthIssues } from "./home.logic";
import { setAldoPeekedThread } from "./screen";
import type { AldoSidebarRow } from "./sidebar.logic";
import { useAldoThreadList } from "./useAldoThreadList";
import { startAldoWalkthrough } from "./walkthrough";

/** Earlier threads shown at a time, when that group is open. */
const EARLIER_PAGE = 15;

export function AldoAgentsTab(props: {
  readonly header: ReactNode;
  readonly home: AldoHome | null;
  readonly now: number;
  readonly setup: ReactNode;
  readonly issues: ReturnType<typeof healthIssues>;
  readonly onEnableNotifications: () => void;
}) {
  const { home, now } = props;
  const { list, shellCount } = useAldoThreadList({ home, now, scope: null });
  const decisions = useMemo(() => (home ? aldoDecisions(home, now) : []), [home, now]);
  const waitingCount = useMemo(() => (home ? aldoWaitingCount(home, now) : 0), [home, now]);
  const [open, setOpen] = useState<string | null>(null);
  const [earlierShown, setEarlierShown] = useState(0);
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));
  const waiting = list.approvals.length + list.waiting.length;
  // What waits counts pinned threads too, as the tab's badge does.
  const summary = [
    waitingCount > 0 ? `${waitingCount} waiting` : null,
    list.working.length > 0 ? `${list.working.length} working` : null,
    list.landing.length > 0 ? `${list.landing.length} landing` : null,
    list.unread.length > 0 ? `${list.unread.length} unread` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const row = (r: AldoSidebarRow) => (
    <AgentRow
      key={r.key}
      row={r}
      home={home}
      now={now}
      decision={decisionOf(decisions, r)}
      open={open === r.key}
      onToggle={() => toggle(r.key)}
    />
  );
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <header className="flex shrink-0 flex-col items-center gap-1.5 px-4 pt-3 pb-2">
        {props.header}
        {summary ? <p className="text-muted-foreground text-xs">{summary}</p> : null}
        {decisions.length > 0 ? (
          <Button
            size="xs"
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
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-3 pt-2">
          {props.setup}
          <HealthStrip issues={props.issues} onEnableNotifications={props.onEnableNotifications} />
          {list.pinned.length > 0 ? (
            <AgentGroup title="Pinned" tone="muted">
              {list.pinned.map(row)}
            </AgentGroup>
          ) : null}
          {waiting > 0 ? (
            <AgentGroup title="Waiting on you" tone="amber">
              {list.approvals.map((a) => (
                <ApprovalRow
                  key={a.id}
                  approval={a}
                  now={now}
                  decision={decisions.find((d) => d.key === `aldo:${a.id}`) ?? null}
                  open={open === `approval:${a.id}`}
                  onToggle={() => toggle(`approval:${a.id}`)}
                />
              ))}
              {list.waiting.map(row)}
            </AgentGroup>
          ) : null}
          {list.working.length > 0 ? (
            <AgentGroup title="Working" tone="blue">
              {list.working.map(row)}
            </AgentGroup>
          ) : null}
          {list.landing.length > 0 ? (
            <AgentGroup title="Landing" tone="muted">
              {list.landing.map(row)}
            </AgentGroup>
          ) : null}
          {list.unread.length > 0 ? (
            <AgentGroup title="Unread" tone="green">
              {list.unread.map(row)}
            </AgentGroup>
          ) : null}
          {list.earlier.length > 0 ? (
            <AgentGroup
              title={`Earlier · ${list.earlier.length}`}
              tone="muted"
              action={
                <Button
                  size="xs"
                  variant="ghost"
                  aria-expanded={earlierShown > 0}
                  onClick={() => setEarlierShown((shown) => (shown > 0 ? 0 : EARLIER_PAGE))}
                >
                  {earlierShown > 0 ? "Hide" : "Show"}
                  <ChevronDownIcon
                    className={cn("transition-transform", earlierShown > 0 && "rotate-180")}
                  />
                </Button>
              }
            >
              {list.earlier.slice(0, earlierShown).map(row)}
              {earlierShown > 0 && list.earlier.length > earlierShown ? (
                <li>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mx-1 my-1 text-muted-foreground"
                    onClick={() => setEarlierShown((shown) => shown + EARLIER_PAGE)}
                  >
                    Show {Math.min(EARLIER_PAGE, list.earlier.length - earlierShown)} more
                  </Button>
                </li>
              ) : null}
            </AgentGroup>
          ) : null}
          {list.snoozed.length > 0 ? (
            <AgentGroup
              title={`Snoozed · ${list.snoozed.length}`}
              tone="muted"
              action={
                <Button
                  size="xs"
                  variant="ghost"
                  aria-expanded={snoozedOpen}
                  onClick={() => setSnoozedOpen((v) => !v)}
                >
                  {snoozedOpen ? "Hide" : "Show"}
                  <ChevronDownIcon
                    className={cn("transition-transform", snoozedOpen && "rotate-180")}
                  />
                </Button>
              }
            >
              {snoozedOpen ? list.snoozed.map(row) : null}
            </AgentGroup>
          ) : null}
          {shellCount === 0 && list.approvals.length === 0 ? (
            <p className="px-3 py-10 text-center text-muted-foreground text-sm">
              No threads yet. Tell Aldo what to get done.
            </p>
          ) : null}
        </div>
      </div>
    </SidebarInset>
  );
}

/** The decision a row's thread waits on (or its pull request ready to merge), if any. */
function decisionOf(
  decisions: ReadonlyArray<AldoDecision>,
  row: AldoSidebarRow,
): AldoDecision | null {
  return (
    decisions.find((d) => {
      if (d.kind === "aldo-approval") return false;
      const target = d.kind === "merge" ? d.pullRequest.thread : d.conversation.thread;
      return target?.environmentId === row.shell.environmentId && target.threadId === row.shell.id;
    }) ?? null
  );
}

const TONE_DOT = {
  amber: "bg-warning",
  blue: "bg-primary",
  green: "bg-success",
  muted: "bg-muted-foreground/50",
} as const;

function AgentGroup(props: {
  readonly title: string;
  readonly tone: keyof typeof TONE_DOT;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="flex items-center gap-2 px-3 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
        <span aria-hidden className={cn("size-2 rounded-full", TONE_DOT[props.tone])} />
        <span className="flex-1">{props.title}</span>
        {props.action}
      </h2>
      <ul className="flex flex-col">{props.children}</ul>
    </section>
  );
}

/** A row's one tap, if it has one (send, merge, Aldo's pick), on the row itself. */
function QuickButton(props: {
  readonly decision: AldoDecision;
  readonly suggestion?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const quick = quickChoice(props.decision, props.suggestion ?? null);
  if (!quick) return null;
  return (
    <Button
      size="sm"
      variant={quick.primary ? "default" : "outline"}
      className="shrink-0"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        void (async () => {
          if (!(await confirmQuickChoice(props.decision))) return;
          setBusy(true);
          await decideAldo(props.decision, quick.choice);
          setBusy(false);
        })();
      }}
    >
      {busy ? <LoaderCircleIcon className="animate-spin" /> : quick.label}
    </Button>
  );
}

function ApprovalRow(props: {
  readonly approval: AldoApproval;
  readonly now: number;
  readonly decision: AldoDecision | null;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const a = props.approval;
  return (
    <li className={cn("rounded-2xl", props.open && "bg-card/50 ring-1 ring-border/70")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={props.open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={props.onToggle}
        >
          {props.decision ? <DecisionIcon decision={props.decision} /> : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-[15px]">{a.title}</span>
            <span className="block truncate text-muted-foreground text-xs">
              {a.summary} · {relativeTime(a.createdAt, props.now)}
            </span>
          </span>
        </button>
        {props.decision && !props.open ? <QuickButton decision={props.decision} /> : null}
      </div>
      {props.open ? (
        <ul className="px-2 pb-2">
          <ApprovalCard approval={a} now={props.now} onActed={() => void refreshAldoHome()} />
        </ul>
      ) : null}
    </li>
  );
}

function AgentRow(props: {
  readonly row: AldoSidebarRow;
  readonly home: AldoHome | null;
  readonly now: number;
  readonly decision: AldoDecision | null;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const { row } = props;
  const c = row.conversation;
  return (
    <li className={cn("rounded-2xl", props.open && "bg-card/50 ring-1 ring-border/70")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={props.open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={props.onToggle}
        >
          <span className="flex size-7 shrink-0 items-center justify-center">
            <RowIcon row={row} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-[15px]",
                row.unread ? "font-semibold" : "font-medium",
              )}
            >
              {row.shell.title}
            </span>
            <span className="block truncate text-muted-foreground text-xs">{row.detail}</span>
          </span>
          <span className="shrink-0 self-start pt-0.5 text-muted-foreground text-xs">
            {rowTime(row, props.now)}
          </span>
        </button>
        {props.decision && !props.open ? <QuickButton decision={props.decision} /> : null}
      </div>
      {props.open ? (
        <AgentDetail row={row} conversation={c} home={props.home} now={props.now} />
      ) : null}
    </li>
  );
}

/** A row opened in place: what it last said, what it asks, its pull requests, a reply, Aldo, the thread. */
function AgentDetail(props: {
  readonly row: AldoSidebarRow;
  readonly conversation: AldoHomeConversation | null;
  readonly home: AldoHome | null;
  readonly now: number;
}) {
  const navigate = useNavigate();
  const { row } = props;
  const c = props.conversation;
  const target = { environmentId: row.shell.environmentId, threadId: row.shell.id };
  const asks = c ? needsYouKind(c) : null;
  const pullRequests = props.home ? pullRequestsOf(props.home, target, props.now) : [];
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const actions = useThreadActions();
  const [waking, setWaking] = useState(false);
  const snoozed = row.shell.snoozedUntil != null && Date.parse(row.shell.snoozedUntil) > props.now;
  const wake = async () => {
    setWaking(true);
    const result = await actions.unsnoozeThread(
      scopeThreadRef(row.shell.environmentId, row.shell.id),
    );
    setWaking(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Couldn't wake it",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };
  // While it's open, it's what Aldo hears is on screen: "this one" means it.
  const { environmentId, id: threadId, title } = row.shell;
  useEffect(() => {
    setAldoPeekedThread({ environmentId, threadId, title });
    return () => setAldoPeekedThread(null);
  }, [environmentId, threadId, title]);
  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    try {
      await sendAldoThreadMessage(target, text);
      setReply("");
      toastManager.add({ type: "success", title: "Sent to the agent" });
      void refreshAldoHome();
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Couldn't send it",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 px-3 pb-3">
      {c?.summary && asks !== "question" && asks !== "approval" ? (
        <blockquote className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm leading-relaxed">
          “{c.summary}”
        </blockquote>
      ) : null}
      {c && (asks === "question" || asks === "approval" || asks === "plan") ? (
        <div className="rounded-xl border border-warning/50 bg-background/60 p-3">
          <PendingForm conversation={c} onActed={() => void refreshAldoHome()} />
        </div>
      ) : null}
      {pullRequests.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/60 p-3">
          {pullRequests.map((pr) => (
            <PullRequestLine key={`${pr.repo}#${pr.number}`} pullRequest={pr} />
          ))}
        </div>
      ) : null}
      {asks === "question" || asks === "approval" || asks === "plan" ? null : (
        <form
          className="flex items-center gap-2 rounded-full border border-border/80 bg-background py-1 ps-3.5 pe-1"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Input
            unstyled
            className="min-w-0 flex-1 text-sm"
            placeholder="Reply to the agent…"
            autoComplete="off"
            value={reply}
            disabled={sending}
            onChange={(event) => setReply(event.target.value)}
          />
          {reply.trim() ? (
            <Button
              type="submit"
              size="icon-sm"
              className="rounded-full"
              aria-label="Send to the agent"
              disabled={sending}
            >
              {sending ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpIcon />}
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="rounded-full"
              aria-label="Talk to Aldo about it"
              onClick={() => void connectAldo()}
            >
              <MicIcon />
            </Button>
          )}
        </form>
      )}
      <div className="flex items-center gap-2">
        {snoozed ? (
          <Button size="sm" variant="outline" disabled={waking} onClick={() => void wake()}>
            {waking ? <LoaderCircleIcon className="animate-spin" /> : <AlarmClockOffIcon />}
            Wake it
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: {
                environmentId: target.environmentId as EnvironmentId,
                threadId: target.threadId as ThreadId,
              },
            })
          }
        >
          Open thread
          <ArrowUpRightIcon />
        </Button>
        <span className="text-muted-foreground text-xs">{row.repo}</span>
      </div>
    </div>
  );
}
