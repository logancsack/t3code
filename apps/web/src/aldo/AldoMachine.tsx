import { CpuIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { MenuGroup, MenuGroupLabel, MenuItem } from "../components/ui/menu";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  getAldoEnvironments,
  subscribeAldoEnvironments,
  type AldoEnvironment,
  type AldoMachineSize,
} from "./directory";
import { setAldoMachine } from "./workspaceApi";

const MACHINE_LABELS: Record<AldoMachineSize, string> = {
  standard: "Standard: 4 vCPU, 8 GB, 1 credit an hour",
  "2x": "2×: 8 vCPU, 16 GB, 2 credits an hour",
};

/** Reports already offered in this tab, so each shows once. */
const offered = new Set<string>();
const activeOffers = new Map<string, ReturnType<typeof toastManager.add>>();

function dismissMachineOffer(environmentId: string): void {
  const toastId = activeOffers.get(environmentId);
  if (toastId === undefined) return;
  toastManager.close(toastId);
  activeOffers.delete(environmentId);
}

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
      title: size === "2x" ? "Upgrading to a 2× computer" : "Switching back to a standard computer",
      description: "Its computer restarts in a moment, and the agent carries on where it left off.",
      timeout: 8000,
    });
  } catch (cause) {
    toastManager.add({
      type: "error",
      title: "Couldn't change its computer",
      description: cause instanceof Error ? cause.message : String(cause),
      timeout: 10_000,
    });
  }
}

/**
 * Offers a 2× computer when this thread's computer reports running short (out
 * of memory, or every CPU busy) while its agent works. Only an older Aldo,
 * which sizes computers by hand: one that sizes them itself shows a report as
 * information where the thread is listed (AldoHomeBoard.tsx).
 */
export function useAldoMachineOffer(environmentId: string): void {
  const environment = useAldoEnvironment(environmentId);
  const machine = environment?.machine ?? "standard";
  const automatic = environment?.machineSizing === "automatic";
  const pressure = environment?.pressure;
  useEffect(() => {
    if (automatic || machine !== "standard") {
      dismissMachineOffer(environmentId);
      return;
    }
    if (!pressure) return;
    const key = `${environmentId}:${pressure.at}`;
    if (offered.has(key)) return;
    offered.add(key);
    dismissMachineOffer(environmentId);
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "warning",
        title:
          pressure.kind === "memory"
            ? "This thread's computer is running low on memory"
            : "This thread's computer has every CPU busy",
        description: `${pressure.detail} A 2× computer has 8 vCPUs and 16 GB and uses 2 credits an hour instead of 1. Upgrading restarts it, and the agent carries on where it left off.`,
        timeout: 0,
        actionProps: {
          children: "Upgrade to 2×",
          onClick: () => {
            toastManager.close(toastId);
            if (activeOffers.get(environmentId) === toastId) activeOffers.delete(environmentId);
            void switchMachine(environmentId, "2x");
          },
        },
      }),
    );
    activeOffers.set(environmentId, toastId);
  }, [automatic, environmentId, machine, pressure]);
}

/**
 * The Previews menu's word on the thread's computer. Aldo sizes every
 * computer itself (memory grows with the work), so there's nothing to choose;
 * an older Aldo that sizes them by hand offers the switch.
 */
export function AldoMachineMenuSection(props: { environmentId: string }) {
  const environment = useAldoEnvironment(props.environmentId);
  if (!environment) return null;
  const machine = environment.machine ?? "standard";
  const automatic = environment.machineSizing === "automatic";
  const other: AldoMachineSize = machine === "2x" ? "standard" : "2x";
  return (
    <MenuGroup>
      <MenuGroupLabel className="flex items-center gap-1.5">
        <CpuIcon aria-hidden="true" className="size-3.5" />
        {automatic ? "Its computer" : `Its computer: ${MACHINE_LABELS[machine]}`}
      </MenuGroupLabel>
      {automatic ? (
        <MenuItem closeOnClick={false} className="cursor-default flex-col items-start gap-0.5">
          <span>8 vCPUs · up to 32 GB memory</span>
          <span className="text-xs text-muted-foreground">Memory grows with your work.</span>
        </MenuItem>
      ) : (
        <MenuItem onClick={() => void switchMachine(props.environmentId, other)}>
          {other === "2x"
            ? "Upgrade to 2× (8 vCPU, 16 GB, 2 credits an hour)"
            : "Switch back to standard (4 vCPU, 8 GB, 1 credit an hour)"}
        </MenuItem>
      )}
    </MenuGroup>
  );
}
