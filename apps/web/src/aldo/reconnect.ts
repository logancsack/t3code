// A tab connects to a machine that woke without it. Connecting never wakes a
// machine, so a connection Aldo told "asleep" waits to be told to try again
// (cloud.ts); dispatch.ts tells it while this tab brings the machine up for
// a message, and nothing did when the machine was woken by something else:
// Aldo's own work on it (a routine, a reminder, a message it held), another
// device, or a start that took longer than this tab waited. The thread then
// showed Aldo's copies, which say nothing of a turn under way, until the page
// was reloaded. Now every directory fetch (every 15 seconds, and sooner when
// asked) tells the connections of machines the directory says are up to try
// again; one that's really asleep is told so again, and waits.

import type { EnvironmentId } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";

import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { getAldoEnvironments, isAldoCloud, subscribeAldoEnvironments } from "./cloud";
import { aldoMachinesToRetry } from "./reconnect.logic";

/** A registered machine's connection phase as presented; "available" is one waiting to be told to try again. */
function phaseOf(environmentId: string): string | undefined {
  return appAtomRegistry
    .get(environmentPresentations.presentationsAtom)
    .get(environmentId as EnvironmentId)?.connection.phase;
}

export function installAldoReconnect(): void {
  if (!isAldoCloud) return;
  subscribeAldoEnvironments(() => {
    for (const environmentId of aldoMachinesToRetry(getAldoEnvironments() ?? [], phaseOf)) {
      void runAtomCommand(
        appAtomRegistry,
        environmentCatalog.retryNow,
        environmentId as EnvironmentId,
        { reportFailure: false },
      );
    }
  });
}
