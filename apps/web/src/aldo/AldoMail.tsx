// The Mail page (/mail): the user's agents' inbox as a lightweight mail app.
// What their agents received, what they sent and what AgentMail called spam,
// or a search of it, newest first; beside it (on a phone, in place of it) a
// conversation, every message whole, with its attachments. It only reads:
// what's unread is the agents' to say, so looking changes nothing for them.
// HTML mail shows in a frame of its own (AldoMailFrame.tsx), with images from
// the web hidden until the user asks (a sender learns when their mail is
// opened from them). Reached from the account menu and Settings →
// Integrations → Agent inbox; an Aldo without it, or a user without an
// address yet, is told so.

import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ImageIcon,
  InboxIcon,
  LoaderIcon,
  MailIcon,
  PaperclipIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { SidebarInset } from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { toastManager } from "../components/ui/toast";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { useIsMobile } from "../hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { AldoMailFrame } from "./AldoMailFrame";
import {
  aldoMailAttachmentUrl,
  fetchAldoAgentInbox,
  fetchAldoMail,
  fetchAldoMailThread,
  type AldoAgentInbox,
  type AldoMailMessage,
  type AldoMailSummary,
  type AldoMailThread,
} from "./cloud";
import {
  ALDO_MAIL_FOLDERS,
  appendMailPage,
  formatMailDate,
  formatMailSize,
  formatMailTime,
  hasRemoteMailContent,
  keepShownMail,
  linkifyMailText,
  mailBody,
  mailConversations,
  mailFiles,
  mailPersonLabel,
  mailRowPeople,
  mailSnippet,
  mergeMailPages,
  parseMailAddress,
  type AldoMailFolder,
  type AldoMailList,
  type AldoMailSearch,
} from "./mail.logic";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const EMPTY: Record<AldoMailFolder, { readonly title: string; readonly description: string }> = {
  inbox: { title: "No mail yet", description: "Mail sent to your agents' address shows up here." },
  sent: { title: "Nothing sent yet", description: "Mail your agents send shows up here." },
  spam: { title: "No spam", description: "Mail AgentMail takes for spam shows up here." },
};

export function AldoMailPage(props: {
  readonly search: AldoMailSearch;
  /** Goes to another folder, search or conversation of the page. */
  readonly onNavigate: (next: AldoMailSearch) => void;
}) {
  const [state, setState] = useState<AldoAgentInbox | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    fetchAldoAgentInbox()
      .then(setState)
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, []);
  useEffect(load, [load]);

  if (state?.inbox && state.available && state.mail) {
    return <MailBrowser email={state.inbox.email} {...props} />;
  }
  return (
    <MailShell>
      {error && state === undefined ? (
        <Notice icon={<MailIcon />} title="Couldn't open your agents' inbox" description={error}>
          <Button size="sm" variant="outline" onClick={load}>
            Try again
          </Button>
        </Notice>
      ) : state === undefined ? (
        <div className="flex flex-col gap-3 p-5">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-16 w-full max-w-xl" />
          ))}
        </div>
      ) : state === null || !state.mail ? (
        <Notice
          icon={<MailIcon />}
          title="Mail isn't here yet"
          description="This Aldo can't show your agents' mail yet."
        />
      ) : !state.available ? (
        <Notice
          icon={<MailIcon />}
          title="No agent inboxes"
          description="Agent inboxes aren't set up on this Aldo."
        />
      ) : (
        <ClaimNotice domain={state.domain} />
      )}
    </MailShell>
  );
}

function ClaimNotice(props: { readonly domain: string | undefined }) {
  const navigate = useNavigate();
  return (
    <Notice
      icon={<MailIcon />}
      title="Your agents don't have an address yet"
      description={`Claim one${props.domain ? ` at @${props.domain}` : ""} for signing up for things, getting codes and links, and writing to people for a task. Their mail shows up here.`}
    >
      <Button size="sm" onClick={() => void navigate({ to: "/settings/integrations" })}>
        Claim an address
      </Button>
    </Notice>
  );
}

