// A look at a thread without leaving Aldo: beside the home screen's
// conversation on a wide screen, over it on a phone (AldoHome.tsx). It shows
// what Aldo's home read has (how the thread stands, what it asks, answered in
// place, its pull requests) and its latest turns as Aldo keeps them
// (cloud.ts fetchAldoConversationCopy), so nothing is woken. While it's open,
// Aldo hears it's on screen (screen.ts), so "this one" means it. An approval
// peeks the same way: the card in full.

import { ArrowUpRightIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react";
import { createContext, lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { Skeleton } from "../components/ui/skeleton";
import { cn } from "~/lib/utils";
import { ApprovalCard } from "./AldoApprovals";
import { PendingForm, ThreadLink } from "./AldoHomeInbox";
import { pullRequestsOf, PullRequestLine, reposLabel, StateDot, stateSince } from "./AldoLiveCard";
import { withoutImageNotes } from "./assistant.logic";
import { sendText } from "./assistantSession";
import {
  fetchAldoConversationCopy,
  type AldoConversationCopy,
  type AldoHome,
  type AldoHomeConversation,
  type AldoHomeTarget,
} from "./cloud";
import { refreshAldoHome } from "./homeFeed";
import { modelName, needsYouKind, sameTarget } from "./home.logic";
import { AldoAvatar } from "./AldoPresence";
import { CHIP, ICON_BUTTON, INSET, SECONDARY } from "./surface";

// The markdown renderer loads with the first peek, not with the app.
const loadChatMarkdown = () => import("../components/ChatMarkdown");
const ChatMarkdown = lazy(loadChatMarkdown);

export type AldoPeekTarget =
  | { readonly kind: "thread"; readonly target: AldoHomeTarget }
  | { readonly kind: "approval"; readonly id: string };

/** Peeks at a thread or an approval beside Aldo's conversation (the home screen gives it); absent elsewhere. */
export const AldoPeekerContext = createContext<((peek: AldoPeekTarget) => void) | null>(null);

/** The conversation a peek shows, from the home read; null when it has left it. */
export function peekedConversation(
  home: AldoHome | null,
  peek: AldoPeekTarget | null,
): AldoHomeConversation | null {
  if (!home || peek?.kind !== "thread") return null;
  return home.conversations.find((c) => sameTarget(c.thread, peek.target)) ?? null;
}

export function AldoPeek(props: {
  readonly peek: AldoPeekTarget;
  readonly home: AldoHome;
  readonly now: number;
  readonly onClose: () => void;
  /** Asking Aldo about it: on a phone the peek closes, so the answer shows. */
  readonly onAsked?: () => void;
  readonly className?: string;
}) {
  if (props.peek.kind === "approval") {
    const id = props.peek.id;
    const approval = props.home.approvals?.find((a) => a.id === id);
    return (
      <PeekFrame
        title={approval?.title ?? "Approval"}
        className={props.className}
        onClose={props.onClose}
      >
        {approval ? (
          <ul>
            <ApprovalCard
              approval={approval}
              now={props.now}
              onActed={() => void refreshAldoHome()}
            />
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">It's been decided, or it expired.</p>
        )}
      </PeekFrame>
    );
  }
  const c = peekedConversation(props.home, props.peek);
  if (!c) {
    return (
      <PeekFrame title="Thread" className={props.className} onClose={props.onClose}>
        <p className="text-muted-foreground text-sm">
          This thread isn't on Aldo's list anymore (archived, or deleted).
        </p>
      </PeekFrame>
    );
  }
  return (
    <ThreadPeek
      conversation={c}
      home={props.home}
      now={props.now}
      onClose={props.onClose}
      onAsked={props.onAsked}
      className={props.className}
    />
  );
}

function PeekFrame(props: {
  readonly title: string;
  readonly header?: ReactNode;
  readonly meta?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly className?: string | undefined;
}) {
  return (
    <section
      aria-label={`Peek: ${props.title}`}
      className={cn("flex min-h-0 flex-col bg-background", props.className)}
      data-aldo-peek=""
    >
      <header className="flex shrink-0 flex-col gap-0.5 px-5 pt-3.5 pb-3">
        <div className="flex min-h-8 items-center gap-2">
          {props.header ?? (
            <h2 className="min-w-0 truncate font-semibold text-[15px] leading-5">{props.title}</h2>
          )}
          <button
            type="button"
            aria-label="Close the peek"
            className={cn(ICON_BUTTON, "-me-1.5 ms-auto")}
            onClick={props.onClose}
          >
            <XIcon className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        {props.meta}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5">
        <div className="flex flex-col gap-5">{props.children}</div>
      </div>
      {props.footer ? (
        <footer className="shrink-0 px-5 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {props.footer}
        </footer>
      ) : null}
    </section>
  );
}

function ThreadPeek(props: {
  readonly conversation: AldoHomeConversation;
  readonly home: AldoHome;
  readonly now: number;
  readonly onClose: () => void;
  readonly onAsked?: (() => void) | undefined;
  readonly className?: string | undefined;
}) {
  const c = props.conversation;
  const kind = needsYouKind(c);
  const model = modelName(c.model);
  const pullRequests = pullRequestsOf(props.home, c.thread, props.now);
  const ask = (words: string) => {
    sendText(words);
    props.onAsked?.();
  };
  return (
    <PeekFrame
      title={c.title}
      className={props.className}
      onClose={props.onClose}
      header={
        <>
          <StateDot conversation={c} now={props.now} />
          <h2 className="min-w-0 truncate font-semibold text-[15px] leading-5">{c.title}</h2>
          <ThreadLink
            target={c.thread}
            className={cn(SECONDARY, "ms-auto h-8 shrink-0 gap-1 px-3 text-[13px]")}
          >
            Open
            <ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} />
          </ThreadLink>
        </>
      }
      meta={
        <p className="truncate ps-4 text-[12px] text-muted-foreground leading-[18px]">
          {[reposLabel(c.repos), model, stateSince(c, props.now)].filter(Boolean).join(" · ")}
        </p>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={CHIP}
            onClick={() => ask(`Where is "${c.title}" up to?`)}
          >
            <MessageCircleQuestionIcon
              aria-hidden
              className="size-4 text-muted-foreground"
              strokeWidth={1.75}
            />
            Where is it up to?
          </button>
          <button
            type="button"
            className={CHIP}
            onClick={() =>
              ask(`Look over what "${c.title}" changed, and tell me if anything looks off.`)
            }
          >
            Review its changes
          </button>
        </div>
      }
    >
      {kind ? (
        <div className={cn(INSET, "flex flex-col gap-2.5")}>
          <p className="flex items-center gap-1.5 font-medium text-[12px] text-muted-foreground leading-[18px]">
            <span aria-hidden className="size-1.5 rounded-full bg-warning" />
            Needs you
          </p>
          {c.summary && kind !== "approval" && kind !== "question" ? (
            <p className="whitespace-pre-wrap text-[14px] leading-6">{c.summary}</p>
          ) : null}
          <PendingForm conversation={c} onActed={() => void refreshAldoHome()} />
        </div>
      ) : null}
      {pullRequests.length > 0 ? (
        <div className={cn(INSET, "flex flex-col gap-2")}>
          {pullRequests.map((pr) => (
            <PullRequestLine key={`${pr.repo}#${pr.number}`} pullRequest={pr} />
          ))}
        </div>
      ) : null}
      <LatestTurns conversation={c} />
    </PeekFrame>
  );
}

/** The thread's latest turns, read again whenever the home read says it moved. */
function LatestTurns(props: { readonly conversation: AldoHomeConversation }) {
  const c = props.conversation;
  const [copy, setCopy] = useState<AldoConversationCopy | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const { environmentId, threadId } = c.thread;
  useEffect(() => {
    let current = true;
    setError(null);
    // Fetched alongside the turns, so the skeleton covers both.
    void loadChatMarkdown();
    void fetchAldoConversationCopy({ environmentId, threadId })
      .then((next) => {
        if (current) setCopy(next);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      current = false;
    };
  }, [environmentId, threadId, c.at]);
  const messages = copy?.messages.filter((m) => m.text.trim()) ?? [];
  const keys = new Map<string, number>();
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium text-[12px] text-muted-foreground leading-[18px]">
        Latest in the thread
      </h3>
      {copy === undefined && !error ? (
        <TurnsSkeleton />
      ) : error ? (
        <p className="text-destructive-foreground text-xs">{error}</p>
      ) : messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {c.summary ?? "Aldo has no copy of its turns yet. Open the thread to see it all."}
        </p>
      ) : (
        <Suspense fallback={<TurnsSkeleton />}>
          {messages.map((m) => {
            // Two turns can share a moment, so a second one there is told apart.
            const at = `${m.role}:${m.createdAt}`;
            const seen = keys.get(at) ?? 0;
            keys.set(at, seen + 1);
            const key = seen ? `${at}:${seen}` : at;
            return m.role === "user" ? (
              <UserTurn key={key} text={m.text} />
            ) : (
              <ChatMarkdown key={key} text={m.text} cwd={undefined} />
            );
          })}
        </Suspense>
      )}
    </div>
  );
}

function TurnsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/** What Aldo writes to a thread ends with this line (fromAldo in Aldo's src/lib/actions.ts); the peek labels it instead. */
const FROM_ALDO = /\s*_\(Sent by Aldo[^)]*\)_\s*$/;

/** A message the user (or Aldo for them) sent the thread. */
function UserTurn(props: { readonly text: string }) {
  const text = withoutImageNotes(props.text).text;
  const fromAldo = FROM_ALDO.test(text);
  return (
    <div className="flex max-w-[90%] flex-col items-end gap-1 self-end">
      {fromAldo ? (
        <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
          <AldoAvatar size={12} />
          From Aldo
        </span>
      ) : null}
      <p className="whitespace-pre-wrap break-words rounded-[18px] bg-message px-3.5 py-2 text-[14px] text-message-foreground leading-5">
        {fromAldo ? text.replace(FROM_ALDO, "") : text}
      </p>
    </div>
  );
}
