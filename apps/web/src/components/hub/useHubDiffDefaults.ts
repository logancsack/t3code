import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";

import { useDiffPanelStore } from "../../diffPanelStore";
import { useIsHubEnvironment } from "../../hubMode";
import { useThreadShell } from "../../state/entities";
import { deriveThreadMachineView, type ThreadMachineView } from "../../threadMachine";

/**
 * A sleeping hub machine cannot answer working-tree or branch diffs, but the
 * hub keeps every captured turn diff. Until the user picks a scope, open the
 * diff panel on the latest turn instead of a view that would wake nothing and
 * show an error. Returns the machine while it cannot serve reads (asleep or
 * failed), `null` otherwise and off a hub.
 */
export function useDiffPanelTurnDefaultWhileMachineAsleep(
  threadRef: ScopedThreadRef | null | undefined,
  latestTurnId: TurnId | null,
): ThreadMachineView | null {
  const hub = useIsHubEnvironment(threadRef?.environmentId);
  const machine = useThreadShell(hub && threadRef ? threadRef : null)?.machine;
  const view = hub ? deriveThreadMachineView(machine) : null;
  const machineUnavailable = view?.phase === "asleep" || view?.phase === "failed";
  const hasStoredSelection = useDiffPanelStore((state) =>
    threadRef ? state.byThreadKey[scopedThreadKey(threadRef)] !== undefined : true,
  );
  useEffect(() => {
    if (!threadRef || !machineUnavailable || hasStoredSelection || latestTurnId === null) return;
    useDiffPanelStore.getState().selectTurn(threadRef, latestTurnId);
  }, [hasStoredSelection, latestTurnId, machineUnavailable, threadRef]);
  return machineUnavailable ? view : null;
}