function MailShell(props: {
  readonly email?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <div className="flex w-full min-w-0 items-center gap-3">
            <WorkspaceBreadcrumb ariaLabel="Agent inbox breadcrumb" className="min-w-0">
              <WorkspaceBreadcrumbItem current>
                <h1>Agent inbox</h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            {props.email ? (
              <span className="hidden min-w-0 truncate text-muted-foreground text-xs sm:inline">
                {props.email}
              </span>
            ) : null}
            <div className="ms-auto flex shrink-0 items-center gap-1">{props.actions}</div>
          </div>
        </WorkspacePageHeader>
        <div className="flex min-h-0 flex-1 border-border/60 border-t">{props.children}</div>
      </div>
    </SidebarInset>
  );
}

function Notice(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{props.icon}</EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
      {props.children ? <EmptyContent>{props.children}</EmptyContent> : null}
    </Empty>
  );
}

function MailBrowser(props: {
  readonly email: string;
  readonly search: AldoMailSearch;
  readonly onNavigate: (next: AldoMailSearch) => void;
}) {
  const { search, onNavigate } = props;
  const mobile = useIsMobile();
  const folder = search.folder ?? "inbox";
  const q = search.q ?? "";
  const listKey = q ? `search:${q}` : `folder:${folder}`;
  const threadId = search.thread ?? null;

  const [list, setList] = useState<AldoMailList<AldoMailSummary> | null>(null);
  const [listError, setListError] = useState<{ key: string; message: string } | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the latest read of the list counts; a refresh drops a next page asked for before it.
  const listRequest = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;

  const loadList = useCallback(() => {
    const request = ++listRequest.current;
    setListLoading(true);
    fetchAldoMail({ folder, ...(q ? { q } : {}) })
      .then((page) => {
        if (request !== listRequest.current) return;
        setList(mergeMailPages(listRef.current, { key: listKey, ...page }, !q));
        setListError(null);
      })
      .catch((cause: unknown) => {
        if (request === listRequest.current)
          setListError({ key: listKey, message: messageOf(cause) });
      })
      .finally(() => {
        if (request === listRequest.current) setListLoading(false);
      });
  }, [folder, q, listKey]);
  useEffect(loadList, [loadList]);

  const loadMore = () => {
    const current = listRef.current;
    if (!current?.next || loadingMore) return;
    const request = listRequest.current;
    setLoadingMore(true);
    fetchAldoMail({ folder, ...(q ? { q } : {}), page: current.next })
      .then((page) => {
        if (request !== listRequest.current) return;
        setList((latest) =>
          latest && latest.key === current.key ? appendMailPage(latest, page) : latest,
        );
      })
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: "Couldn't load more mail",
          description: messageOf(cause),
        }),
      )
      .finally(() => setLoadingMore(false));
  };

  // The conversation shown, and when it was read (the links to its pictures last a while).
  const [thread, setThread] = useState<{ mail: AldoMailThread; at: number } | null>(null);
  const [threadError, setThreadError] = useState<{ id: string; message: string } | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const threadRequest = useRef(0);
  const loadThread = useCallback(() => {
    if (!threadId) return;
    const request = ++threadRequest.current;
    setThreadLoading(true);
    fetchAldoMailThread(threadId)
      .then((next) => {
        if (request !== threadRequest.current) return;
        const now = Date.now();
        setThread((shown) =>
          shown && keepShownMail(shown.mail, shown.at, next, now) ? shown : { mail: next, at: now },
        );
        setThreadError(null);
      })
      .catch((cause: unknown) => {
        if (request === threadRequest.current)
          setThreadError({ id: threadId, message: messageOf(cause) });
      })
      .finally(() => {
        if (request === threadRequest.current) setThreadLoading(false);
      });
  }, [threadId]);
  useEffect(loadThread, [loadThread]);

  const refresh = useCallback(() => {
    loadList();
    loadThread();
  }, [loadList, loadThread]);
  useLiveRefresh(refresh, { key: "aldo-mail" });

  const shownList = list?.key === listKey ? list : null;
  const shownThread = thread && thread.mail.id === threadId ? thread.mail : null;
  const where = { ...(folder !== "inbox" ? { folder } : {}), ...(q ? { q } : {}) };

  return (
    <MailShell
      email={props.email}
      actions={
        <Button size="icon-sm" variant="ghost" aria-label="Refresh mail" onClick={refresh}>
          <RefreshCwIcon
            className={cn("size-3.5", (listLoading || threadLoading) && "animate-spin")}
          />
        </Button>
      }
    >
      {!mobile || !threadId ? (
        <section
          aria-label="Mail"
          className="flex min-h-0 w-full flex-col md:w-[22rem] md:shrink-0 md:border-border/60 md:border-r lg:w-[26rem]"
        >
          <MailListHeader
            folder={folder}
            q={q}
            onFolder={(next) => onNavigate(next === "inbox" ? {} : { folder: next })}
            onSearch={(next) =>
              onNavigate({
                ...(folder !== "inbox" ? { folder } : {}),
                ...(next ? { q: next } : {}),
              })
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {shownList ? (
              shownList.messages.length === 0 ? (
                <Notice
                  icon={q ? <SearchIcon /> : <InboxIcon />}
                  title={q ? `Nothing matches “${q}”` : EMPTY[folder].title}
                  description={
                    q
                      ? "Search looks through senders, recipients, subjects and messages, but not spam."
                      : EMPTY[folder].description
                  }
                />
              ) : (
                <ul className="flex flex-col">
                  {mailConversations(shownList.messages).map(({ mail, count }) => (
                    <MailRow
                      key={mail.threadId}
                      mail={mail}
                      count={count}
                      folder={folder}
                      search={q !== ""}
                      selected={mail.threadId === threadId}
                      onOpen={() =>
                        onNavigate({ ...where, thread: mail.threadId, message: mail.id })
                      }
                    />
                  ))}
                  {shownList.next ? (
                    <li className="flex justify-center p-3">
                      <Button size="sm" variant="outline" disabled={loadingMore} onClick={loadMore}>
                        {loadingMore ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
                        Load more
                      </Button>
                    </li>
                  ) : null}
                </ul>
              )
            ) : listError?.key === listKey ? (
              <Notice
                icon={<MailIcon />}
                title="Couldn't load your agents' mail"
                description={listError.message}
              >
                <Button size="sm" variant="outline" onClick={loadList}>
                  Try again
                </Button>
              </Notice>
            ) : (
              <div className="flex flex-col gap-2 p-3">
                {[0, 1, 2, 3, 4].map((row) => (
                  <Skeleton key={row} className="h-16 w-full" />
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
      {!mobile || threadId ? (
        <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!threadId ? (
            <Notice
              icon={<MailIcon />}
              title="Pick a message to read it"
              description={`Your agents' address is ${props.email}. Mail to it, and what they send from it, shows here.`}
            />
          ) : shownThread ? (
            <MailConversation
              key={shownThread.id}
              thread={shownThread}
              picked={search.message ?? null}
              onBack={mobile ? () => onNavigate(where) : null}
            />
          ) : threadError?.id === threadId ? (
            <Notice
              icon={<MailIcon />}
              title="Couldn't open that conversation"
              description={threadError.message}
            >
              <Button size="sm" variant="outline" onClick={loadThread}>
                Try again
              </Button>
            </Notice>
          ) : (
            <div className="flex flex-col gap-3 p-5">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
        </section>
      ) : null}
    </MailShell>
  );
}

function MailListHeader(props: {
  readonly folder: AldoMailFolder;
  readonly q: string;
  readonly onFolder: (folder: AldoMailFolder) => void;
  readonly onSearch: (q: string) => void;
}) {
  const [typed, setTyped] = useState(props.q);
  useEffect(() => setTyped(props.q), [props.q]);
  return (
    <div className="flex flex-col gap-2 border-border/60 border-b p-3">
      <ToggleGroup
        aria-label="Folder"
        variant="segmented"
        value={props.q ? [] : [props.folder]}
        onValueChange={(next) => {
          const value = ALDO_MAIL_FOLDERS.find((entry) => entry.value === next[0])?.value;
          if (value) props.onFolder(value);
          // Picking the folder that's open while searching goes back to it.
          else if (props.q) props.onFolder(props.folder);
        }}
      >
        {ALDO_MAIL_FOLDERS.map((entry) => (
          <Toggle key={entry.value} value={entry.value}>
            {entry.label}
          </Toggle>
        ))}
      </ToggleGroup>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSearch(typed.trim());
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search mail"
            placeholder="Search mail"
            value={typed}
            maxLength={200}
            onChange={(event) => setTyped(event.currentTarget.value)}
          />
          {props.q ? (
            <InputGroupAddon align="inline-end">
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Clear search"
                onClick={() => props.onSearch("")}
              >
                <XIcon />
              </Button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </form>
    </div>
  );
}

function MailRow(props: {
  readonly mail: AldoMailSummary;
  /** How many of its conversation's messages are listed. */
  readonly count: number;
  readonly folder: AldoMailFolder;
  readonly search: boolean;
  readonly selected: boolean;
  readonly onOpen: () => void;
}) {
  const { mail } = props;
  // Mail the agents sent themselves is in the inbox too, where who wrote it is what's shown.
  const sent = props.search ? mail.sent : props.folder === "sent";
  return (
    <li>
      <button
        type="button"
        aria-current={props.selected ? "true" : undefined}
        className={cn(
          "flex w-full flex-col gap-0.5 border-border/50 border-b px-4 py-3 text-left transition-colors hover:bg-accent/50",
          props.selected && "bg-accent/70 hover:bg-accent/70",
        )}
        onClick={props.onOpen}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate font-medium text-sm">
            {mailRowPeople({ ...mail, sent })}
          </span>
          {props.count > 1 ? (
            <span className="shrink-0 text-muted-foreground text-xs">{props.count}</span>
          ) : null}
          {props.search && mail.sent ? (
            <Badge size="sm" variant="secondary">
              Sent
            </Badge>
          ) : null}
          <time className="ms-auto shrink-0 text-muted-foreground text-xs" dateTime={mail.at}>
            {formatMailTime(mail.at)}
          </time>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm">{mail.subject || "(no subject)"}</span>
          {mail.attachments > 0 ? (
            <PaperclipIcon
              aria-label={`${mail.attachments} attachment${mail.attachments === 1 ? "" : "s"}`}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
        </span>
        {mail.preview ? (
          <span className="line-clamp-2 text-muted-foreground text-xs">{mail.preview}</span>
        ) : null}
      </button>
    </li>
  );
}

function MailConversation(props: {
  readonly thread: AldoMailThread;
  readonly picked: string | null;
  readonly onBack: (() => void) | null;
}) {
  const { thread } = props;
  const last = thread.messages.at(-1)?.id ?? null;
  const first = thread.messages.some((m) => m.id === props.picked) ? props.picked : last;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(first ? [first] : []));
  // Another of its messages picked in the list opens too.
  const [opened, setOpened] = useState(first);
  if (first !== opened) {
    setOpened(first);
    if (first) setOpen((current) => new Set(current).add(first));
  }
  const [remote, setRemote] = useState(false);
  const hidden =
    !remote && thread.messages.some((m) => (m.html ? hasRemoteMailContent(m.html) : false));
  const spam = thread.messages.some((m) => m.spam);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-2 border-border/60 border-b px-4 py-3">
        {props.onBack ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back to mail"
            className="-ms-1.5"
            onClick={props.onBack}
          >
            <ArrowLeftIcon />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="break-words font-semibold text-base leading-snug">
            {thread.subject || "(no subject)"}
          </h2>
          <p className="text-muted-foreground text-xs">
            {thread.messages.length === 1 ? "1 message" : `${thread.messages.length} messages`}
            {spam ? " · in spam" : ""}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-3 sm:p-4">
          {hidden ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
              <ImageIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Images from the web are hidden, so senders don't learn this was opened.
              </span>
              <Button size="xs" variant="outline" onClick={() => setRemote(true)}>
                Show images
              </Button>
            </div>
          ) : null}
          {thread.messages.map((message) => (
            <MailMessageView
              key={message.id}
              message={message}
              threadId={thread.id}
              open={thread.messages.length === 1 || open.has(message.id)}
              foldable={thread.messages.length > 1}
              focus={thread.messages.length > 1 && message.id === first && first !== last}
              remote={remote}
              onToggle={() => toggle(message.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Avatar(props: { readonly label: string }) {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground text-xs uppercase"
    >
      {props.label.trim().charAt(0) || "?"}
    </span>
  );
}

function MailMessageView(props: {
  readonly message: AldoMailMessage;
  readonly threadId: string;
  readonly open: boolean;
  readonly foldable: boolean;
  /** Scrolled to when the conversation opens: the message picked in the list. */
  readonly focus: boolean;
  readonly remote: boolean;
  readonly onToggle: () => void;
}) {
  const { message } = props;
  const [showQuoted, setShowQuoted] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (props.focus) ref.current?.scrollIntoView({ block: "start" });
    // As it's picked, not as the conversation is read again.
  }, [props.focus]);
  const sender = parseMailAddress(message.from);
  const name = sender.name || sender.address || "Unknown sender";
  if (!props.open) {
    return (
      <article ref={ref} className="rounded-xl border border-border/70 bg-card/40">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
          onClick={props.onToggle}
        >
          <Avatar label={name} />
          <span className="w-24 shrink-0 truncate font-medium text-sm sm:w-40">{name}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
            {mailSnippet(message)}
          </span>
          <time className="shrink-0 text-muted-foreground text-xs" dateTime={message.at}>
            {formatMailTime(message.at)}
          </time>
        </button>
      </article>
    );
  }
  const body = mailBody(message, showQuoted);
  const files = mailFiles(message);
  const recipients = [
    message.to.length ? `to ${message.to.map(mailPersonLabel).join(", ")}` : "",
    message.cc.length ? `cc ${message.cc.map(mailPersonLabel).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const header = (
    <>
      <Avatar label={name} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-sm">{name}</span>
          {sender.name && sender.address ? (
            <span className="min-w-0 truncate text-muted-foreground text-xs">{sender.address}</span>
          ) : null}
          {message.sent ? (
            <Badge size="sm" variant="secondary">
              Sent
            </Badge>
          ) : null}
          {message.spam ? (
            <Badge size="sm" variant="warning">
              Spam
            </Badge>
          ) : null}
        </span>
        {recipients ? (
          <span className="break-words text-muted-foreground text-xs">{recipients}</span>
        ) : null}
      </span>
      <time className="shrink-0 text-muted-foreground text-xs" dateTime={message.at}>
        <span className="sm:hidden">{formatMailTime(message.at)}</span>
        <span className="max-sm:hidden">{formatMailDate(message.at)}</span>
      </time>
    </>
  );
  return (
    <article
      ref={ref}
      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/40 p-3 sm:p-4"
    >
      {props.foldable ? (
        <button
          type="button"
          aria-expanded
          className="-m-1 flex items-start gap-3 rounded-lg p-1 text-left transition-colors hover:bg-accent/40"
          onClick={props.onToggle}
        >
          {header}
        </button>
      ) : (
        <div className="flex items-start gap-3">{header}</div>
      )}
      {body?.kind === "html" ? (
        <AldoMailFrame
          html={body.content}
          images={message.attachments}
          remote={props.remote}
          title={`Message from ${name}`}
        />
      ) : body ? (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {linkifyMailText(body.content).map((part) =>
            part.kind === "link" ? (
              <a
                key={part.start}
                href={part.value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {part.value}
              </a>
            ) : (
              <span key={part.start}>{part.value}</span>
            ),
          )}
        </div>
      ) : message.clipped ? null : (
        <p className="text-muted-foreground text-sm italic">No text.</p>
      )}
      {message.clipped ? (
        <p className="text-muted-foreground text-xs">
          This message is too long to show here in full. An agent can read all of it.
        </p>
      ) : null}
      {body?.quotes ? (
        <div>
          <Button
            size="xs"
            variant="ghost"
            className="-ms-2 text-muted-foreground"
            onClick={() => setShowQuoted((shown) => !shown)}
          >
            {body.quoteHidden ? "Show quoted text" : "Hide quoted text"}
          </Button>
        </div>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Attachments">
          {files.map((file) => (
            <li key={file.id}>
              <a
                href={aldoMailAttachmentUrl(props.threadId, file.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-accent/50"
              >
                <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{file.filename || "Attachment"}</span>
                <span className="shrink-0 text-muted-foreground">{formatMailSize(file.size)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
