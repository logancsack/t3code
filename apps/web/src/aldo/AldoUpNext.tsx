// What waits on the user, at the end of Aldo's conversation (AldoConversationPage.tsx),
// so it's the first thing above the composer and never sits buried in what was
// said: each decision (decisions.logic.ts) as a card that's decided right
// there. The first is open, with big buttons for the choices (Aldo's pick
// first, from the brief, with why), a tap on what asks (or ↗) to open its
// thread; the next two are a line each that opens in place, and the rest
// unfold. Decided, a card turns into the line saying what happened
// (receipts.ts) and leaves with the next read of the home screen. On a
// keyboard, j and k move between cards and Enter unfolds one, then opens its
// thread: nothing is decided without a button.

import { ArrowUpRightIcon, ChevronDownIcon, LoaderCircleIcon } from "lucide-react";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { ApprovalCard } from "./AldoApprovals";
import { confirmQuickChoice, DecisionIcon } from "./AldoBrief";
import { AldoHandoffActions } from "./AldoHandoffCard";
import { askAldoAbout, PendingForm, ThreadLink } from "./AldoHomeInbox";
import { AldoOpenContext } from "./AldoLiveCard";
import { AldoAvatar } from "./AldoPresence";
import { useAldoArrive } from "./arrive";
import { useAldoBrief } from "./briefFeed";
import type { AldoHome } from "./cloud";
import { decideAldoOutcome, type AldoChoice } from "./decide";
import { aldoDecisions, decisionThread, type AldoDecision } from "./decisions.logic";
import { pleaseAldo } from "./face";
import { refreshAldoHome, useAldoHomeFeed } from "./homeFeed";
import { elapsed } from "./home.logic";
import { aldoMorph } from "./morph";
import { addAldoReceipt, useAldoReceipts } from "./receipts";
import { movedOnText, receiptText } from "./receipts.logic";
import { FOCUS, ICON_BUTTON, INSET, PRIMARY, SECONDARY, SURFACE } from "./surface";
import { scrollMotion, SHOW_ALDO_DECISION } from "./show";
import { startAldoWalkthrough } from "./walkthrough";

/** Cards shown before the rest unfold. */
const SHOWN = 3;

