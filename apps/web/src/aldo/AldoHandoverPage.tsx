// A copy of a thread handed to the user as a colleague left their
// organization (offboarding.logic.ts), at /library/handed/$handoverId: its
// conversations to read, its files to download and what was left out of
// them, the routines it ran, and carrying it on in a thread of the user's
// own, whose agent reads it first. Deleting it is the user's too.

import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, DownloadIcon, LoaderCircleIcon, PaperclipIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Skeleton } from "../components/ui/skeleton";
import { Textarea } from "../components/ui/textarea";
import { toastManager } from "../components/ui/toast";
import { cn } from "../lib/utils";
import { aldoOffboarding } from "./accountApi";
import { ALDO_COPYING_EVERY_MS } from "./AldoHandedToYou";
import { Confirm, ErrorLine } from "./AldoOrgParts";
import { AldoPlacePage } from "./AldoPlaces";
import { AgentMarkdown, Quoted } from "./AldoQuoted";
import { AldoApiError } from "./api";
import { readAldoDirectory } from "./directory";
import { formatMailSize } from "./mail.logic";
import {
  ALDO_CARRY_ON_DEFAULT,
  aldoConversationTitle,
  aldoHandoverAbout,
  aldoHandoverCode,
  aldoHandoverFilesMore,
  type AldoHandoverConversation,
  type AldoHandoverView,
  type AldoThreadTarget,
} from "./offboarding.logic";
import { aldoOrgDay } from "./organization.logic";

const messageOf = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : "Something went wrong. Try again.";

