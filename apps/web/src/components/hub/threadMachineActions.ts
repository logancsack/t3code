import type { ScopedThreadRef } from "@t3tools/contracts";

/**
 * Explicit machine lifecycle requests for a hub thread.
 *
 * The hub's `threadMachines.wake` / `threadMachines.pause` RPCs are not in
 * the client contracts yet, so explicit wake is reported as unsupported and
 * every caller hides its affordance. A turn (send, retry) and a terminal
 * still wake the machine on their own.
 *
 * TODO(thread-machines): call the `threadMachines.wake({ threadId })` RPC
 * here once it is part of `WsRpcGroup`, and flip the flag.
 */
export const THREAD_MACHINE_WAKE_SUPPORTED = false;

export async function requestThreadMachineWake(
  _threadRef: ScopedThreadRef,
): Promise<"requested" | "unsupported"> {
  return "unsupported";
}
