// What a member's page, Members and Running now share (orgAdmin.logic.ts): a
// read of members' work that refreshes, the dot for a running machine, a
// running thread's row with its Stop, and the yes before stopping one thread
// or everything. Aldo decides who may stop what; this shows its words when it
// refuses.

import { useCallback, useEffect, useRef, useState } from "react";

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
import { Textarea } from "../components/ui/textarea";
import { toastManager } from "../components/ui/toast";
import { cn } from "../lib/utils";
import { aldoOrgAdmin } from "./accountApi";
import { ErrorLine } from "./AldoOrgParts";
import {
  aldoRunningDetail,
  aldoStopAllSentence,
  aldoStopSentence,
  type AldoRunningThread,
} from "./orgAdmin.logic";
import { settingsOrgUsage } from "./settingsData";

const messageOf = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : "Something went wrong. Try again.";

/**
 * A read for one page: undefined while the first answer comes, null when
 * there's none (an Aldo without it, or someone no longer there), and its
 * error. It reads again on focus and every `everyMs`, keeping what it had.
 * `read` is the one it was mounted with; key the component to change it.
 */
export function useOrgRead<T>(read: () => Promise<T | null>, everyMs?: number) {
  const [data, setData] = useState<T | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const reader = useRef(read);
  const ticket = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const next = await reader.current();
      if (mine !== ticket.current) return;
      setData(next);
      setError(null);
    } catch (cause) {
      if (mine === ticket.current) setError(messageOf(cause));
    }
  }, []);
  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    const timer = everyMs ? window.setInterval(() => void reload(), everyMs) : undefined;
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer) window.clearInterval(timer);
      ticket.current++;
    };
  }, [everyMs, reload]);
  return { data, error, reload };
}

/** A blue dot: a machine is running. */
export function RunningDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full bg-info", className)}
    />
  );
}

/** A running thread: its title, whose, its machines and their rate, and Stop when the user may. */
export function RunningRow(props: {
  thread: AldoRunningThread;
  /** Show whose it is (Running now); a member's page leaves it out. */
  whose?: boolean;
  you: string;
  onStop: (thread: AldoRunningThread) => void;
}) {
  const { thread } = props;
  const whose = thread.member.id === props.you ? "You" : thread.member.email;
  return (
    <div className="flex min-h-12 items-center gap-3 px-3 py-2.5 sm:px-4">
      <RunningDot />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-foreground text-sm [overflow-wrap:anywhere]">
          {thread.title || "Untitled thread"}
        </span>
        <span className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
          {props.whose ? `${whose} · ` : ""}
          {aldoRunningDetail(thread)}
        </span>
      </span>
      {thread.canStop ? (
        <Button size="sm" variant="outline" onClick={() => props.onStop(thread)}>
          Stop
        </Button>
      ) : null}
    </div>
  );
}

/** Refreshes what Members shows after a change elsewhere. */
export function refreshOrgUsage() {
  void settingsOrgUsage.refresh().catch(() => undefined);
}

/** The yes before stopping one thread's machines, with a note to its member if it's theirs. */
export function StopSheet(props: {
  thread: AldoRunningThread;
  you: string;
  onClose: () => void;
  onStopped: () => void;
}) {
  const { thread } = props;
  const yours = thread.member.id === props.you;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = () => {
    setBusy(true);
    setError(null);
    aldoOrgAdmin
      .stop(thread.id, note.trim())
      .then(
        () => {
          toastManager.add({
            type: "success",
            title: "Machines stopped",
            description: thread.title,
          });
          refreshOrgUsage();
          props.onStopped();
          props.onClose();
        },
        (cause: unknown) => setError(messageOf(cause)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8 [overflow-wrap:anywhere]">
            Stop “{thread.title || "Untitled thread"}”?
          </DialogTitle>
          <DialogDescription>{aldoStopSentence(thread, yours)}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {yours ? null : (
            <label className="block space-y-1.5">
              <span className="text-sm">Note to {thread.member.email} (optional)</span>
              <Textarea
                value={note}
                maxLength={300}
                rows={2}
                placeholder="Back on Monday, please"
                onChange={(event) => setNote(event.currentTarget.value)}
              />
            </label>
          )}
          <ErrorLine error={error} />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={busy}>
            Cancel
          </DialogClose>
          <Button variant="destructive" disabled={busy} onClick={stop}>
            Stop machines
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** The yes before stopping everything the user may stop (only `member`'s, when given). */
export function StopAllSheet(props: {
  threads: ReadonlyArray<AldoRunningThread>;
  member?: { readonly id: string; readonly email: string };
  onClose: () => void;
  onStopped: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = props.threads.filter((t) => t.canStop).length;
  const stop = () => {
    setBusy(true);
    setError(null);
    aldoOrgAdmin
      .stopAll({ note: note.trim(), ...(props.member ? { member: props.member.id } : {}) })
      .then(
        (stopped) => {
          toastManager.add({
            type: "success",
            title:
              stopped === 1
                ? "1 thread’s machines stopped"
                : `${stopped} threads’ machines stopped`,
          });
          refreshOrgUsage();
          props.onStopped();
          props.onClose();
        },
        (cause: unknown) => {
          setError(messageOf(cause));
          // Some may have stopped: show what's running now.
          props.onStopped();
        },
      )
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8">
            {props.member ? `Stop all of ${props.member.email}’s machines?` : `Stop all ${count}?`}
          </DialogTitle>
          <DialogDescription>{aldoStopAllSentence(props.threads)}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="block space-y-1.5">
            <span className="text-sm">Note for each thread (optional)</span>
            <Textarea
              value={note}
              maxLength={300}
              rows={2}
              onChange={(event) => setNote(event.currentTarget.value)}
            />
          </label>
          <ErrorLine error={error} />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={busy}>
            Cancel
          </DialogClose>
          <Button variant="destructive" disabled={busy || !count} onClick={stop}>
            Stop {count === 1 ? "1 thread" : `${count} threads`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