type ViewRead =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly view: AldoHandoverView }
  | { readonly kind: "gone" }
  | { readonly kind: "copying"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/** /library/handed/$handoverId: a copy handed to the user, to read, download and carry on. */
export function AldoHandoverPage({ handoverId }: { handoverId: string }) {
  const navigate = useNavigate();
  const [read, setRead] = useState<ViewRead>({ kind: "loading" });
  const [carrying, setCarrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Only the latest read's answer shows.
  const latest = useRef(0);
  const load = useCallback(() => {
    const request = ++latest.current;
    aldoOffboarding.view(handoverId).then(
      (view) =>
        request === latest.current && setRead(view ? { kind: "ready", view } : { kind: "gone" }),
      (cause: unknown) =>
        request === latest.current &&
        setRead(
          cause instanceof AldoApiError && cause.status === 409
            ? { kind: "copying", message: messageOf(cause) }
            : { kind: "failed", message: messageOf(cause) },
        ),
    );
  }, [handoverId]);
  useEffect(() => {
    load();
    return () => {
      latest.current += 1;
    };
  }, [load]);
  // Still being made: look again until it's there.
  useEffect(() => {
    if (read.kind !== "copying") return;
    const timer = window.setTimeout(load, ALDO_COPYING_EVERY_MS);
    return () => window.clearTimeout(timer);
  }, [read, load]);
  const view = read.kind === "ready" ? read.view : null;
  const open = (target: AldoThreadTarget) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: target.environmentId as EnvironmentId,
        threadId: target.threadId as ThreadId,
      },
    });

  return (
    <AldoPlacePage
      title={view?.title.trim() || "Handed to you"}
      parent={{ label: "Library", to: "/library" }}
    >
      {read.kind === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-9 w-48 rounded-lg" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : read.kind === "gone" ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm">
            This copy isn’t here anymore. It may have been deleted, or handed to someone else.
          </p>
          <Button size="sm" variant="outline" render={<Link to="/library" />}>
            Back to the Library
          </Button>
        </div>
      ) : read.kind === "copying" || read.kind === "failed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p
            role={read.kind === "failed" ? "alert" : undefined}
            className={cn(
              "min-w-0 flex-1 text-sm",
              read.kind === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
            )}
          >
            {read.kind === "copying" ? (
              <LoaderCircleIcon
                aria-hidden="true"
                className="me-1.5 inline size-3.5 animate-spin align-[-2px]"
              />
            ) : null}
            {read.message}
          </p>
          <Button size="sm" variant="outline" onClick={load}>
            Try again
          </Button>
        </div>
      ) : view ? (
        <>
          <header className="flex flex-col gap-1">
            <h2 className="font-semibold text-foreground text-lg leading-tight [overflow-wrap:anywhere]">
              {view.title.trim() || "Untitled"}
            </h2>
            <p className="text-muted-foreground text-sm [overflow-wrap:anywhere]">
              {aldoHandoverAbout(view)}
            </p>
          </header>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {view.continued ? (
                <Button onClick={() => view.continued && open(view.continued)}>
                  Open your thread
                </Button>
              ) : (
                <Button onClick={() => setCarrying(true)}>Carry it on</Button>
              )}
              {view.fileCount ? (
                <Button
                  variant="outline"
                  render={<a href={aldoOffboarding.filesUrl(view.id)} download />}
                >
                  <DownloadIcon /> Download files · {formatMailSize(view.bytes)}
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {view.continued
                ? "You carried it on in a thread of your own, with its files and conversation."
                : "Carrying it on starts a thread of your own, in General, with its files and conversation for its agent to read first."}
            </p>
          </div>
          {aldoHandoverCode(view) ? (
            <p className="text-sm [overflow-wrap:anywhere]">{aldoHandoverCode(view)}</p>
          ) : null}

          <Section
            title={
              view.conversations.length === 1
                ? "Conversation"
                : `Conversations · ${view.conversations.length}`
            }
          >
            {view.conversations.length ? (
              view.conversations.map((c, i) => (
                <ConversationCard
                  key={c.id}
                  conversation={c}
                  thread={view.title}
                  from={view.from}
                  defaultOpen={i === 0}
                />
              ))
            ) : (
              <p className="text-muted-foreground text-sm">No conversation was copied.</p>
            )}
          </Section>

          <FilesSection view={view} />

          {view.left.length ? (
            <Section title={`Left out · ${view.left.length}`}>
              <ul className="overflow-hidden rounded-xl border">
                {view.left.map((l) => (
                  <li
                    key={l.name}
                    className="flex flex-col gap-0.5 border-t px-3 py-2.5 first:border-t-0"
                  >
                    <span className="text-sm [overflow-wrap:anywhere]">{l.name}</span>
                    <span className="text-muted-foreground text-xs">{l.why}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {view.routines.length ? (
            <Section
              title={
                view.routines.length === 1
                  ? "Its routine"
                  : `Its routines · ${view.routines.length}`
              }
            >
              <p className="px-1 text-muted-foreground text-xs">
                {view.routines.length === 1 ? "It stopped" : "They stopped"} when {view.from} left.
                Set {view.routines.length === 1 ? "it" : "them"} up again in your thread if you
                still need {view.routines.length === 1 ? "it" : "them"}.
              </p>
              <ul className="overflow-hidden rounded-xl border">
                {view.routines.map((r) => (
                  <li
                    key={r.key}
                    className="flex flex-col gap-1 border-t px-3 py-2.5 first:border-t-0"
                  >
                    <span className="font-medium text-sm [overflow-wrap:anywhere]">{r.title}</span>
                    <Quoted lines={3} className="text-muted-foreground text-xs whitespace-pre-wrap">
                      {r.instruction}
                    </Quoted>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <div className="border-t pt-4">
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive-foreground"
              onClick={() => setDeleting(true)}
            >
              Delete this copy
            </Button>
          </div>

          {carrying ? (
            <CarryOnSheet
              view={view}
              onClose={() => setCarrying(false)}
              onStarted={(target) => {
                setCarrying(false);
                open(target);
              }}
            />
          ) : null}
          <Confirm
            open={deleting}
            onOpenChange={setDeleting}
            title="Delete this copy?"
            description={`Its conversation and files are gone for good.${view.continued ? " Your thread that carries it on stays." : ""}`}
            action="Delete copy"
            onConfirm={async () => {
              await aldoOffboarding.delete(view.id);
              toastManager.add({ type: "success", title: "Copy deleted" });
              void navigate({ to: "/library", replace: true });
            }}
          />
        </>
      ) : null}
    </AldoPlacePage>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-medium text-muted-foreground text-xs">{props.title}</h3>
      {props.children}
    </section>
  );
}

/** Messages a conversation shows at first, and more each time it's asked. */
const SHOWN = 20;
const MORE = 50;

/** One conversation, its newest messages first shown and the earlier ones a tap away. */
function ConversationCard(props: {
  conversation: AldoHandoverConversation;
  thread: string;
  from: string;
  defaultOpen: boolean;
}) {
  const { conversation } = props;
  const [open, setOpen] = useState(props.defaultOpen);
  const [shown, setShown] = useState(SHOWN);
  const messages = conversation.messages;
  const hidden = Math.max(0, messages.length - shown);
  const title = aldoConversationTitle(conversation, props.thread);
  return (
    <div className="overflow-hidden rounded-xl border">
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
        onClick={() => setOpen((was) => !was)}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 text-sm [overflow-wrap:anywhere]">
            {title}
            {conversation.archived ? (
              <Badge variant="outline" size="sm" className="font-normal text-muted-foreground">
                Archived
              </Badge>
            ) : null}
          </span>
          <span className="text-muted-foreground text-xs">
            {messages.length === 1 ? "1 message" : `${messages.length} messages`}
          </span>
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground/70 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-4 border-t px-3 py-3">
          {hidden ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setShown((n) => n + MORE)}
            >
              Show {Math.min(hidden, MORE)} earlier
            </Button>
          ) : null}
          {messages.slice(-shown).map((m) => (
            <div key={m.key} className="flex min-w-0 flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                {m.role === "user" ? props.from : m.role === "assistant" ? "Agent" : m.role}
                {m.createdAt ? ` · ${aldoOrgDay(m.createdAt)}` : ""}
              </span>
              {m.role === "assistant" ? (
                <Quoted lines={10} className="text-sm">
                  <AgentMarkdown text={m.text} />
                </Quoted>
              ) : (
                <Quoted
                  lines={6}
                  className="rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap"
                >
                  {m.text}
                </Quoted>
              )}
              {m.attachments.length ? (
                <span className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
                  {m.attachments.map((a) => (
                    <span
                      key={a}
                      className="inline-flex items-center gap-1 [overflow-wrap:anywhere]"
                    >
                      <PaperclipIcon aria-hidden="true" className="size-3" /> {a}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Files a copy's list shows at first. */
const FILES_SHOWN = 25;

function FilesSection({ view }: { view: AldoHandoverView }) {
  const [all, setAll] = useState(false);
  if (!view.fileCount) {
    return (
      <Section title="Files">
        <p className="text-muted-foreground text-sm">No files were copied.</p>
      </Section>
    );
  }
  const files = all ? view.files : view.files.slice(0, FILES_SHOWN);
  const more = aldoHandoverFilesMore(view);
  return (
    <Section title={`Files · ${view.fileCount}`}>
      <ul className="overflow-hidden rounded-xl border">
        {files.map((f) => (
          <li
            key={f.name}
            className="flex min-h-10 items-center justify-between gap-3 border-t px-3 py-2 first:border-t-0"
          >
            <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{f.name}</span>
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
              {formatMailSize(f.bytes)}
            </span>
          </li>
        ))}
      </ul>
      {!all && view.files.length > FILES_SHOWN ? (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setAll(true)}>
          Show all {view.files.length}
        </Button>
      ) : null}
      {more ? <p className="px-1 text-muted-foreground text-xs">{more}</p> : null}
    </Section>
  );
}

/** How long carrying on waits for the directory to list the new thread before opening it anyway. */
const LISTED_WITHIN_MS = 4_000;

/** Carrying a copy on: what its first message adds, then the new thread opens. */
function CarryOnSheet(props: {
  view: AldoHandoverView;
  onClose: () => void;
  onStarted: (target: AldoThreadTarget) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    aldoOffboarding
      .carryOn(props.view.id, text)
      .then(async (target) => {
        // Listed first, so the thread opens as one that's starting.
        await Promise.race([
          readAldoDirectory(),
          new Promise((resolve) => window.setTimeout(resolve, LISTED_WITHIN_MS)),
        ]);
        props.onStarted(target);
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause));
        setBusy(false);
      });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Carry it on</DialogTitle>
            <DialogDescription>
              A thread of your own starts in General, with this copy’s files in a folder and its
              conversation in HANDOVER.md. Its agent reads them first.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-2">
            <label htmlFor="aldo-carry-on" className="font-medium text-sm">
              What should it do next?{" "}
              <span className="font-normal text-muted-foreground">Optional</span>
            </label>
            <Textarea
              id="aldo-carry-on"
              rows={3}
              value={text}
              disabled={busy}
              placeholder={ALDO_CARRY_ON_DEFAULT}
              onChange={(event) => setText(event.currentTarget.value)}
            />
            <ErrorLine error={error} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? "Starting…" : "Start thread"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
