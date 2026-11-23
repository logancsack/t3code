import { randomUUID } from "../lib/utils";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { AldoPlacePage } from "./AldoPlaces";
import { AldoApiError } from "./api";
import { linkRuns } from "./assistant.logic";
import { boardAction, listBoards, type BoardStep, type BoardView } from "./boardsApi";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ALL = "board-update";

/** Boards stays a record of the work. Only directed requests wake agents. */
export function AldoBoardsPage() {
  const [directory, setDirectory] = useState<Awaited<ReturnType<typeof listBoards>> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardView | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"create" | "add" | "command" | "schedule" | null>(null);
  const [command, setCommand] = useState("");
  const [text, setText] = useState("");
  const [to, setTo] = useState(ALL);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [earlier, setEarlier] = useState(false);
  const drafts = useRef(new Map<string, string>());
  const messagesRef = useRef<HTMLOListElement>(null);
  const nearBottom = useRef(true);
  const selectedRef = useRef(selected);
  const requestKey = useRef<string | null>(null);
  const sending = useRef(false);
  const historyRef = useRef(false);
  const keyFingerprint = useRef("");
  const keyFor = (value: unknown) => {
    const fingerprint = JSON.stringify([selected, value]);
    if (keyFingerprint.current !== fingerprint || !requestKey.current) {
      keyFingerprint.current = fingerprint;
      requestKey.current = randomUUID();
    }
    return requestKey.current;
  };

  const choose = useCallback((id: string | null) => {
    nearBottom.current = true;
    selectedRef.current = id;
    setSelected(id);
    setBoard(null);
    setEarlier(false);
    historyRef.current = false;
    setTo(ALL);
    setReplyTo(null);
    setText(id ? (drafts.current.get(id) ?? "") : "");
  }, []);
  const loadDirectory = useCallback(async () => {
    try {
      const next = await listBoards();
      setDirectory(next);
      if (selectedRef.current === null) choose(next.boards[0]?.id ?? null);
    } catch (e) {
      if (e instanceof AldoApiError && e.status === 404) setUnsupported(true);
      else setError(messageOf(e));
    }
  }, [choose]);
  const loadBoard = useCallback(async (id: string) => {
    const next = await boardAction<BoardView>({ action: "read", board: id });
    if (selectedRef.current === id)
      setBoard((current) =>
        current?.id === id && historyRef.current
          ? {
              ...next,
              posts: [
                ...current.posts.filter((p) => !next.posts.some((n) => n.id === p.id)),
                ...next.posts,
              ],
              earlier: current.earlier,
            }
          : next,
      );
  }, []);
  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);
  useEffect(() => {
    if (!selected) return;
    const refresh = () => {
      if (!document.hidden) void loadBoard(selected).catch((e) => setError(messageOf(e)));
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, [selected, loadBoard]);
  useEffect(() => {
    const messages = messagesRef.current;
    if (board && messages && nearBottom.current && !historyRef.current)
      messages.scrollTop = messages.scrollHeight;
  }, [board]);
  const act = async (input: Record<string, unknown>, close = false) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await boardAction<{ id?: string }>({ board: selected, ...input });
      if (close) setDialog(null);
      if (input.action === "schedule") setStatus("Routine created.");
      await loadDirectory();
      if (input.action === "create" && result.id) choose(result.id);
      else if (selected) await loadBoard(selected);
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
      sending.current = false;
    }
  };
  const post = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await act({
        action: "post",
        text,
        ...(to !== ALL ? { to } : {}),
        replyTo,
        key: keyFor(["post", text, to, replyTo]),
      })
    ) {
      if (selected) drafts.current.delete(selected);
      setText("");
      setReplyTo(null);
      requestKey.current = null;
    }
  };
  const run = async (name: string) => {
    if (await act({ action: "run", name, key: keyFor(["run", name]) })) requestKey.current = null;
  };
  const older = async () => {
    if (!board?.earlier) return;
    setBusy(true);
    try {
      const next = await boardAction<BoardView>({
        action: "read",
        board: board.id,
        before: board.earlier,
      });
      setBoard((current) =>
        current?.id === next.id
          ? { ...current, posts: [...next.posts, ...current.posts], earlier: next.earlier }
          : current,
      );
      setEarlier(true);
      historyRef.current = true;
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AldoPlacePage title="Boards">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Shared work</h2>
            <p className="text-sm text-muted-foreground">
              A place for you and your task agents to compare notes.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!directory || busy}
            onClick={() => setDialog("create")}
          >
            New board
          </Button>
        </div>
        {status ? (
          <p role="status" className="text-sm">
            {status}{" "}
            <Link to="/routines" className="underline underline-offset-4">
              Manage in Routines
            </Link>
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <p className="text-destructive-foreground">{error}</p>
            <Button
              variant="outline"
              onClick={() => {
                setError(null);
                void loadDirectory();
                if (selected) void loadBoard(selected).catch((e) => setError(messageOf(e)));
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {unsupported ? (
          <p>This Aldo does not have boards yet.</p>
        ) : !directory ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading boards…
          </p>
        ) : directory.boards.length === 0 ? (
          <div className="flex flex-col gap-3 border-y border-border py-8">
            <h3 className="font-medium">No shared work yet</h3>
            <p className="max-w-lg text-sm text-muted-foreground">
              Create a board and add the threads working on the same outcome. You can also ask Aldo
              from Home.
            </p>
          </div>
        ) : (
          <>
            <Select
              value={selected}
              onValueChange={(id) => {
                if (id) choose(id);
              }}
            >
              <SelectTrigger disabled={busy} aria-label="Board" className="w-full sm:w-80">
                <SelectValue>
                  {directory.boards.find((b) => b.id === selected)?.title ?? "Choose a board"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {directory.boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {!board || board.id !== selected ? (
              <p role="status">Loading messages…</p>
            ) : (
              <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
                <section className="min-w-0" aria-label="Board messages">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">Messages</h3>
                    <span className="text-xs text-muted-foreground">
                      Private to you and these agents
                    </span>
                  </div>
                  {board.earlier ? (
                    <Button variant="outline" disabled={busy} onClick={() => void older()}>
                      Earlier messages
                    </Button>
                  ) : null}
                  {earlier ? (
                    <p className="mb-3 text-xs text-muted-foreground">
                      Earlier messages are open.{" "}
                      <button
                        className="underline"
                        onClick={() => {
                          setEarlier(false);
                          historyRef.current = false;
                          void loadBoard(board.id);
                        }}
                      >
                        Back to latest
                      </button>
                    </p>
                  ) : null}
                  <ol
                    ref={messagesRef}
                    tabIndex={0}
                    aria-label="Messages, oldest to newest"
                    onScroll={(event) => {
                      const el = event.currentTarget;
                      nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                    }}
                    className="max-h-[44dvh] overflow-y-auto divide-y divide-border focus-visible:outline-2 focus-visible:outline-ring"
                    aria-live="polite"
                    aria-relevant="additions"
                  >
                    {board.posts.map((p) => (
                      <li key={p.id} className="py-4">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                          <span className="font-medium">{p.author}</span>
                          <span className="text-xs text-muted-foreground">
                            {p.kind === "user" ? "" : p.kind === "home" ? "Home" : "Agent"}
                          </span>
                          <time className="ml-auto text-xs text-muted-foreground" dateTime={p.at}>
                            {new Date(p.at).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                        {p.replyTo ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Reply to{" "}
                            {board.posts.find((x) => x.id === p.replyTo)?.author ??
                              "an earlier message"}
                          </p>
                        ) : null}
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {linkRuns(p.body).map((run) =>
                            run.href ? (
                              <a
                                key={run.at}
                                href={run.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline underline-offset-4 hover:text-primary"
                              >
                                {run.text}
                              </a>
                            ) : (
                              run.text
                            ),
                          )}
                        </p>
                        {p.deliveries.map((d) => (
                          <p key={d.member} className="mt-2 text-xs text-muted-foreground">
                            {d.member}: {d.status}
                            {d.reason
                              ? ` · ${d.reason === "The T3 thread no longer exists." ? "Its thread is unavailable. Open it to check the work." : d.reason}`
                              : ""}
                          </p>
                        ))}
                        <button
                          type="button"
                          className="mt-2 min-h-11 sm:min-h-8 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={() => setReplyTo(p.id)}
                        >
                          Reply<span className="sr-only"> to {p.author}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {board.posts.length === 0 ? (
                    <p className="border-y border-border py-8 text-sm text-muted-foreground">
                      Post the question or context you want these agents to share.
                    </p>
                  ) : null}
                  <form className="mt-5 flex flex-col gap-3" onSubmit={(e) => void post(e)}>
                    {replyTo ? (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span>Replying to {board.posts.find((p) => p.id === replyTo)?.author}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setReplyTo(null)}
                        >
                          Cancel reply
                        </Button>
                      </div>
                    ) : null}
                    <label className="flex flex-col gap-2 text-sm">
                      Message
                      <Textarea
                        value={text}
                        maxLength={8000}
                        disabled={busy}
                        placeholder="Share context or ask an agent to take a look…"
                        onChange={(e) => {
                          setText(e.target.value);
                          if (selected) drafts.current.set(selected, e.target.value);
                          requestKey.current = null;
                        }}
                        required
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <Select
                        value={to}
                        onValueChange={(value) => {
                          setTo(value ?? ALL);
                          requestKey.current = null;
                        }}
                      >
                        <SelectTrigger
                          disabled={busy}
                          aria-label="Send to"
                          className="w-full sm:w-64"
                        >
                          <SelectValue>
                            {to === ALL
                              ? "Post an update"
                              : `Ask ${board.members.find((m) => m.id === to)?.name ?? "an agent"}`}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value={ALL}>Post an update</SelectItem>
                          {board.members.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              Ask {m.name}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <Button type="submit" disabled={busy || !text.trim()}>
                        {busy ? "Sending…" : to === ALL ? "Post update" : "Ask agent"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {to === ALL
                        ? "An update stays here. It does not start an agent."
                        : "Your request waits if the agent is busy or needs your answer. Its reply comes back here."}
                    </p>
                  </form>
                </section>
                <aside className="flex min-w-0 flex-col gap-6">
                  <section>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">Agents</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setDialog("add")}
                      >
                        Add agent
                      </Button>
                    </div>
                    <ul className="mt-2 flex flex-col gap-3">
                      {board.members.map((m) => (
                        <li key={m.id} className="flex items-start gap-2 text-sm">
                          <Link
                            to="/$environmentId/$threadId"
                            params={{ environmentId: m.environmentId, threadId: m.threadId }}
                            className="min-w-0 flex-1 break-words underline underline-offset-4 hover:text-primary"
                          >
                            {m.name}
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Remove ${m.name}`}
                            onClick={() => void act({ action: "remove", member: m.id })}
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                    {!board.members.length ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Add a thread to give its agent access.
                      </p>
                    ) : null}
                  </section>
                  <section>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">Commands</h3>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !board.members.length}
                        onClick={() => setDialog("command")}
                      >
                        New command
                      </Button>
                    </div>
                    {!board.commands.length ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Save instructions you run together.
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-4">
                        {board.commands.map((c) => (
                          <li key={c.name}>
                            <p className="text-sm font-medium">/{c.name}</p>
                            <ul className="mt-1 flex flex-col gap-2 text-xs text-muted-foreground">
                              {c.steps.map((s) => (
                                <li key={s.member}>
                                  <span className="font-medium">
                                    {board.members.find((m) => m.id === s.member)?.name ??
                                      "Removed agent"}
                                  </span>
                                  : {s.instruction}
                                </li>
                              ))}
                            </ul>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => void run(c.name)}
                              >
                                Run
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => {
                                  setCommand(c.name);
                                  setDialog("schedule");
                                }}
                              >
                                Schedule
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </aside>
              </div>
            )}
          </>
        )}
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {dialog === "create"
                ? "New board"
                : dialog === "add"
                  ? "Add an agent"
                  : dialog === "schedule"
                    ? `Schedule /${command}`
                    : "New command"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "create"
                ? "Give this shared work a name."
                : dialog === "add"
                  ? "Choose a task thread. Its agent can read and post on this board."
                  : dialog === "schedule"
                    ? "Each run sends these saved instructions. Manage the schedule in Routines."
                    : "Each run sends these exact instructions. The agents decide how to do the work."}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="my-3 text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
          {dialog === "command" && board ? (
            <CommandForm
              board={board}
              busy={busy}
              save={(steps) => act({ action: "save_command", ...steps }, true)}
            />
          ) : dialog ? (
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const data = Object.fromEntries(new FormData(event.currentTarget));
                if (dialog === "create") void act({ action: "create", title: data.title }, true);
                if (dialog === "add")
                  void act({ action: "add", thread: data.thread, name: data.name }, true);
                if (dialog === "schedule")
                  void act(
                    {
                      action: "schedule",
                      name: command,
                      schedule: { every: data.every, at: [data.at] },
                      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    },
                    true,
                  );
              }}
            >
              {dialog === "create" ? (
                <label className="flex flex-col gap-2 text-sm">
                  Board name
                  <Input name="title" maxLength={120} required autoFocus />
                </label>
              ) : dialog === "add" ? (
                <>
                  <label className="flex flex-col gap-2 text-sm">
                    Thread
                    <select
                      className="w-full rounded-md border border-input bg-background p-2"
                      name="thread"
                      required
                    >
                      {directory?.threads
                        .filter((t) => !board?.members.some((m) => m.thread.startsWith(t.ref)))
                        .map((t) => (
                          <option key={t.ref} value={t.ref}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm">
                    Agent name
                    <Input
                      name="name"
                      placeholder="Research, Finance, Review…"
                      maxLength={80}
                      required
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="flex flex-col gap-2 text-sm">
                    Repeat
                    <select
                      name="every"
                      className="rounded-md border border-input bg-background p-2"
                    >
                      <option value="weekdays">Weekdays</option>
                      <option value="day">Every day</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm">
                    At your local time
                    <Input name="at" type="time" defaultValue="09:00" required />
                  </label>
                </>
              )}
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Saving…"
                  : dialog === "create"
                    ? "Create board"
                    : dialog === "add"
                      ? "Add agent"
                      : "Create routine"}
              </Button>
            </form>
          ) : null}
        </DialogPopup>
      </Dialog>
    </AldoPlacePage>
  );
}

function CommandForm({
  board,
  busy,
  save,
}: {
  board: BoardView;
  busy: boolean;
  save: (input: { name: string; steps: BoardStep[] }) => Promise<unknown>;
}) {
  const [steps, setSteps] = useState<Array<BoardStep & { key: string }>>([
    { member: board.members[0]?.id ?? "", instruction: "", key: randomUUID() },
  ]);
  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({
          name: String(data.get("name")),
          steps: steps.map(({ member, instruction }) => ({ member, instruction })),
        });
      }}
    >
      <label className="flex flex-col gap-2 text-sm">
        Command name
        <Input name="name" pattern="[a-z][a-z0-9-]*" maxLength={40} placeholder="review" required />
      </label>
      {steps.map((s, i) => (
        <div key={s.key} className="flex flex-col gap-3 border-t border-border pt-4">
          <label className="flex flex-col gap-2 text-sm">
            Agent
            <select
              className="rounded-md border border-input bg-background p-2"
              value={s.member}
              onChange={(e) =>
                setSteps((current) =>
                  current.map((step, j) => (j === i ? { ...step, member: e.target.value } : step)),
                )
              }
            >
              {board.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Instructions
            <Textarea
              maxLength={8000}
              required
              value={s.instruction}
              onChange={(e) =>
                setSteps((current) =>
                  current.map((step, j) =>
                    j === i ? { ...step, instruction: e.target.value } : step,
                  ),
                )
              }
            />
          </label>
        </div>
      ))}
      {steps.length < Math.min(6, board.members.length) ? (
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setSteps((current) => [
              ...current,
              {
                member:
                  board.members.find((m) => !current.some((s) => s.member === m.id))?.id ?? "",
                instruction: "",
                key: randomUUID(),
              },
            ])
          }
        >
          Add another agent
        </Button>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save command"}
      </Button>
    </form>
  );
}
