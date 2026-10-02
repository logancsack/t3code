import type { OrchestrationThread } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { EnvironmentShellStatus } from "./shell.ts";

export type EnvironmentThreadStatus = "empty" | "cached" | "synchronizing" | "live" | "deleted";

/**
 * Pagination state for a windowed thread. Present only when the loaded thread
 * is a window (the server returned `page` metadata); absent means the thread is
 * fully loaded — either the server predates pagination or the window reached
 * the top.
 */
export interface EnvironmentThreadPageState {
  /** Opaque exclusive cursor for the next older slice; null when fully loaded. */
  readonly beforeCursor: string | null;
  readonly hasMore: boolean;
  /** True while an older page fetch is in flight. */
  readonly loadingOlder: boolean;
}

export interface EnvironmentThreadState {
  readonly data: Option.Option<OrchestrationThread>;
  readonly status: EnvironmentThreadStatus;
  readonly error: Option.Option<string>;
  readonly page: Option.Option<EnvironmentThreadPageState>;
  /**
   * With status "deleted": the server answered "not found" several times
   * running, rather than reporting the thread deleted (shouldRefollowThread).
   */
  readonly notFound?: boolean;
}

export const EMPTY_ENVIRONMENT_THREAD_STATE: EnvironmentThreadState = {
  data: Option.none(),
  status: "empty",
  error: Option.none(),
  page: Option.none(),
};

/** Whether the thread has older turns that can be loaded with more pages. */
export function threadHasOlderTurns(state: EnvironmentThreadState): boolean {
  return Option.match(state.page, {
    onNone: () => false,
    onSome: (page) => page.hasMore,
  });
}

/**
 * Whether a thread taken for deleted should be followed again: the server
 * didn't know it, and its live shell lists it now, so it exists. A thread
 * asked for before it existed (opened from a notification or a link while its
 * first message was on its way, or its machine was starting) is taken for
 * deleted after a few "not found"s and isn't followed again on its own, so it
 * stayed missing for as long as it was open. A thread the server reported
 * deleted is left alone.
 */
export function shouldRefollowThread(input: {
  readonly state: Pick<EnvironmentThreadState, "status" | "notFound">;
  readonly listed: boolean;
  readonly shellStatus: EnvironmentShellStatus | undefined;
}): boolean {
  return (
    input.state.status === "deleted" &&
    input.state.notFound === true &&
    input.listed &&
    input.shellStatus === "live"
  );
}

/** The version of its shell each thread was last followed again for. */
const refollowedAt = new Map<string, string>();

/**
 * Follows a thread again (`refollow`, which restarts its state) once per
 * version of its shell, so a server that lists a thread it can't load isn't
 * asked for it over and over.
 */
export function refollowThreadOnce(
  threadKey: string,
  shellVersion: string,
  refollow: () => void,
): void {
  if (refollowedAt.get(threadKey) === shellVersion) return;
  refollowedAt.set(threadKey, shellVersion);
  refollow();
}
