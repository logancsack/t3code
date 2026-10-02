// The board's sections besides what needs the user (AldoHomeInbox.tsx): what's
// wrong with the setup, what's working now, pull requests on their way out,
// what's coming up, what finished since the user last looked, what Aldo did
// for them, the plan's room and credits, and how Aldo works for them. Each
// reads from Aldo's one read of the user's work (cloud.ts AldoHome).

import { Link } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  BellRingIcon,
  ClockIcon,
  GitPullRequestIcon,
  MessageCircleQuestionIcon,
  SparklesIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { cn } from "~/lib/utils";
import { askAldoAbout, ThreadLink } from "./AldoHomeInbox";
import {
  cancelAldoDelivery,
  mergeAldoPullRequest,
  sendAldoDeliveryNow,
  setAldoMachine,
  type AldoHome,
  type AldoHomeAction,
  type AldoHomeConversation,
  type AldoHomeDelivery,
  type AldoHomePullRequest,
} from "./cloud";
import {
  actionLabel,
  capacityLines,
  deliveryLabel,
  dueIn,
  elapsed,
  isNewSince,
  isStuck,
  mergeCountdown,
  modelName,
  policyLines,
  relativeTime,
  repoName,
  shipLanes,
  stageLabel,
  stageTone,
  type HealthIssue,
  type ShipLane,
  type StageTone,
} from "./home.logic";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function Section(props: {
  readonly title: string;
  readonly count?: number;
  readonly hint?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="font-medium text-sm">{props.title}</h2>
        {props.count !== undefined ? (
          <span className="text-muted-foreground text-xs">{props.count}</span>
        ) : null}
        {props.hint ? <span className="text-muted-foreground text-xs">· {props.hint}</span> : null}
        {props.action ? <span className="ml-auto">{props.action}</span> : null}
      </div>
      {props.children}
    </section>
  );
}

function NewBadge() {
  return (
    <Badge variant="info" size="sm">
      new
    </Badge>
  );
}

