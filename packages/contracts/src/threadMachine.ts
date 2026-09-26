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
