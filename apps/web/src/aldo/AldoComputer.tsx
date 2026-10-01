import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CpuIcon, MonitorIcon, SquareIcon } from "lucide-react";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";

import { hiddenToastActionProps, stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  AldoApiError,
  answerAldoComputer,
  getAldoEnvironments,
  requestAldoDirectoryRefresh,
  stopAldoComputer,
  subscribeAldoEnvironments,
} from "./cloud";
import {
  aldoComputerAskDescription,
  aldoComputerKeptAnswer,
  aldoComputerName,
  aldoComputerNotice,
  aldoComputers,
  aldoComputerStartOutcome,
  aldoComputerStoppable,
  aldoComputerToastThread,
  type AldoComputer,
  type AldoComputerNotice,
} from "./computer.logic";

type ToastId = ReturnType<typeof toastManager.add>;

/**
 * This tab's answers to asks, by environment and kind (`key`), until the
 * directory stops reporting the ask, and the computers it's stopping. Kept
 * outside React so that leaving the thread and coming back before the
 * directory catches up doesn't offer an answered ask again.
 */
const answers = new Map<string, boolean>();
const stopping = new Map<string, true>();
const listeners = new Set<() => void>();

function key(environmentId: string, kind: string): string {
  return `${environmentId}:${kind}`;
}