export function HealthStrip(props: {
  readonly issues: ReadonlyArray<HealthIssue>;
  readonly onEnableNotifications: () => void;
}) {
  if (props.issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {props.issues.map((issue) => (
        <li
          key={issue.id}
          className={cn(
            "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
            issue.tone === "bad"
              ? "border-destructive/40 bg-destructive/5 text-destructive-foreground"
              : "border-warning/40 bg-warning/5 text-warning-foreground",
          )}
        >
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{issue.text}</span>
          {issue.action === "enable-notifications" ? (
            <Button size="compact" variant="outline" onClick={props.onEnableNotifications}>
              <BellRingIcon />
              Turn on
            </Button>
          ) : issue.href ? (
            <Button size="compact" variant="outline" render={<Link to={issue.href} />}>
              Fix
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const STATE_LABEL: Record<string, string> = {
  starting: "Starting",
  queued: "Waiting for room",
  retrying: "Trying again",
};

export function ConversationRow(props: {
  readonly conversation: AldoHomeConversation;
  readonly repos: ReadonlyArray<string>;
  readonly now: number;
  readonly isNew: boolean;
  readonly selected: boolean;
  readonly assistant: boolean;
  readonly onSelect: () => void;
  readonly onActed: () => void;
}) {
  const c = props.conversation;
  const [switching, setSwitching] = useState(false);
  const stuck = isStuck(c, props.now);
  const working = c.state === "working";
  const model = modelName(c.model);
  const switchMachine = async () => {
    setSwitching(true);
    try {
      await setAldoMachine(c.thread.environmentId, "2x");
      toastManager.add({ type: "success", title: "Switching to a 2× machine" });
      props.onActed();
    } catch (cause) {
      toastManager.add({ type: "error", title: "Couldn't switch", description: messageOf(cause) });
    } finally {
      setSwitching(false);
    }
  };
  return (
    <li
      data-selected={props.selected || undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent/40",
        props.selected && "bg-accent/50 ring-1 ring-primary/40",
      )}
      onClick={props.onSelect}
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          c.state === "done"
            ? "bg-success"
            : stuck
              ? "bg-warning"
              : working
                ? "bg-primary"
                : "bg-muted-foreground/50",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <ThreadLink
            target={c.thread}
            className="min-w-0 truncate font-medium text-sm hover:underline"
          >
            {c.title}
          </ThreadLink>
          {stuck ? (
            <Badge variant="warning" size="sm">
              stuck
            </Badge>
          ) : STATE_LABEL[c.state] ? (
            <Badge variant="outline" size="sm">
              {STATE_LABEL[c.state]}
            </Badge>
          ) : null}
          {props.isNew ? <NewBadge /> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
          <span>{c.repos.map((r) => repoName(r, props.repos)).join(" + ")}</span>
          {model ? <span>· {model}</span> : null}
          <span>
            ·{" "}
            {c.state === "done"
              ? `finished ${relativeTime(c.at, props.now)}`
              : `for ${elapsed(c.at, props.now)}`}
          </span>
          {c.pullRequests?.map((pr) => (
            <a
              key={`${pr.repo}#${pr.number}`}
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-foreground"
            >
              <GitPullRequestIcon className="size-3" />#{pr.number}
            </a>
          ))}
        </div>
        {c.summary ? (
          <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{c.summary}</p>
        ) : null}
        {c.pressure && working ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-warning-foreground">
              {c.pressure.kind === "memory" ? "Running short on memory." : "Every CPU is busy."}
            </span>
            <Button
              size="compact"
              variant="outline"
              disabled={switching}
              onClick={() => void switchMachine()}
            >
              {switching ? "Switching…" : "Switch to 2× machine"}
            </Button>
          </div>
        ) : null}
      </div>
      {props.assistant ? (
        <Button
          variant="ghost-muted"
          size="icon-xs"
          aria-label="Ask Aldo about this"
          className="shrink-0"
          onClick={(event) => {
            event.stopPropagation();
            askAldoAbout(c.title);
          }}
        >
          <MessageCircleQuestionIcon />
        </Button>
      ) : null}
    </li>
  );
}

const TONE_VARIANT: Record<StageTone, "outline" | "info" | "success" | "error"> = {
  neutral: "outline",
  working: "info",
  good: "success",
  bad: "error",
};

const LANE_TITLE: Record<ShipLane, string> = {
  open: "Open",
  shipping: "Shipping",
  shipped: "Shipped",
};

export function ShipLaneSection(props: {
  readonly pullRequests: ReadonlyArray<AldoHomePullRequest>;
  readonly repos: ReadonlyArray<string>;
  readonly now: number;
  readonly lastSeen: string | null;
  readonly onActed: () => void;
}) {
  const [merging, setMerging] = useState<string | null>(null);
  const lanes = shipLanes(props.pullRequests, props.now);
  const total = lanes.open.length + lanes.shipping.length + lanes.shipped.length;
  if (total === 0) return null;
  const merge = async (pr: AldoHomePullRequest) => {
    const key = `${pr.repo}#${pr.number}`;
    const confirmed = await (requestConfirmDialog(`Merge ${key}? Aldo then follows its deploy.`) ??
      Promise.resolve(true));
    if (!confirmed) return;
    setMerging(key);
    try {
      await mergeAldoPullRequest(pr.environmentId, pr);
      toastManager.add({ type: "success", title: `Merged ${key}` });
      props.onActed();
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: `Couldn't merge ${key}`,
        description: messageOf(cause),
      });
    } finally {
      setMerging(null);
    }
  };
  const allRepos = [...new Set(props.pullRequests.map((pr) => pr.repo))];
  return (
    <Section title="Pull requests" count={total}>
      <div className="rounded-xl border border-border/60 bg-card/30 p-1.5">
        {(["open", "shipping", "shipped"] as const).map((lane) =>
          lanes[lane].length === 0 ? null : (
            <div key={lane}>
              <h3 className="px-2 pt-1.5 pb-0.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
                {LANE_TITLE[lane]}
              </h3>
              <ul>
                {lanes[lane].map((pr) => {
                  const key = `${pr.repo}#${pr.number}`;
                  const countdown = mergeCountdown(pr, props.now);
                  const mergeable = pr.status === "watching" && pr.stage === "green";
                  return (
                    <li
                      key={key}
                      className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent/40"
                    >
                      <GitPullRequestIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 truncate font-medium text-sm hover:underline"
                          >
                            {pr.title}
                          </a>
                          <Badge variant={TONE_VARIANT[stageTone(pr)]} size="sm">
                            {stageLabel(pr)}
                          </Badge>
                          {lane === "shipped" && isNewSince(pr.updatedAt, props.lastSeen) ? (
                            <NewBadge />
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
                          <span>
                            {allRepos.length > 1
                              ? `${repoName(pr.repo, props.repos)}#${pr.number}`
                              : `#${pr.number}`}
                          </span>
                          {pr.thread ? (
                            <ThreadLink
                              target={pr.thread}
                              className="min-w-0 truncate hover:text-foreground"
                            >
                              · {pr.threadTitle}
                            </ThreadLink>
                          ) : null}
                          {pr.followups > 0 ? (
                            <span>
                              · {pr.followups} {pr.followups === 1 ? "fix" : "fixes"} by the agent
                            </span>
                          ) : null}
                          {pr.reviewsExhausted && pr.status === "watching" ? (
                            <span className="text-warning-foreground">· reviews went to you</span>
                          ) : null}
                          {countdown ? (
                            <span className="text-info-foreground">· {countdown}</span>
                          ) : null}
                          {lane === "shipped" ? (
                            <span>· {relativeTime(pr.updatedAt, props.now)}</span>
                          ) : null}
                        </div>
                      </div>
                      {mergeable ? (
                        <Button
                          size="compact"
                          variant={countdown ? "outline" : "default"}
                          disabled={merging !== null}
                          onClick={() => void merge(pr)}
                        >
                          {merging === key ? "Merging…" : "Merge"}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        )}
      </div>
    </Section>
  );
}

export function UpcomingSection(props: {
  readonly deliveries: ReadonlyArray<AldoHomeDelivery>;
  readonly now: number;
  readonly onActed: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (props.deliveries.length === 0) return null;
  const act = async (delivery: AldoHomeDelivery, what: "send" | "cancel") => {
    if (what === "cancel") {
      const confirmed = await (requestConfirmDialog(
        delivery.kind === "routine"
          ? "Cancel this routine run? It won't run (the routine's next runs still will)."
          : `Cancel this ${deliveryLabel(delivery).toLowerCase()}? It won't be sent.`,
        { variant: "destructive" },
      ) ?? Promise.resolve(true));
      if (!confirmed) return;
    }
    setBusy(delivery.id);
    try {
      if (what === "send") await sendAldoDeliveryNow(delivery.id);
      else await cancelAldoDelivery(delivery.id);
      toastManager.add({
        type: "success",
        title:
          what === "cancel"
            ? "Canceled"
            : delivery.kind === "routine"
              ? "Running it now"
              : "Sending it now",
      });
      props.onActed();
    } catch (cause) {
      toastManager.add({ type: "error", title: "Couldn't do that", description: messageOf(cause) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title="Coming up" count={props.deliveries.length}>
      <ul className="rounded-xl border border-border/60 bg-card/30 p-1.5">
        {props.deliveries.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent/40"
          >
            <ClockIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className="font-medium">
                  {d.held ? "Due, waiting for the thread" : dueIn(d.dueAt, props.now)}
                </span>
                <Badge variant="outline" size="sm">
                  {deliveryLabel(d)}
                </Badge>
              </div>
              <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{d.message}</p>
              <ThreadLink
                target={d.thread}
                className="mt-0.5 block truncate text-muted-foreground text-xs hover:text-foreground"
              >
                {d.threadTitle}
              </ThreadLink>
            </div>
            <div className="flex shrink-0 gap-1">
              {!d.held ? (
                <Button
                  size="compact"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void act(d, "send")}
                >
                  {d.kind === "routine" ? "Run now" : "Send now"}
                </Button>
              ) : null}
              <Button
                size="compact"
                variant="ghost-muted"
                disabled={busy !== null}
                onClick={() => void act(d, "cancel")}
              >
                Cancel
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function LogSection(props: {
  readonly actions: ReadonlyArray<AldoHomeAction>;
  readonly now: number;
}) {
  const [all, setAll] = useState(false);
  if (props.actions.length === 0) return null;
  const shown = all ? props.actions : props.actions.slice(0, 6);
  return (
    <Section
      title="What Aldo did"
      hint="for you, on your word"
      action={
        props.actions.length > 6 ? (
          <button
            type="button"
            className="text-muted-foreground text-xs hover:text-foreground"
            onClick={() => setAll((v) => !v)}
          >
            {all ? "Show fewer" : `Show all ${props.actions.length}`}
          </button>
        ) : null
      }
    >
      <ul className="rounded-xl border border-border/60 bg-card/30 p-1.5">
        {shown.map((a) => {
          const body = (
            <>
              <SparklesIcon
                className={cn(
                  "mt-1 size-3.5 shrink-0",
                  a.failed ? "text-destructive-foreground" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "flex flex-wrap items-center gap-x-2 text-sm",
                    a.failed && "text-destructive-foreground",
                  )}
                >
                  <span className="min-w-0 truncate">{actionLabel(a)}</span>
                  {a.thread ? (
                    <ArrowUpRightIcon className="size-3.5 text-muted-foreground" />
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
                  <span className="min-w-0 truncate">“{a.asked}”</span>
                  <span>· {relativeTime(a.at, props.now)}</span>
                </div>
                {a.error ? (
                  <p className="mt-0.5 line-clamp-2 text-destructive-foreground text-xs">
                    {a.error}
                  </p>
                ) : null}
              </div>
            </>
          );
          const className = "flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent/40";
          return (
            <li key={a.id}>
              {a.thread ? (
                <ThreadLink target={a.thread} className={className}>
                  {body}
                </ThreadLink>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function CapacitySection(props: {
  readonly usage: AldoHome["usage"];
  readonly spends: AldoHome["spends"];
}) {
  const lines = capacityLines(props.usage, props.spends);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border/60 bg-card/30 px-3.5 py-2.5 text-xs">
      {lines.map((line) => (
        <span
          key={line.text}
          className={cn(
            line.tone === "bad"
              ? "text-destructive-foreground"
              : line.tone === "warn"
                ? "text-warning-foreground"
                : "text-muted-foreground",
          )}
        >
          {line.text}
        </span>
      ))}
      <Link to="/usage" className="ml-auto text-muted-foreground hover:text-foreground">
        Usage
      </Link>
    </div>
  );
}

export function PolicySection(props: { readonly policy: AldoHome["policy"] }) {
  const lines = policyLines(props.policy);
  return (
    <Section title="How Aldo works for you">
      <div className="rounded-xl border border-border/60 bg-card/30 px-3.5 py-2.5">
        <ul className="flex flex-col gap-1 text-muted-foreground text-xs">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-x-3 text-xs">
          <Link to="/settings/memory" className="text-muted-foreground hover:text-foreground">
            What Aldo knows about you
          </Link>
          <Link to="/settings/instructions" className="text-muted-foreground hover:text-foreground">
            Your instructions for agents
          </Link>
        </div>
      </div>
    </Section>
  );
}
