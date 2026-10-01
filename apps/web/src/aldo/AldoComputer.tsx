import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { MonitorIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  AldoApiError,
  answerAldoComputer,
  getAldoEnvironments,
  requestAldoDirectoryRefresh,
  subscribeAldoEnvironments,
} from "./cloud";
import {
  aldoComputerAskDescription,
  aldoComputerKeptAnswer,
  aldoComputerNotice,
  aldoComputerStartOutcome,
  type AldoComputerNotice,
} from "./computer.logic";

type ToastId = ReturnType<typeof toastManager.add>;

/**
 * This tab's answers to asks, by environment, until the directory stops
 * reporting the ask. Kept outside React so that leaving the thread and coming
 * back before the directory catches up doesn't offer an answered ask again.
 */
const answers = new Map<string, boolean>();
const answerListeners = new Set<() => void>();

function setAnswer(environmentId: string, answer: boolean | undefined): void {
  if (answers.get(environmentId) === answer) return;
  if (answer === undefined) answers.delete(environmentId);
  else answers.set(environmentId, answer);
  for (const listener of answerListeners) listener();
}

function subscribeAnswers(listener: () => void): () => void {
  answerListeners.add(listener);
  return () => answerListeners.delete(listener);
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
  }
>();

async function answer(environmentId: string, approve: boolean): Promise<void> {
  // Once per ask: a second click before the toast goes doesn't answer again.
  if (answers.has(environmentId)) return;
  setAnswer(environmentId, approve);
  try {
    await answerAldoComputer(environmentId, approve);
  } catch (cause) {
    // Asked again, unless it isn't asking anymore (answered elsewhere): the directory settles that.
    const gone = cause instanceof AldoApiError && cause.status === 404;
    setAnswer(environmentId, gone ? false : undefined);
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
 * Asks the user, in the thread, when its agent asks for their Windows computer
 * (it costs credits while it runs), then says it's starting until it runs. An
 * ask closed without an answer is asked again the next time the thread opens.
 */
export function useAldoComputerAsk(environmentId: string, threadId: ThreadId): void {
  const computer = useSyncExternalStore(
    subscribeAldoEnvironments,
    () =>
      getAldoEnvironments()?.find((environment) => environment.environmentId === environmentId)
        ?.computer ?? null,
    () => null,
  );
  const answered = useSyncExternalStore(
    subscribeAnswers,
    () => answers.get(environmentId),
    () => undefined,
  );

  // A toast the user closed is offered again once they've left the thread.
  useEffect(
    () => () => {
      if (shown.get(environmentId)?.id === null) shown.delete(environmentId);
    },
    [environmentId, threadId],
  );

  useEffect(() => {
    const kept = aldoComputerKeptAnswer(computer, answered);
    if (kept !== answered) {
      setAnswer(environmentId, kept);
      return;
    }
    const notice = aldoComputerNotice(computer, answered);
    const description =
      notice === "ask" && computer
        ? aldoComputerAskDescription(computer)
        : "Your agent hears when it's ready.";
    const current = shown.get(environmentId);
    if (current?.notice === notice) {
      // The agent asked again before the user answered, for another reason.
      if (current.id !== null && current.description !== description) {
        toastManager.update(current.id, { description });
        shown.set(environmentId, { ...current, description });
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
        toastManager.update(current.id, {
          type: "success",
          title: "Your Windows computer is running",
          description: "See it in the Desktop view: choose Windows.",
          timeout: 8000,
          data: { threadRef },
        });
      } else if (outcome === "failed") {
        toastManager.update(current.id, {
          type: "error",
          title: "Your Windows computer didn't start",
          description: computer?.error ?? "Your agent can ask for it again.",
          timeout: 10_000,
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
        shown.set(environmentId, { notice, id: null, description });
      }
    };
    const id: ToastId =
      notice === "ask"
        ? toastManager.add({
            ...stackedThreadToast({
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
            }),
            onClose,
          })
        : toastManager.add({
            type: "info",
            title: "Starting your Windows computer…",
            description,
            timeout: 0,
            data: { threadRef, leadingIcon },
            onClose,
          });
    shown.set(environmentId, { notice, id, description });
  }, [answered, computer, environmentId, threadId]);
}