function set<T>(entries: Map<string, T>, entry: string, value: T | undefined): void {
  if (entries.get(entry) === value) return;
  if (value === undefined) entries.delete(entry);
  else entries.set(entry, value);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The toast each environment shows about its computer in this tab, so each
 * shows once; `id` is null once the user closed it, until they leave the thread.
 */
const shown = new Map<
  string,
  {
    readonly notice: NonNullable<AldoComputerNotice>;
    readonly id: ToastId | null;
    readonly description: string;
    readonly stoppable: boolean;
    /** The thread it shows in. */
    readonly threadId: string;
    /** The computer it's about. */
    readonly kind: string;
  }
>();

async function answer(environmentId: string, kind: string, approve: boolean): Promise<void> {
  const entry = key(environmentId, kind);
  // Once per ask: a second click before the toast goes doesn't answer again.
  if (answers.has(entry)) return;
  set(answers, entry, approve);
  try {
    await answerAldoComputer(environmentId, approve, kind);
  } catch (cause) {
    // Asked again, unless it isn't asking anymore (answered elsewhere): the directory settles that.
    const gone = cause instanceof AldoApiError && cause.status === 404;
    set(answers, entry, gone ? false : undefined);
    requestAldoDirectoryRefresh();
    toastManager.add({
      type: "error",
      title: approve
        ? `Couldn't start your ${aldoComputerName({ kind })}`
        : "Couldn't answer your agent",
      description: cause instanceof Error ? cause.message : String(cause),
      timeout: 10_000,
    });
  }
}

/**
 * Stops the thread's computer of a kind and says what Aldo made of it, once
 * at a time; true when Aldo answered (then nothing shows it as running for long).
 */
export async function stopAldoThreadComputer(
  environmentId: string,
  kind: string,
): Promise<boolean> {
  const entry = key(environmentId, kind);
  const name = aldoComputerName({ kind });
  if (stopping.has(entry)) return false;
  set(stopping, entry, true);
  try {
    const message = await stopAldoComputer(environmentId, kind);
    toastManager.add({
      type: "info",
      title: `Your ${name}`,
      description: message,
      timeout: 8000,
    });
    return true;
  } catch (cause) {
    toastManager.add(
      cause instanceof AldoApiError && cause.status === 405
        ? {
            type: "error",
            title: "Can't stop it from here yet",
            description: "It stops when the thread is done.",
            timeout: 8000,
            data: { hideCopyButton: true },
          }
        : {
            type: "error",
            title: `Couldn't stop your ${name}`,
            description: cause instanceof Error ? cause.message : String(cause),
            timeout: 10_000,
          },
    );
    return false;
  } finally {
    set(stopping, entry, undefined);
  }
}

/**
 * The thread's computer of a kind, or without one the one to show first (null
 * when it has none), with this tab's answer to its ask and whether it's stopping it.
 */
export function useAldoComputer(
  environmentId: string,
  kind?: string,
): {
  readonly computer: AldoComputer | null;
  readonly answer: boolean | undefined;
  readonly stopping: boolean;
} {
  const environment = useSyncExternalStore(
    subscribeAldoEnvironments,
    () =>
      getAldoEnvironments()?.find((candidate) => candidate.environmentId === environmentId) ?? null,
    () => null,
  );
  const computers = useMemo(() => (environment ? aldoComputers(environment) : []), [environment]);
  const computer = (kind ? computers.find((c) => c.kind === kind) : computers[0]) ?? null;
  const entry = computer ? key(environmentId, computer.kind) : "";
  const answered = useSyncExternalStore(
    subscribe,
    () => (entry ? answers.get(entry) : undefined),
    () => undefined,
  );
  const isStopping = useSyncExternalStore(
    subscribe,
    () => (entry ? stopping.has(entry) : false),
    () => false,
  );
  // An answer is kept only while its computer still asks: once the directory stops reporting
  // the ask (whichever computer this thread shows first now), a new ask is asked again.
  useEffect(() => {
    const prefix = `${environmentId}:`;
    for (const [stored, value] of answers) {
      if (!stored.startsWith(prefix)) continue;
      const asking = computers.find((c) => c.kind === stored.slice(prefix.length));
      set(answers, stored, aldoComputerKeptAnswer(asking, value));
    }
  }, [answered, computers, environmentId]);
  return { computer, answer: answered, stopping: isStopping };
}

/**
 * While the thread's GPU computer starts or runs, a control in the thread's
 * header says so and stops it (it has no screen, so nothing else shows it).
 */
export function AldoGpuComputerControl(props: { environmentId: string }) {
  const { computer, stopping: isStopping } = useAldoComputer(props.environmentId, "gpu");
  if (!computer || !aldoComputerStoppable(computer)) return null;
  const running = computer.status === "running";
  return (
    <Menu>
      <MenuTrigger
        aria-label={running ? "Your GPU computer is running" : "Your GPU computer is starting"}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CpuIcon className={running ? "size-3.5 text-info" : "size-3.5 animate-pulse"} />
        <span className="hidden @3xl/header-actions:inline">GPU</span>
      </MenuTrigger>
      <MenuPopup align="end" className="w-72">
        <div className="space-y-1 px-2 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            {running ? "Your GPU computer is running" : "Your GPU computer is starting"}
          </p>
          <p>
            {aldoComputerAskDescription({ why: null, creditsPerHour: computer.creditsPerHour })}
          </p>
        </div>
        <MenuSeparator />
        <MenuItem
          disabled={isStopping}
          onClick={() => void stopAldoThreadComputer(props.environmentId, "gpu")}
        >
          <SquareIcon className="size-3.5" /> {isStopping ? "Stopping…" : "Stop it"}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/**
 * Asks the user, in the thread, when its agent asks for one of their computers
 * (it costs credits while it runs), then says it's starting until it runs,
 * with a way to stop it. An ask closed without an answer is asked again the
 * next time the thread opens.
 */
export function useAldoComputerAsk(environmentId: string, threadId: ThreadId): void {
  const { computer, answer: answered } = useAldoComputer(environmentId);

  // A toast the user closed is offered again once they've left the thread.
  useEffect(
    () => () => {
      if (shown.get(environmentId)?.id === null) shown.delete(environmentId);
    },
    [environmentId, threadId],
  );

  useEffect(() => {
    const notice = aldoComputerNotice(computer, answered);
    const kind = computer?.kind ?? "";
    const name = aldoComputerName(computer);
    const description =
      notice === "ask" && computer
        ? aldoComputerAskDescription(computer)
        : "Your agent hears when it's ready.";
    // Stopping is offered once Aldo is starting it, not while the answer is on its way.
    const stoppable = notice === "starting" && aldoComputerStoppable(computer);
    // A stop that went through takes its toast down (as closed by the user: not offered again
    // while it winds down); one that failed leaves it, to try again.
    const stopAction = (toastId: () => ToastId) => ({
      children: "Stop",
      onClick: () => {
        void stopAldoThreadComputer(environmentId, kind).then((stopped) => {
          if (stopped) toastManager.close(toastId());
        });
      },
    });
    const toastThreadId = aldoComputerToastThread(computer, threadId) as ThreadId;
    const current = shown.get(environmentId);
    // The same notice, for another thread (another thread asks, or the user opened the one that did)
    // or another computer: shown again, there or for it.
    if (
      current?.notice === notice &&
      (current.threadId !== toastThreadId || current.kind !== kind)
    ) {
      shown.delete(environmentId);
      if (current.id !== null) toastManager.close(current.id);
    } else if (current?.notice === notice) {
      // The agent asked again before the user answered, for another reason; or it can be stopped now.
      const currentId = current.id;
      if (
        currentId !== null &&
        (current.description !== description || current.stoppable !== stoppable)
      ) {
        toastManager.update(currentId, {
          description,
          ...(notice === "starting"
            ? { actionProps: stoppable ? stopAction(() => currentId) : hiddenToastActionProps }
            : {}),
        });
        shown.set(environmentId, { ...current, description, stoppable });
      }
      return;
    }
    const threadRef = scopeThreadRef(environmentId as EnvironmentId, toastThreadId);
    if (current && shown.has(environmentId)) {
      shown.delete(environmentId);
      // How its start ended, when it's still the same computer (not another one asking now).
      const outcome =
        current.notice === "starting" && current.kind === kind
          ? aldoComputerStartOutcome(computer)
          : null;
      if (current.id === null) {
        // Closed by the user: nothing to take down.
      } else if (outcome === "ready") {
        const readyId = current.id;
        toastManager.update(
          readyId,
          stackedThreadToast({
            type: "success",
            title: `Your ${aldoComputerName({ kind: current.kind })} is running`,
            description:
              current.kind === "windows"
                ? "See it in the Desktop view: choose Windows."
                : "Your agent uses it from its machine. It stops when the thread is done.",
            timeout: 8000,
            actionProps: stopAction(() => readyId),
            actionVariant: "outline",
            data: { threadRef },
          }),
        );
      } else if (outcome === "failed") {
        toastManager.update(current.id, {
          type: "error",
          title: `Your ${aldoComputerName({ kind: current.kind })} didn't start`,
          description: computer?.error ?? "Your agent can ask for it again.",
          timeout: 10_000,
          actionProps: hiddenToastActionProps,
          data: { threadRef },
        });
      } else {
        toastManager.close(current.id);
      }
    }
    if (!notice || !computer) return;
    const Icon = kind === "gpu" ? CpuIcon : MonitorIcon;
    const leadingIcon = <Icon className="size-4 text-info" aria-hidden />;
    // Closed by the user (with ✕ or a swipe), not by this hook, which forgets it first.
    const onClose = () => {
      if (shown.get(environmentId)?.id === id) {
        shown.set(environmentId, {
          notice,
          id: null,
          description,
          stoppable,
          threadId: toastThreadId,
          kind,
        });
      }
    };
    const id: ToastId = toastManager.add({
      ...(notice === "ask"
        ? stackedThreadToast({
            type: "info",
            title: `Your agent asks for your ${name}`,
            description,
            timeout: 0,
            actionProps: {
              children: "Start it",
              onClick: () => void answer(environmentId, kind, true),
            },
            data: {
              threadRef,
              leadingIcon,
              secondaryActionProps: {
                children: "Not now",
                onClick: () => void answer(environmentId, kind, false),
              },
            },
          })
        : stackedThreadToast({
            type: "info",
            title: `Starting your ${name}…`,
            description,
            timeout: 0,
            ...(stoppable ? { actionProps: stopAction(() => id) } : {}),
            actionVariant: "outline",
            data: { threadRef, leadingIcon },
          })),
      onClose,
    });
    shown.set(environmentId, {
      notice,
      id,
      description,
      stoppable,
      threadId: toastThreadId,
      kind,
    });
  }, [answered, computer, environmentId, threadId]);
}
