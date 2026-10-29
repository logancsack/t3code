import { MonitorIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useIsMobile } from "../hooks/useMediaQuery";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";

/** Keep the breadcrumb readable when Preview and Thread tools are both present on a phone. */
export function AldoThreadHeaderActions({ children }: { readonly children: ReactNode }) {
  const mobile = useIsMobile();
  if (!mobile) return children;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Preview and thread tools"
            className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <MonitorIcon aria-hidden className="size-[18px]" />
      </PopoverTrigger>
      <PopoverPopup width="sm" align="end" padding="compact">
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </PopoverPopup>
    </Popover>
  );
}
