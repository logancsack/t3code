// A look at a thread without leaving Aldo: beside the home screen's
// conversation on a wide screen, over it on a phone (AldoHome.tsx). It shows
// what Aldo's home read has (how the thread stands, what it asks, answered in
// place, its pull requests) and its latest turns as Aldo keeps them
// (cloud.ts fetchAldoConversationCopy), so nothing is woken. While it's open,
// Aldo hears it's on screen (screen.ts), so "this one" means it. An approval
// peeks the same way: the card in full.

import { ArrowUpRightIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import ChatMarkdown from "../components/ChatMarkdown";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
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

export type AldoPeekTarget =
  | { readonly kind: "thread"; readonly target: AldoHomeTarget }
  | { readonly kind: "approval"; readonly id: string };

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
      <header className="flex shrink-0 flex-col gap-1 border-border/60 border-b px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          {props.header ?? <h2 className="min-w-0 truncate font-semibold">{props.title}</h2>}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close the peek"
            className="ms-auto shrink-0"
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
        </div>
        {props.meta}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">{props.children}</div>
      </div>
      {props.footer ? (
        <footer className="shrink-0 border-border/60 border-t px-4 py-3">{props.footer}</footer>
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
          <h2 className="min-w-0 truncate font-semibold">{c.title}</h2>
          <Badge variant="outline" size="sm" className="shrink-0">
            {reposLabel(c.repos)}
          </Badge>
          <Button
            size="compact"
            variant="outline"
            className="ms-auto shrink-0"
            render={<ThreadLink target={c.thread} />}
          >
            Open thread
            <ArrowUpRightIcon />
          </Button>
        </>
      }
      meta={
        <p className="ps-4 text-muted-foreground text-xs">
          {[model, stateSince(c, props.now)].filter(Boolean).join(" · ")}
        </p>
      }
      footer={
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="compact"
            variant="outline"
            onClick={() => ask(`Where is "${c.title}" up to?`)}
          >
            <MessageCircleQuestionIcon />
            Where is it up to?
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onClick={() =>
              ask(`Look over what "${c.title}" changed, and tell me if anything looks off.`)
            }
          >
            Review its changes
          </Button>
        </div>
      }
    >
      {kind ? (
        <div className="rounded-xl border border-warning/50 bg-card/40 p-3">
          {c.summary && kind !== "approval" && kind !== "question" ? (
            <p className="mb-2.5 whitespace-pre-wrap text-sm">{c.summary}</p>
          ) : null}
          <PendingForm conversation={c} onActed={() => void refreshAldoHome()} />
        </div>
      ) : null}
      {pullRequests.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/30 p-3">
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
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        Latest in the thread
      </h3>
      {copy === undefined && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error ? (
        <p className="text-destructive-foreground text-xs">{error}</p>
      ) : messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {c.summary ?? "Aldo has no copy of its turns yet. Open the thread to see it all."}
        </p>
      ) : (
        messages.map((m) =>
          m.role === "user" ? (
            <p
              key={`${m.role}:${m.createdAt}`}
              className="max-w-[90%] self-end whitespace-pre-wrap rounded-2xl bg-muted/60 px-3.5 py-2 text-sm"
            >
              {withoutImageNotes(m.text).text}
            </p>
          ) : (
            <ChatMarkdown key={`${m.role}:${m.createdAt}`} text={m.text} cwd={undefined} />
          ),
        )
      )}
    </div>
  );
}