export function AldoUpNext(props: { readonly home: AldoHome; readonly now: number }) {
  const brief = useAldoBrief((s) => s.brief);
  const receipts = useAldoReceipts((s) => s.receipts);
  const [all, setAll] = useState(false);
  const decisions = useMemo(() => {
    // One answered here is a line in the conversation now, while the home read catches up.
    const list = aldoDecisions(props.home, props.now).filter(
      (d) => !receipts.some((r) => r.key === d.key),
    );
    // What can't wait first (a site handed to the user times out), then the
    // brief's order: what Aldo said matters most today.
    const urgent: ReadonlyArray<AldoDecision> = list.filter((d) => d.kind === "handoff");
    const first = (brief?.top ?? []).flatMap((item) =>
      list.filter((d) => d.key === item.key && !urgent.includes(d)),
    );
    return [...urgent, ...first, ...list.filter((d) => !urgent.includes(d) && !first.includes(d))];
  }, [props.home, props.now, brief, receipts]);
  const picks = useMemo(() => {
    const out: Record<string, { readonly label: string; readonly reason: string | null }> = {};
    for (const item of brief?.top ?? [])
      if (item.suggestion) out[item.key] = { label: item.suggestion, reason: item.reason };
    return out;
  }, [brief]);
  const [opened, setOpened] = useState<string | null>(null);
  useCardKeys();
  useEffect(() => {
    // A live card's "Needs you": unfold to its card, open it, and bring it into view.
    const onShow = (event: Event) => {
      const thread = (event as CustomEvent<string>).detail;
      const at = decisions.findIndex((d) => {
        const t = decisionThread(d);
        return t !== null && `${t.environmentId}:${t.threadId}` === thread;
      });
      if (at < 0) return;
      event.preventDefault();
      setOpened(decisions[at]!.key);
      if (at >= SHOWN) setAll(true);
      focusCardSoon(decisions[at]!.key, true);
    };
    window.addEventListener(SHOW_ALDO_DECISION, onShow);
    return () => window.removeEventListener(SHOW_ALDO_DECISION, onShow);
  }, [decisions]);
  if (decisions.length === 0) return null;
  // The one open is the one the user opened, while it's there; else the first.
  const open = decisions.some((d) => d.key === opened) ? opened : decisions[0]!.key;
  const shown = all ? decisions : decisions.slice(0, SHOWN);
  const suggestions = Object.fromEntries(Object.entries(picks).map(([k, p]) => [k, p.label]));
  return (
    <section aria-label="Needs you" className="flex flex-col gap-2" data-aldo-up-next="">
      <div className="flex items-center justify-between px-1 pb-0.5 text-[12px] leading-[18px]">
        <h3 className="font-medium text-muted-foreground">Needs you</h3>
        {decisions.length > 1 ? (
          <button
            type="button"
            className={cn(
              FOCUS,
              "-me-1 rounded-full px-1 font-medium text-foreground/75 hover:text-foreground",
            )}
            onClick={() => startAldoWalkthrough(decisions, suggestions)}
          >
            Go through them with Aldo
          </button>
        ) : null}
      </div>
      {shown.map((d) => (
        <DecisionCard
          key={d.key}
          decision={d}
          now={props.now}
          pick={picks[d.key] ?? null}
          open={d.key === open}
          onOpen={() => {
            // The line tapped becomes the card, and focus goes with it.
            setOpened(d.key);
            focusCardSoon(d.key);
          }}
        />
      ))}
      {decisions.length > SHOWN ? (
        <button
          type="button"
          className={cn(
            FOCUS,
            "mx-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
          )}
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show fewer" : `${decisions.length - SHOWN} more`}
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform", all && "rotate-180")}
            strokeWidth={1.75}
          />
        </button>
      ) : null}
    </section>
  );
}

/** Where focus can't take a letter: something being typed in. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/**
 * After the cards next render: the card for `key` focused, without a jump;
 * with `reveal`, brought into view with a glance drawn to it.
 */
/** Where a keyboard on a card goes once it's answered: the card after (or before), or the composer once none's left. */
function focusAfter(card: HTMLElement | null): HTMLElement | null {
  if (!card?.contains(document.activeElement)) return null;
  const cards = [...document.querySelectorAll<HTMLElement>("[data-aldo-decision]")];
  const at = cards.indexOf(card);
  return (
    cards[at + 1] ??
    cards[at - 1] ??
    document.querySelector<HTMLElement>("[data-aldo-composer] textarea")
  );
}

