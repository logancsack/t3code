import { CpuIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { MenuGroup, MenuGroupLabel, MenuItem } from "../components/ui/menu";
import { getAldoEnvironments, subscribeAldoEnvironments, type AldoEnvironment } from "./directory";

function useAldoEnvironment(environmentId: string): AldoEnvironment | undefined {
  const environments = useSyncExternalStore(
    subscribeAldoEnvironments,
    getAldoEnvironments,
    () => null,
  );
  return environments?.find((environment) => environment.environmentId === environmentId);
}

/**
 * Retained export for thread views; Sailbox thread computers size automatically,
 * so manual 2× upgrade prompts are retired.
 */
export function useAldoMachineOffer(_environmentId: string): void {
  useEffect(() => {}, []);
}

/**
 * The Tools menu's summary of the thread's cloud computer.
 * Aldo sizes every thread computer automatically (memory grows with the work).
 */
export function AldoMachineMenuSection(props: { environmentId: string }) {
  const environment = useAldoEnvironment(props.environmentId);
  if (!environment) return null;
  return (
    <MenuGroup>
      <MenuGroupLabel className="flex items-center gap-1.5">
        <CpuIcon aria-hidden="true" className="size-3.5" />
        Agent’s computer
      </MenuGroupLabel>
      <MenuItem closeOnClick={false} className="cursor-default flex-col items-start gap-0.5">
        <span>8 vCPUs · up to 32 GB memory</span>
        <span className="text-xs text-muted-foreground">
          Memory grows automatically with your work.
        </span>
      </MenuItem>
    </MenuGroup>
  );
}
