// What waits on the user, at the end of Aldo's conversation (AldoConversationPage.tsx),
// so it's the first thing above the composer and never sits buried in what was
// said: each decision (decisions.logic.ts) as a card that's decided right
// there, with big buttons for the choices (Aldo's pick first, from the brief),
// and the way to peek at or open what asks. A few show; the rest unfold in
// place. Decided, a card leaves with the next read of the home screen.

import { ArrowUpRightIcon, ChevronDownIcon, EyeIcon, LoaderCircleIcon } from "lucide-react";
import { useContext, useMemo, useState, type ReactNode } from "react";

import { Input } from "../components/ui/input";
import { cn } from "~/lib/utils";
import { ApprovalCard } from "./AldoApprovals";
import { confirmQuickChoice, DecisionIcon, peekOfDecision } from "./AldoBrief";
import { AldoHandoffActions } from "./AldoHandoffCard";
import { askAldoAbout, PendingForm, ThreadLink } from "./AldoHomeInbox";
import { AldoPeekerContext } from "./AldoPeek";
import { useAldoBrief } from "./briefFeed";
import type { AldoHome } from "./cloud";
import { decideAldo, type AldoChoice } from "./decide";
import { aldoDecisions, decisionThread, type AldoDecision } from "./decisions.logic";
import { refreshAldoHome, useAldoHomeFeed } from "./homeFeed";
import { elapsed } from "./home.logic";

/** Cards shown before the rest unfold. */
const SHOWN = 3;

export function AldoUpNext(props: { readonly home: AldoHome; readonly now: number }) {
  const brief = useAldoBrief((s) => s.brief);
  const [all, setAll] = useState(false);
  const decisions = useMemo(() => {
    const list = aldoDecisions(props.home, props.now);
    // What can't wait first (a site handed to the user times out), then the
    // brief's order: what Aldo said matters most today.
    const urgent: ReadonlyArray<AldoDecision> = list.filter((d) => d.kind === "handoff");
    const first = (brief?.top ?? []).flatMap((item) =>
      list.filter((d) => d.key === item.key && !urgent.includes(d)),
    );
    return [...urgent, ...first, ...list.filter((d) => !urgent.includes(d) && !first.includes(d))];
  }, [props.home, props.now, brief]);
  const picks = useMemo(() => {
    const out: Record<string, { readonly label: string; readonly reason: string | null }> = {};
    for (const item of brief?.top ?? [])
      if (item.suggestion) out[item.key] = { label: item.suggestion, reason: item.reason };
    return out;
  }, [brief]);
  if (decisions.length === 0) return null;
  const shown = all ? decisions : decisions.slice(0, SHOWN);
  return (
    <section aria-label="Needs you" className="flex flex-col gap-3" data-aldo-up-next="">
      <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
        <span aria-hidden className="size-1.5 rounded-full bg-warning" />
        {decisions.length === 1 ? "1 thing needs you" : `${decisions.length} things need you`}
      </p>
      {shown.map((d) => (
        <DecisionCard key={d.key} decision={d} now={props.now} pick={picks[d.key] ?? null} />
      ))}
      {decisions.length > SHOWN ? (
        <button
          type="button"
          className="mx-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-muted-foreground text-sm hover:bg-accent/60 hover:text-foreground"
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show fewer" : `${decisions.length - SHOWN} more`}
          <ChevronDownIcon className={cn("size-3.5 transition-transform", all && "rotate-180")} />
        </button>
      ) : null}
    </section>
  );
}

/** A choice as a big button, the way a phone asks: the one to take filled, the rest quiet. */
function Pill(props: {
  readonly children: ReactNode;
  readonly primary?: boolean;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled || props.busy}
      className={cn(
        "flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-4 py-2 font-medium text-[15px] transition-colors disabled:opacity-60",
        props.primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-black/[0.05] text-foreground hover:bg-black/[0.08] dark:bg-white/[0.07] dark:hover:bg-white/[0.11]",
      )}
      onClick={props.onClick}
    >
      {props.busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : props.children}
    </button>
  );
}

