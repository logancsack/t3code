/**
 * Narrow hooks through which hub mode changes shared server code.
 *
 * Each is a `Context.Reference` whose default is standalone behavior, so
 * standalone servers and existing tests never provide them. The hub layer set
 * (`hub/HubLayers.ts`) provides hub implementations. See
 * docs/internals/thread-machines.md.
 *
 * @module serverModeHooks
 */
import type {
  AuthConnectorError,
  AuthConnectorSession,
  AuthConnectorStartInput,
  AuthConnectorSubmitInput,
  ClientOrchestrationCommand,
  OrchestrationDispatchCommandError,
  ProjectId,
  ProviderSignInList,
  ProviderSignOutInput,
  ProviderSignOutResult,
  ThreadId,
  ThreadMachineControlError,
  ThreadMachineStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/**
 * Provider runtime ingestion derives command ids from the runtime event id
 * instead of a random suffix. In hub mode runners replay events after a hub
 * restart, and deterministic ids turn every already-committed command into a
 * receipt replay instead of a duplicate.
 */
export class DeterministicIngestionCommandIds extends Context.Reference<boolean>(
  "t3/serverModeHooks/DeterministicIngestionCommandIds",
  { defaultValue: () => false },
) {}

export interface ThreadCheckoutBootstrapInput {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | undefined;
  /** Branch the thread should work on; null keeps the checkout's branch. */
  readonly branch: string | null;
  /** Base ref for a branch that does not exist yet. */
  readonly baseRef: string | null;
}

export interface ThreadCheckoutBootstrapResult {
  readonly worktreePath: string;
  readonly branch: string | null;
}

export interface HubThreadCheckoutsShape {
  /** Rewrites a client command before normalization (virtual roots, checkout paths). */
  readonly rewriteClientCommand: (
    command: ClientOrchestrationCommand,
  ) => ClientOrchestrationCommand;
  /**
   * Bootstrap of a thread in hub mode: ensure and wake its machine, then
   * prepare the checkout (clone or fetch, branch). Records progress and
   * failures as thread activities.
   */
  readonly bootstrap: (
    input: ThreadCheckoutBootstrapInput,
  ) => Effect.Effect<ThreadCheckoutBootstrapResult, OrchestrationDispatchCommandError>;
  /** Before a turn: make sure the thread's checkout exists on its (awake) machine. */
  readonly ensureForTurn: (thread: {
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
  }) => Effect.Effect<void>;
}

/** Hub thread-checkout provisioning; `null` keeps the standalone local worktree logic. */
export class HubThreadCheckouts extends Context.Reference<HubThreadCheckoutsShape | null>(
  "t3/serverModeHooks/HubThreadCheckouts",
  { defaultValue: () => null },
) {}

export interface ThreadMachineStatusReaderShape {
  /**
   * The latest machine state a hub knows for a thread, read synchronously
   * while thread shells are mapped. `null` means no machine is known;
   * `undefined` (standalone) omits the shell field entirely.
   */
  readonly get: (threadId: ThreadId) => ThreadMachineStatus | null | undefined;
}

/** Thread-machine state for thread shells; standalone servers never report one. */
export class ThreadMachineStatusReader extends Context.Reference<ThreadMachineStatusReaderShape>(
  "t3/serverModeHooks/ThreadMachineStatusReader",
  { defaultValue: () => ({ get: () => undefined }) },
) {}

/** Spreads a thread's machine state into a shell; nothing in standalone mode. */
export const threadMachineShellField = (
  reader: ThreadMachineStatusReaderShape,
  threadId: ThreadId,
): { readonly machine?: ThreadMachineStatus | null } => {
  const machine = reader.get(threadId);
  return machine === undefined ? {} : { machine };
};

export interface ThreadMachineControlsShape {
  /** Resumes or recreates the thread's machine; returns once the directory accepted. */
  readonly wake: (
    threadId: ThreadId,
  ) => Effect.Effect<ThreadMachineStatus | null, ThreadMachineControlError>;
  /** Releases the hub's hold on the machine so the platform may pause it. */
  readonly pause: (
    threadId: ThreadId,
  ) => Effect.Effect<ThreadMachineStatus | null, ThreadMachineControlError>;
}

/** `threadMachines.wake` / `threadMachines.pause`; `null` (standalone) answers `unsupported`. */
export class ThreadMachineControls extends Context.Reference<ThreadMachineControlsShape | null>(
  "t3/serverModeHooks/ThreadMachineControls",
  { defaultValue: () => null },
) {}

export interface ProviderSignInControlsShape {
  readonly start: (
    input: AuthConnectorStartInput,
  ) => Effect.Effect<AuthConnectorSession, AuthConnectorError>;
  readonly get: (sessionId: string) => Effect.Effect<AuthConnectorSession, AuthConnectorError>;
  readonly submit: (
    input: AuthConnectorSubmitInput,
  ) => Effect.Effect<AuthConnectorSession, AuthConnectorError>;
  readonly cancel: (sessionId: string) => Effect.Effect<AuthConnectorSession, AuthConnectorError>;
  readonly list: Effect.Effect<ProviderSignInList, AuthConnectorError>;
  readonly signOut: (
    input: ProviderSignOutInput,
  ) => Effect.Effect<ProviderSignOutResult, AuthConnectorError>;
}

/**
 * Provider sign-in on a hub: the auth connector runs on the provider sign-in
 * machine and sign-ins are stored by the platform. `null` (standalone) keeps
 * the local `AuthConnectorManager`.
 */
export class ProviderSignInControls extends Context.Reference<ProviderSignInControlsShape | null>(
  "t3/serverModeHooks/ProviderSignInControls",
  { defaultValue: () => null },
) {}
