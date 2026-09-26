import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";

/**
 * Lifecycle of the machine a hub-mode thread runs on. Standalone servers never
 * report it. See docs/internals/thread-machines.md.
 */
export const ThreadMachineState = Schema.Literals([
  "none",
  "preparing",
  "starting",
  "running",
  "paused",
  "saved",
  "failed",
]);
export type ThreadMachineState = typeof ThreadMachineState.Type;

/** The latest machine state a hub knows for a thread, shown without waking it. */
export const ThreadMachineStatus = Schema.Struct({
  state: ThreadMachineState,
  detail: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type ThreadMachineStatus = typeof ThreadMachineStatus.Type;

/** Thread activity kinds a hub records for its thread machines. */
export const THREAD_MACHINE_ACTIVITY_KINDS = {
  /** Every machine state transition; payload `ThreadMachineStateActivityPayload`. */
  state: "thread-machine.state",
  /** The runner is cloning or preparing the thread's checkout. */
  checkoutPreparing: "thread-machine.checkout.preparing",
  /** Bootstrap or checkout preparation failed; tone `error`, payload `{ detail }`. */
  failed: "thread-machine.failed",
} as const;

/** Payload of a `thread-machine.state` activity (tone `error` when `failed`). */
export const ThreadMachineStateActivityPayload = Schema.Struct({
  state: ThreadMachineState,
  detail: Schema.NullOr(Schema.String),
  bootId: Schema.NullOr(Schema.String),
});
export type ThreadMachineStateActivityPayload = typeof ThreadMachineStateActivityPayload.Type;

/**
 * Hub mode: a `prepareWorktree.baseBranch` of `"HEAD"` means "the repository's
 * default branch". The thread's runner resolves it from `origin/HEAD`, so a
 * client that has not picked a base ref never needs a branch list first.
 */
export const DEFAULT_BRANCH_BASE_REF = "HEAD";