function DecisionCard(props: {
  readonly decision: AldoDecision;
  readonly now: number;
  readonly pick: { readonly label: string; readonly reason: string | null } | null;
}) {
  const d = props.decision;
  const peek = useContext(AldoPeekerContext);
  const [busy, setBusy] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const target = peekOfDecision(d);
  const thread = decisionThread(d);
  const decide = async (key: string, choice: AldoChoice) => {
    if (!(await confirmQuickChoice(d))) return;
    setBusy(key);
    await decideAldo(d, choice);
    setBusy(null);
  };
  const who =
    d.kind === "aldo-approval"
      ? (d.approval.threadTitle ?? "Aldo")
      : d.kind === "merge"
        ? d.pullRequest.repo.split("/").at(-1)
        : d.conversation.title;
  const since =
    d.kind === "aldo-approval"
      ? d.approval.createdAt
      : d.kind === "merge"
        ? (d.pullRequest.greenSince ?? d.pullRequest.updatedAt)
        : (d.conversation.stateAt ?? d.conversation.at);

  let headline: string;
  let body: ReactNode = null;
  let actions: ReactNode = null;
  /** Two buttons side by side where there's room; choices stay one over another. */
  let pair = false;
  switch (d.kind) {
    case "aldo-approval": {
      const a = d.approval;
      if (a.kind === "confirm" || a.kind === "start") {
        // A step with a total and terms, or a thread to start, is said yes to in its own card, in full.
        return (
          <CardFrame
            decision={d}
            who={who ?? ""}
            when={elapsed(since, props.now)}
            headline={a.title}
          >
            <ApprovalCard approval={a} now={props.now} onActed={() => void refreshAldoHome()} />
          </CardFrame>
        );
      }
      headline = a.kind === "email" ? `Send “${a.title}”?` : `Add “${a.title}” to your calendar?`;
      body = (
        <div className="flex flex-col gap-2 rounded-2xl bg-black/[0.035] p-3 text-sm dark:bg-white/[0.04]">
          {a.fields.length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {a.fields.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="truncate">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {a.body ? (
            <p className="line-clamp-4 whitespace-pre-wrap text-foreground/90">{a.body}</p>
          ) : null}
        </div>
      );
      pair = true;
      actions = (
        <>
          <Pill
            primary
            busy={busy === "approve"}
            disabled={busy !== null}
            onClick={() => void decide("approve", { kind: "aldo", decision: "approve" })}
          >
            {a.approveLabel}
          </Pill>
          <Pill
            busy={busy === "discard"}
            disabled={busy !== null}
            onClick={() => void decide("discard", { kind: "aldo", decision: "discard" })}
          >
            {a.discardLabel}
          </Pill>
        </>
      );
      break;
    }
    case "question": {
      const q = d.pending.questions[0];
      headline = q?.question ?? "It asks you something";
      body = d.conversation.summary ? (
        <p className="line-clamp-3 text-muted-foreground text-sm">{d.conversation.summary}</p>
      ) : null;
      if (d.pending.questions.length !== 1 || !q || q.multiSelect) {
        actions = (
          <PendingForm conversation={d.conversation} onActed={() => void refreshAldoHome()} />
        );
        break;
      }
      const ordered = props.pick
        ? [
            ...q.options.filter((o) => o.label === props.pick!.label),
            ...q.options.filter((o) => o.label !== props.pick!.label),
          ]
        : q.options;
      actions = (
        <>
          {ordered.map((o) => {
            const picked = props.pick?.label === o.label;
            return (
              <Pill
                key={o.label}
                primary={picked}
                busy={busy === o.label}
                disabled={busy !== null}
                onClick={() =>
                  void decide(o.label, { kind: "answer", answers: { [q.id]: o.label } })
                }
              >
                {o.label}
                {picked ? (
                  <span className="rounded-full bg-primary-foreground/20 px-1.5 py-px font-normal text-[11px]">
                    Aldo's pick
                  </span>
                ) : null}
              </Pill>
            );
          })}
          <form
            className="flex"
            onSubmit={(event) => {
              event.preventDefault();
              if (words.trim()) void decide("words", { kind: "answer", text: words.trim() });
            }}
          >
            <Input
              unstyled
              className="h-10 w-full rounded-full border border-border/70 bg-transparent px-4 text-sm"
              placeholder="Or answer in your own words…"
              value={words}
              disabled={busy !== null}
              onChange={(event) => setWords(event.target.value)}
            />
          </form>
        </>
      );
      if (props.pick?.reason)
        body = (
          <>
            {body}
            <p className="text-sm">
              <span className="font-medium">Aldo would pick {props.pick.label}:</span>{" "}
              <span className="text-muted-foreground">{props.pick.reason}</span>
            </p>
          </>
        );
      break;
    }
    case "approval":
      headline = d.pending.summary;
      body = d.pending.detail ? (
        <p className="line-clamp-4 whitespace-pre-wrap rounded-2xl bg-black/[0.035] p-3 font-mono text-xs dark:bg-white/[0.04]">
          {d.pending.detail}
        </p>
      ) : null;
      actions = d.pending.options.map((o, index) => (
        <Pill
          key={o.decision}
          primary={index === 0}
          busy={busy === o.decision}
          disabled={busy !== null}
          onClick={() =>
            void decide(o.decision, { kind: "decision", decision: o.decision, label: o.label })
          }
        >
          {o.label}
        </Pill>
      ));
      break;
    case "handoff":
      headline = d.pending.summary || "It needs you in its browser";
      actions = <HandoffActions requestId={d.pending.requestId} />;
      break;
    case "plan":
      headline = "Has a plan for you to approve";
      body = (
        <p className="line-clamp-6 whitespace-pre-wrap rounded-2xl bg-black/[0.035] p-3 text-sm dark:bg-white/[0.04]">
          {d.plan.text}
        </p>
      );
      actions = (
        <Pill
          primary
          busy={busy === "plan"}
          disabled={busy !== null}
          onClick={() => void decide("plan", { kind: "plan" })}
        >
          Approve the plan
        </Pill>
      );
      break;
    case "merge": {
      const pr = d.pullRequest;
      const checks = pr.checks;
      headline = `#${pr.number} ${pr.title}`;
      body = (
        <p className="text-muted-foreground text-sm">
          {checks ? `${checks.passed} checks passed` : "Green"} · ready to merge
        </p>
      );
      pair = true;
      actions = (
        <>
          <Pill
            primary
            busy={busy === "merge"}
            disabled={busy !== null}
            onClick={() => void decide("merge", { kind: "merge" })}
          >
            Merge
          </Pill>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-black/[0.05] font-medium text-[15px] hover:bg-black/[0.08] dark:bg-white/[0.07] dark:hover:bg-white/[0.11]"
          >
            See it on {pr.url.includes("github.com") ? "GitHub" : "its host"}
            <ArrowUpRightIcon className="size-4" />
          </a>
        </>
      );
      break;
    }
    case "failed":
    case "waiting":
      headline =
        d.kind === "failed"
          ? "Stopped with an error"
          : (d.conversation.summary ?? "It's waiting on you");
      body =
        d.kind === "failed" && d.conversation.summary ? (
          <p className="line-clamp-3 text-muted-foreground text-sm">{d.conversation.summary}</p>
        ) : null;
      pair = true;
      actions = (
        <>
          <Pill primary onClick={() => askAldoAbout(d.conversation.title)}>
            Ask Aldo about it
          </Pill>
          <ThreadLink
            target={d.conversation.thread}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-black/[0.05] font-medium text-[15px] hover:bg-black/[0.08] dark:bg-white/[0.07] dark:hover:bg-white/[0.11]"
          >
            Open the thread
            <ArrowUpRightIcon className="size-4" />
          </ThreadLink>
        </>
      );
      break;
  }

  return (
    <CardFrame
      decision={d}
      who={who ?? ""}
      when={elapsed(since, props.now)}
      headline={headline}
      footer={
        <div className="flex items-center justify-center gap-1 text-muted-foreground text-xs">
          {target && peek ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 hover:bg-accent/60 hover:text-foreground"
              onClick={() => peek(target)}
            >
              <EyeIcon className="size-3.5" />
              Peek
            </button>
          ) : null}
          {thread && d.kind !== "failed" && d.kind !== "waiting" ? (
            <ThreadLink
              target={thread}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 hover:bg-accent/60 hover:text-foreground"
            >
              Open
              <ArrowUpRightIcon className="size-3.5" />
            </ThreadLink>
          ) : null}
        </div>
      }
    >
      {body}
      {actions ? (
        <div className={cn("flex flex-col gap-2", pair && "sm:flex-row")}>{actions}</div>
      ) : null}
    </CardFrame>
  );
}

/** A card's frame: what asks and since when, what it asks, then the rest. */
function CardFrame(props: {
  readonly decision: AldoDecision;
  readonly who: string;
  readonly when: string;
  readonly headline: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <article
      data-aldo-arrive=""
      className="flex w-full flex-col gap-3 rounded-[26px] bg-card p-4 shadow-black/5 shadow-lg ring-1 ring-border/60 dark:bg-white/[0.045] dark:shadow-none dark:ring-white/[0.07]"
    >
      <header className="flex items-start gap-3">
        <DecisionIcon decision={props.decision} className="size-9 rounded-xl [&_svg]:size-4" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <span className="truncate">{props.who}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{props.when}</span>
          </p>
          <h4 className="font-medium text-[15px] leading-snug">{props.headline}</h4>
        </div>
      </header>
      {props.children}
      {props.footer}
    </article>
  );
}

/** What only the user can get past in an agent's browser, with its card's own buttons. */
function HandoffActions(props: { readonly requestId: string }) {
  const handoff = useAldoHomeFeed((s) => s.home?.handoffs?.find((h) => h.id === props.requestId));
  if (!handoff) return null;
  return (
    <div className="flex flex-col gap-2">
      <AldoHandoffActions handoff={handoff} onActed={() => void refreshAldoHome()} pills />
    </div>
  );
}
