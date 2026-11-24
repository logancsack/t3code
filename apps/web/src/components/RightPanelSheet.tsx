import { T } from "gt-react";
import { type ReactNode, useRef } from "react";

import { isAldoCloud } from "../aldo/api";
import { cn } from "../lib/utils";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "./ui/sheet";

export function RightPanelSheet(props: {
  animationDurationMs: number;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  // Opening focuses the panel itself: on a phone the first control is the open file's tab.
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        transitionDurationMs={props.animationDurationMs}
        side="right"
        showCloseButton={false}
        keepMounted
        {...(isAldoCloud ? { initialFocus: contentRef } : {})}
        className={cn(
          "w-[min(42vw,28rem)] min-w-80 max-w-[28rem] max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0 wco:mt-(--workspace-topbar-height) wco:h-[calc(100%-var(--workspace-topbar-height))] wco:max-h-[calc(100%-var(--workspace-topbar-height))]",
          isAldoCloud && "max-sm:w-full max-sm:max-w-none",
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>
            <T>Workspace panel</T>
          </SheetTitle>
        </SheetHeader>
        {isAldoCloud ? (
          <div
            ref={contentRef}
            tabIndex={-1}
            className="flex h-full min-h-0 flex-col bg-background outline-none max-sm:pt-safe max-sm:pb-safe"
          >
            {props.children}
          </div>
        ) : (
          props.children
        )}
      </SheetPopup>
    </Sheet>
  );
}
