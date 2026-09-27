import { CpuIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { MenuGroup, MenuGroupLabel, MenuItem } from "../components/ui/menu";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  getAldoEnvironments,
  setAldoMachine,
  subscribeAldoEnvironments,
  type AldoEnvironment,
  type AldoMachineSize,
} from "./cloud";

const MACHINE_LABELS: Record<AldoMachineSize, string> = {
  standard: "Standard: 4 vCPU, 8 GB, 1 credit an hour",
  "2x": "2×: 8 vCPU, 16 GB, 2 credits an hour",
};

/** Reports already offered in this tab, so each shows once. */
const offered = new Set<string>();

function useAldoEnvironment(environmentId: string): AldoEnvironment | undefined {
  const environments = useSyncExternalStore(
    subscribeAldoEnvironments,
    getAldoEnvironments,
    () => null,
  );
  return environments?.find((environment) => environment.environmentId === environmentId);
}

async function switchMachine(environmentId: string, size: AldoMachineSize): Promise<void> {
  try {
    await setAldoMachine(environmentId, size);
    toastManager.add({
      type: "success",
      title: size === "2x" ? "Upgrading to a 2× machine" : "Switching back to a standard machine",
      description: "The cloud agent restarts in a moment and carries on where it left off.",
      timeout: 8000,
    });
  } catch (cause) {
    toastManager.add({
      type: "error",
      title: "Couldn't change the machine",
      description: cause instanceof Error ? cause.message : String(cause),
      timeout: 10_000,
    });
  }
}

/**
 * Offers a 2× machine when this thread's machine reports running short (out
 * of memory, or every CPU busy) while its agent works.
 */
export function useAldoMachineOffer(environmentId: string): void {
  const environment = useAldoEnvironment(environmentId);
  const machine = environment?.machine ?? "standard";
  const pressure = environment?.pressure;
  useEffect(() => {
    if (!pressure || machine !== "standard") return;
    const key = `${environmentId}:${pressure.at}`;
    if (offered.has(key)) return;
    offered.add(key);
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "warning",
        title:
          pressure.kind === "memory"
            ? "This cloud agent is running low on memory"
            : "This cloud agent's CPUs are maxed out",
        description: `${pressure.detail} A 2× machine has 8 vCPUs and 16 GB and uses 2 credits an hour instead of 1. Upgrading restarts the machine, and the agent carries on where it left off.`,
        timeout: 0,
        actionProps: {
          children: "Upgrade to 2×",
          onClick: () => {
            toastManager.close(toastId);
            void switchMachine(environmentId, "2x");
          },
        },
      }),
    );
  }, [environmentId, machine, pressure]);
}

/** The Previews menu's machine section: its size, and a switch to the other one. */
export function AldoMachineMenuSection(props: { environmentId: string }) {
  const environment = useAldoEnvironment(props.environmentId);
  if (!environment) return null;
  const machine = environment.machine ?? "standard";
  const other: AldoMachineSize = machine === "2x" ? "standard" : "2x";
  return (
    <MenuGroup>
      <MenuGroupLabel className="flex items-center gap-1.5">
        <CpuIcon className="size-3.5" /> Machine: {MACHINE_LABELS[machine]}
      </MenuGroupLabel>
      <MenuItem onClick={() => void switchMachine(props.environmentId, other)}>
        {other === "2x"
          ? "Upgrade to 2× (8 vCPU, 16 GB, 2 credits an hour)"
          : "Switch back to standard (4 vCPU, 8 GB, 1 credit an hour)"}
      </MenuItem>
    </MenuGroup>
  );
}
