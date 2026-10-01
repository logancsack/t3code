import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { MonitorIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

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
  aldoComputerNotice,
  aldoComputerStartOutcome,
  aldoComputerStoppable,
  type AldoComputer,
  type AldoComputerNotice,
} from "./computer.logic";

type ToastId = ReturnType<typeof toastManager.add>;

/**
 * This tab's answers to asks, by environment, until the directory stops
 * reporting the ask, and the computers it's stopping. Kept outside React so
 * that leaving the thread and coming back before the directory catches up
 * doesn't offer an answered ask again.
 */
const answers = new Map<string, boolean>();
const stopping = new Map<string, true>();
const listeners = new Set<() => void>();

function set<T>(entries: Map<string, T>, environmentId: string, value: T | undefined): void {
  if (entries.get(environmentId) === value) return;
  if (value === undefined) entries.delete(environmentId);
  else entries.set(environmentId, value);
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
  }
>();

async function answer(environmentId: string, approve: boolean): Promise<void> {
  // Once per ask: a second click before the toast goes doesn't answer again.
  if (answers.has(environmentId)) return;
  set(answers, environmentId, approve);
  try {
    await answerAldoComputer(environmentId, approve);
  } catch (cause) {
    // Asked again, unless it isn't asking anymore (answered elsewhere): the directory settles that.
    const gone = cause instanceof AldoApiError && cause.status === 404;
    set(answers, environmentId, gone ? false : undefined);
    requestAldoDirectoryRefresh();
    toastManager.add({
      type: "error",
      title: approve ? "Couldn't start your Windows computer" : "Couldn't answer your agent",
      description: cause instanceof Error ? cause.message : String(cause),
      timeout: 10_000,
    });
  }
}

/**
 * Stops the thread's Windows computer and says what Aldo made of it, once at
 * a time; true when Aldo answered (then nothing shows it as running for long).
 */
export async function stopAldoWindowsComputer(environmentId: string): Promise<boolean> {
  if (stopping.has(environmentId)) return false;
  set(stopping, environmentId, true);
  try {
    const message = await stopAldoComputer(environmentId);
    toastManager.add({
      type: "info",
      title: "Your Windows computer",
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
            title: "Couldn't stop your Windows computer",
            description: cause instanceof Error ? cause.message : String(cause),
            timeout: 10_000,
          },
    );
    return false;
  } finally {
    set(stopping, environmentId, undefined);
  }
}

/**
 * The thread's Windows computer (null when it has none), with this tab's
 * answer to its ask and whether it's stopping it.
 */
export function useAldoComputer(environmentId: string): {
  readonly computer: AldoComputer | null;
  readonly answer: boolean | undefined;
  readonly stopping: boolean;
} {
  const computer = useSyncExternalStore(
    subscribeAldoEnvironments,
    () =>
      getAldoEnvironments()?.find((environment) => environment.environmentId === environmentId)
        ?.computer ?? null,
    () => null,
  );
  const answered = useSyncExternalStore(
    subscribe,
    () => answers.get(environmentId),
    () => undefined,
  );
  const isStopping = useSyncExternalStore(
    subscribe,
    () => stopping.has(environmentId),
    () => false,
  );
  // Once the directory no longer reports the ask, a new one is asked again.
  useEffect(() => {
    set(answers, environmentId, aldoComputerKeptAnswer(computer, answered));
  }, [answered, computer, environmentId]);
  return { computer, answer: answered, stopping: isStopping };
}

/**
 * Asks the user, in the thread, when its agent asks for their Windows computer
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
    const description =
      notice === "ask" && computer
        ? aldoComputerAskDescription(computer)
        : "Your agent hears when it's ready.";
    // Stopping is offered once Aldo is starting it, not while the answer is on its way.
    const stoppable = notice === "starting" && aldoComputerStoppable(computer);
    // Stopping takes its toast down (as closed by the user: not offered again while it winds down).
    const stopAction = (toastId: () => ToastId) => ({
      children: "Stop",
      onClick: () => {
        toastManager.close(toastId());
        void stopAldoWindowsComputer(environmentId);
      },
    });
    const current = shown.get(environmentId);
    if (current?.notice === notice) {
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
    const threadRef = scopeThreadRef(environmentId as EnvironmentId, threadId);
    if (current) {
      shown.delete(environmentId);
      const outcome = current.notice === "starting" ? aldoComputerStartOutcome(computer) : null;
      if (current.id === null) {
        // Closed by the user: nothing to take down.
      } else if (outcome === "ready") {
        const readyId = current.id;
        toastManager.update(
          readyId,
          stackedThreadToast({
            type: "success",
            title: "Your Windows computer is running",
            description: "See it in the Desktop view: choose Windows.",
            timeout: 8000,
            actionProps: stopAction(() => readyId),
            actionVariant: "outline",
            data: { threadRef },
          }),
        );
      } else if (outcome === "failed") {
        toastManager.update(current.id, {
          type: "error",
          title: "Your Windows computer didn't start",
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
    const leadingIcon = <MonitorIcon className="size-4 text-info" aria-hidden />;
    // Closed by the user (with ✕ or a swipe), not by this hook, which forgets it first.
    const onClose = () => {
      if (shown.get(environmentId)?.id === id) {
        shown.set(environmentId, { notice, id: null, description, stoppable });
      }
    };
    const id: ToastId = toastManager.add({
      ...(notice === "ask"
        ? stackedThreadToast({
            type: "info",
            title: "Your agent asks for your Windows computer",
            description,
            timeout: 0,
            actionProps: {
              children: "Start it",
              onClick: () => void answer(environmentId, true),
            },
            data: {
              threadRef,
              leadingIcon,
              secondaryActionProps: {
                children: "Not now",
                onClick: () => void answer(environmentId, false),
              },
            },
          })
        : stackedThreadToast({
            type: "info",
            title: "Starting your Windows computer…",
            description,
            timeout: 0,
            ...(stoppable ? { actionProps: stopAction(() => id) } : {}),
            actionVariant: "outline",
            data: { threadRef, leadingIcon },
          })),
      onClose,
    });
    shown.set(environmentId, { notice, id, description, stoppable });
  }, [answered, computer, environmentId, threadId]);
}