function focusCardSoon(key: string, reveal = false): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-aldo-decision="${CSS.escape(key)}"]`);
      if (!card) return;
      card.focus({ preventScroll: true });
      if (!reveal) return;
      card.scrollIntoView({ behavior: scrollMotion(), block: "center" });
      card.removeAttribute("data-aldo-attention");
      requestAnimationFrame(() => card.setAttribute("data-aldo-attention", ""));
      setTimeout(() => card.removeAttribute("data-aldo-attention"), 1_400);
    }),
  );
}

/**
 * j and k move between the cards, while the conversation has the keyboard:
 * nothing focused, or a card. Not from a field or anything over the page.
 */
function useCardKeys(): void {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.key !== "j" && event.key !== "k") return;
      const focused = document.activeElement;
      const free =
        !focused || focused === document.body || focused.closest("[data-aldo-up-next]") !== null;
      if (!free || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-aldo-decision]")];
      if (cards.length === 0) return;
      event.preventDefault();
      const at = cards.findIndex((card) => card.contains(document.activeElement));
      const next =
        at < 0
          ? event.key === "j"
            ? 0
            : cards.length - 1
          : Math.min(cards.length - 1, Math.max(0, at + (event.key === "j" ? 1 : -1)));
      cards[next]?.focus();
      cards[next]?.scrollIntoView({ behavior: scrollMotion(), block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** A choice as a big button, the way a phone asks: the one to take filled, the rest quiet. */
function Choice(props: {
  readonly children: ReactNode;
  readonly primary?: boolean;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  /** One of a question's answers: a row, its words at the start. */
  readonly row?: boolean;
  /** Marked at the row's end: the one Aldo would pick. */
  readonly tag?: string | null;
  readonly className?: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled || props.busy}
      aria-busy={props.busy || undefined}
      className={cn(
        props.primary ? PRIMARY : SECONDARY,
        // What's chosen is read in full: long words wrap, the button grows.
        "h-auto min-h-11 py-2.5",
        props.row && "justify-between px-4 text-left font-normal text-[15px]",
        props.className,
      )}
      onClick={props.onClick}
    >
      <span className="min-w-0 break-words">{props.children}</span>
      {props.busy ? (
        <LoaderCircleIcon aria-hidden className="size-4 shrink-0 animate-spin" />
      ) : props.tag ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
          <AldoAvatar size={12} />
          {props.tag}
        </span>
      ) : null}
    </button>
  );
}

/** Lines a quote shows before "Show all" (literal, for Tailwind). */
const CLAMP = { 4: "max-h-[4lh]", 6: "max-h-[6lh]" } as const;

/**
 * What a card quotes (an email, a plan, a command): a few lines, and the rest
 * a tap away, so what's said yes to can be read in full first.
 */
function Quoted(props: {
  readonly lines: keyof typeof CLAMP;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const text = useRef<HTMLParagraphElement>(null);
  const [whole, setWhole] = useState(false);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const element = text.current;
    if (!element || whole) return;
    const observer = new ResizeObserver(() =>
      setLong(element.scrollHeight > element.clientHeight + 1),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [whole]);
  return (
    <>
      <p
        ref={text}
        className={cn(
          "whitespace-pre-wrap",
          // Cut short, it fades out rather than ending on an ellipsis (a blank line can be the last shown).
          !whole && ["overflow-hidden", CLAMP[props.lines]],
          !whole && long && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
          props.className,
        )}
      >
        {props.children}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={whole}
          className={cn(
            FOCUS,
            "self-start rounded-sm font-medium text-[13px] text-muted-foreground leading-5 hover:text-foreground",
          )}
          onClick={() => setWhole((was) => !was)}
        >
          {whole ? "Show less" : "Show all"}
        </button>
      ) : null}
    </>
  );
}

/** Own answers being written, by card: one folded away keeps what was typed. */
const drafts = new Map<string, string>();

/** "Something else…": the user's own answer, a field once asked for. */
function OwnWords(props: {
  /** The card's key, for what's been typed. */
  readonly draft: string;
  readonly disabled: boolean;
  readonly onSend: (text: string) => void;
}) {
  const [open, setOpen] = useState(() => drafts.has(props.draft));
  const [words, setWordsState] = useState(() => drafts.get(props.draft) ?? "");
  const setWords = (next: string) => {
    setWordsState(next);
    if (next) drafts.set(props.draft, next);
    else drafts.delete(props.draft);
  };
  if (!open)
    return (
      <button
        type="button"
        className={cn(
          FOCUS,
          "mx-auto rounded-full px-3 py-1 text-[13px] text-muted-foreground hover:text-foreground",
        )}
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      >
        Something else…
      </button>
    );
  return (
    <form
      data-aldo-arrive=""
      className="flex h-11 items-center gap-1 rounded-full bg-foreground/[0.05] ps-4 pe-1 focus-within:bg-foreground/[0.07]"
      onSubmit={(event) => {
        event.preventDefault();
        if (words.trim()) props.onSend(words.trim());
      }}
    >
      <input
        autoFocus
        aria-label="Your answer"
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
        placeholder="Say it in your own words"
        value={words}
        disabled={props.disabled}
        onChange={(event) => setWords(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !words) setOpen(false);
        }}
      />
      <button
        type="submit"
        className={cn(PRIMARY, "h-9 px-4 text-sm")}
        disabled={props.disabled || !words.trim()}
      >
        Send
      </button>
    </form>
  );
}

function DecisionCard(props: {
  readonly decision: AldoDecision;
  readonly now: number;
  readonly pick: { readonly label: string; readonly reason: string | null } | null;
  /** Shown in full; otherwise a line that opens it. */
  readonly open: boolean;
  readonly onOpen: () => void;
}) {
  const d = props.decision;
  const [busy, setBusy] = useState<string | null>(null);
  const card = useRef<HTMLElement>(null);
  const decide = async (key: string, choice: AldoChoice) => {
    // What it sends is on screen here, so its button is the yes; a draft deleted, or a merge, is asked.
    if (!(await confirmQuickChoice(d, choice, { seen: true }))) return;
    setBusy(key);
    const { outcome, said } = await decideAldoOutcome(d, choice, { quiet: true });
    setBusy(null);
    if (outcome === "failed") return;
    if (outcome === "done") pleaseAldo();
    drafts.delete(d.key);
    // The card becomes the line saying what happened, where it happened.
    const text = outcome === "done" ? receiptText(d, choice, said) : movedOnText(d, said);
    const next = focusAfter(card.current);
    aldoMorph(
      () =>
        addAldoReceipt({
          key: d.key,
          at: new Date().toISOString(),
          text,
          thread: decisionThread(d),
        }),
      card.current,
      () => document.querySelector<HTMLElement>(`[data-aldo-receipt="${CSS.escape(d.key)}"]`),
    );
    next?.focus({ preventScroll: true });
  };
  // Its own form acted (a longer question, a handoff, a step with terms): the next read takes the card away.
  const acted = () => {
    const next = focusAfter(card.current);
    void refreshAldoHome().then(() => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (next?.isConnected && lost) next.focus({ preventScroll: true });
    });
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
  const frame = {
    decision: d,
    who: who ?? "",
    when: elapsed(since, props.now),
    cardRef: card,
    open: props.open,
    onOpen: props.onOpen,
  };

  let headline: string;
  let body: ReactNode = null;
  let actions: ReactNode = null;
  switch (d.kind) {
    case "aldo-approval": {
      const a = d.approval;
      if (a.kind === "confirm" || a.kind === "start") {
        // A step with a total and terms, or a thread to start, is said yes to in its own card, in full.
        return (
          <CardFrame {...frame} headline={a.title}>
            <ApprovalCard approval={a} now={props.now} onActed={acted} />
          </CardFrame>
        );
      }
      headline = a.kind === "email" ? `Send “${a.title}”?` : `Add “${a.title}” to your calendar?`;
      body = (
        <div className={cn(INSET, "flex flex-col gap-2 text-sm")}>
          {a.fields.length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
              {a.fields.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="min-w-0 break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {a.body ? (
            <Quoted lines={6} className="text-foreground/85 leading-6">
              {a.body}
            </Quoted>
          ) : null}
        </div>
      );
      actions = (
        <div className="grid grid-cols-2 gap-2">
          <Choice
            busy={busy === "discard"}
            disabled={busy !== null}
            onClick={() => void decide("discard", { kind: "aldo", decision: "discard" })}
          >
            {a.discardLabel}
          </Choice>
          <Choice
            primary
            busy={busy === "approve"}
            disabled={busy !== null}
            onClick={() => void decide("approve", { kind: "aldo", decision: "approve" })}
          >
            {a.approveLabel}
          </Choice>
        </div>
      );
      break;
    }
    case "question": {
      const q = d.pending.questions[0];
      headline = q?.question ?? "It asks you something";
      body = d.conversation.summary ? (
        <p className="line-clamp-3 text-[14px] text-muted-foreground leading-6 dark:text-foreground/70">
          {d.conversation.summary}
        </p>
      ) : null;
      if (d.pending.questions.length !== 1 || !q || q.multiSelect) {
        actions = <PendingForm conversation={d.conversation} onActed={acted} />;
        break;
      }
      const pick = props.pick && q.options.some((o) => o.label === props.pick!.label);
      const ordered = pick
        ? [
            ...q.options.filter((o) => o.label === props.pick!.label),
            ...q.options.filter((o) => o.label !== props.pick!.label),
          ]
        : q.options;
      if (pick && props.pick!.reason)
        body = (
          <>
            {body}
            <p className="text-[14px] leading-5">
              <span className="font-medium">Aldo would pick “{props.pick!.label}”.</span>{" "}
              <span className="text-muted-foreground dark:text-foreground/70">
                {props.pick!.reason}
              </span>
            </p>
          </>
        );
      actions = (
        <div className="flex flex-col gap-2">
          {ordered.map((o, index) => (
            <Choice
              key={o.label}
              row
              tag={pick && index === 0 ? "Aldo's pick" : null}
              busy={busy === o.label}
              disabled={busy !== null}
              onClick={() => void decide(o.label, { kind: "answer", answers: { [q.id]: o.label } })}
            >
              {o.label}
            </Choice>
          ))}
          <OwnWords
            draft={d.key}
            disabled={busy !== null}
            onSend={(text) => void decide("words", { kind: "answer", text })}
          />
        </div>
      );
      break;
    }
    case "approval": {
      headline = d.pending.summary;
      body = d.pending.detail ? (
        <div className={cn(INSET, "flex flex-col gap-2")}>
          <Quoted lines={4} className="font-mono text-[12.5px] leading-5">
            {d.pending.detail}
          </Quoted>
        </div>
      ) : null;
      const options = d.pending.options;
      // Two side by side, the yes on the right; more, one over another, the first filled.
      const ordered = options.length === 2 ? [options[1]!, options[0]!] : options;
      actions = (
        <div className={options.length === 2 ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
          {ordered.map((o) => (
            <Choice
              key={o.decision}
              primary={o === options[0]}
              busy={busy === o.decision}
              disabled={busy !== null}
              onClick={() =>
                void decide(o.decision, { kind: "decision", decision: o.decision, label: o.label })
              }
            >
              {o.label}
            </Choice>
          ))}
        </div>
      );
      break;
    }
    case "handoff":
      headline = d.pending.summary || "It needs you in its browser";
      actions = <HandoffActions requestId={d.pending.requestId} onActed={acted} />;
      break;
    case "plan":
      headline = "Has a plan for you to approve";
      body = (
        <div className={cn(INSET, "flex flex-col gap-2")}>
          <Quoted lines={6} className="text-[14px] leading-6">
            {d.plan.text}
          </Quoted>
        </div>
      );
      actions = (
        <Choice
          primary
          className="w-full"
          busy={busy === "plan"}
          disabled={busy !== null}
          onClick={() => void decide("plan", { kind: "plan" })}
        >
          Approve the plan
        </Choice>
      );
      break;
    case "merge": {
      const pr = d.pullRequest;
      const checks = pr.checks;
      const total = checks ? checks.passed + checks.failed + checks.running : 0;
      headline = `#${pr.number} ${pr.title}`;
      body = (
        <p className="text-[14px] text-muted-foreground leading-5 tabular-nums dark:text-foreground/70">
          {checks && total > 0 ? `${checks.passed}/${total} checks passed` : "Checks passed"} ·
          ready to merge
        </p>
      );
      actions = (
        <div className="grid grid-cols-2 gap-2">
          <a href={pr.url} target="_blank" rel="noreferrer" className={SECONDARY}>
            View changes
            <ArrowUpRightIcon className="-me-1 size-4" strokeWidth={1.75} />
          </a>
          <Choice
            primary
            busy={busy === "merge"}
            disabled={busy !== null}
            onClick={() => void decide("merge", { kind: "merge" })}
          >
            Merge
          </Choice>
        </div>
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
          <p className="line-clamp-3 text-[14px] text-muted-foreground leading-6 dark:text-foreground/70">
            {d.conversation.summary}
          </p>
        ) : null;
      actions = (
        <Choice primary className="w-full" onClick={() => askAldoAbout(d.conversation.title)}>
          Ask Aldo about it
        </Choice>
      );
      break;
  }

  return (
    <CardFrame {...frame} headline={headline}>
      {body}
      {actions}
    </CardFrame>
  );
}

