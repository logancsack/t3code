import { CpuIcon } from "lucide-react";

import { MenuGroup, MenuGroupLabel, MenuItem } from "../components/ui/menu";

/**
 * The Previews menu's word on the thread's computer. Aldo sizes every
 * computer itself (memory grows with the work), so there's nothing to choose;
 * a report of it running short shows as information where the thread is
 * listed (AldoHomeBoard.tsx).
 */
export function AldoMachineMenuSection() {
  return (
    <MenuGroup>
      <MenuGroupLabel className="flex items-center gap-1.5">
        <CpuIcon aria-hidden="true" className="size-3.5" />
        Its computer
      </MenuGroupLabel>
      <MenuItem closeOnClick={false} className="cursor-default flex-col items-start gap-0.5">
        <span>8 vCPUs · up to 32 GB memory</span>
        <span className="text-xs text-muted-foreground">Memory grows with your work.</span>
      </MenuItem>
    </MenuGroup>
  );
}
