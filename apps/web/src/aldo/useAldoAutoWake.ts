import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { isAldoCloud, isAldoEnvironmentId, wakeAldoEnvironment } from "./cloud";

export type AldoWakeState =
  | { readonly status: "idle" }
  | { readonly status: "waking" }
  | { readonly status: "failed"; readonly message: string };

/**
 * Wakes the sandbox behind the thread being viewed when it's asleep, then asks
 * the connection supervisor to reconnect. A sleeping sandbox shows as
 * "available" because its connection is blocked as dormant.
 */
export function useAldoAutoWake(
  environmentId: EnvironmentId | null,
  phase: string,
  reconnect: (environmentId: EnvironmentId) => Promise<unknown>,
): { readonly state: AldoWakeState; readonly wake: () => void } {
  const [state, setState] = useState<AldoWakeState>({ status: "idle" });
  const attempted = useRef<string | null>(null);
  const applies = isAldoCloud && environmentId !== null && isAldoEnvironmentId(environmentId);

  const wake = useCallback(() => {
    if (!applies || environmentId === null) return;
    setState({ status: "waking" });
    void wakeAldoEnvironment(environmentId)
      .then(() => reconnect(environmentId))
      .then(() => setState({ status: "idle" }))
      .catch((cause: unknown) =>
        setState({
          status: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
  }, [applies, environmentId, reconnect]);

  useEffect(() => {
    if (!applies) return;
    if (phase === "connected") {
      // Allow another wake if the sandbox is stopped for idleness later on.
      attempted.current = null;
      return;
    }
    if (phase !== "available" || attempted.current === environmentId) return;
    attempted.current = environmentId;
    wake();
  }, [applies, environmentId, phase, wake]);

  useEffect(() => {
    setState({ status: "idle" });
  }, [environmentId]);

  return { state: applies ? state : { status: "idle" }, wake };
}
