import { type ReactNode } from "react";

import { Sheet, SheetPopup } from "./ui/sheet";

export function RightPanelSheet(props: {
  animationDurationMs: number;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
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
        // A phone gets the whole screen: a file or page is unreadable in a strip
        // beside the conversation.
        className="w-[min(42vw,28rem)] min-w-80 max-w-[28rem] max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0 max-sm:w-full max-sm:max-w-none wco:mt-[env(titlebar-area-height)] wco:h-[calc(100%-env(titlebar-area-height))] wco:max-h-[calc(100%-env(titlebar-area-height))]"
      >
        {/* Portaled outside the root, so full screen it keeps clear of the
            notch and the home indicator itself. */}
        <div className="flex h-full min-h-0 flex-col bg-background max-sm:pt-safe max-sm:pb-safe">
          {props.children}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