/** A card's frame: what asks and since when (a tap, or ↗, opens its thread), what it asks, then the rest. */
function CardFrame(props: {
  readonly decision: AldoDecision;
  readonly who: string;
  readonly when: string;
  readonly headline: string;
  readonly cardRef: RefObject<HTMLElement | null>;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly children: ReactNode;
}) {
  const d = props.decision;
  const openThread = useContext(AldoOpenContext);
  const arrive = useAldoArrive();
  const thread = decisionThread(d);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Only the card itself: its buttons and fields keep their own keys.
    if (event.target !== event.currentTarget || event.key !== "Enter") return;
    event.preventDefault();
    // A line unfolds into its card; an open card opens its thread.
    if (!props.open) props.onOpen();
    else if (thread && openThread) openThread(thread, event.currentTarget);
  };
  const who = (
    <>
      <span className="truncate">{props.who}</span>
      <span aria-hidden>·</span>
      <span className="shrink-0 tabular-nums">{props.when}</span>
    </>
  );
  const shared = {
    ref: props.cardRef,
    ...arrive,
    tabIndex: -1,
    "aria-label": props.headline,
    "data-aldo-decision": d.key,
    ...(thread
      ? { "data-aldo-decision-thread": `${thread.environmentId}:${thread.threadId}` }
      : {}),
    onKeyDown,
  };
  if (!props.open)
    return (
      <article {...shared} className={cn(SURFACE, FOCUS, "overflow-hidden")}>
        <button
          type="button"
          className={cn(
            FOCUS,
            "flex min-h-13 w-full items-center gap-3 rounded-[20px] px-4 py-2.5 text-left transition-colors hover:bg-foreground/[0.025]",
          )}
          aria-expanded={false}
          onClick={props.onOpen}
        >
          <DecisionIcon decision={d} plain />
          <span className="min-w-0 flex-1 truncate font-medium text-[14px] leading-5">
            {props.headline}
          </span>
          <span className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground max-sm:hidden">
            {who}
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        </button>
      </article>
    );
  return (
    <article {...shared} className={cn(SURFACE, FOCUS, "flex w-full flex-col gap-3.5 p-4 sm:p-5")}>
      <header className="flex flex-col gap-1.5">
        <div className="-my-1 flex min-h-8 items-center gap-2">
          <DecisionIcon decision={d} plain />
          {thread ? (
            <ThreadLink
              target={thread}
              className={cn(
                FOCUS,
                "flex min-w-0 items-center gap-1.5 rounded-md text-[12px] text-muted-foreground leading-[18px] hover:text-foreground",
              )}
            >
              {who}
            </ThreadLink>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground leading-[18px]">
              {who}
            </span>
          )}
          {thread ? (
            <span className="-me-1.5 ml-auto">
              <ThreadLink target={thread} className={ICON_BUTTON} label="Open the thread">
                <ArrowUpRightIcon className="size-4" strokeWidth={1.75} />
              </ThreadLink>
            </span>
          ) : null}
        </div>
        <h4 className="text-balance font-semibold text-[16px] leading-[22px] tracking-[-0.01em]">
          {props.headline}
        </h4>
      </header>
      {props.children}
    </article>
  );
}

/** What only the user can get past in an agent's browser, with its card's own buttons. */
function HandoffActions(props: { readonly requestId: string; readonly onActed: () => void }) {
  const handoff = useAldoHomeFeed((s) => s.home?.handoffs?.find((h) => h.id === props.requestId));
  if (!handoff) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <AldoHandoffActions handoff={handoff} onActed={props.onActed} pills />
    </div>
  );
}
