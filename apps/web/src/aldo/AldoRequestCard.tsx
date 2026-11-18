// The first message of a thread Aldo started for the user, shown as their
// request (request.logic.ts): their own words under "Your request, from Home",
// and the brief Aldo wrote for the agent behind "What Aldo told the agent".
// The timeline's user row renders the card's body and attachments; these are
// its frame, heading and disclosure.

import { ChevronRightIcon, CornerDownRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { aldoRequestLabel, type AldoRequestFrom } from "./request.logic";

/** The card in place of the user's bubble: full width, like the work it starts, in the bubble's colors (themes set them). */
export const ALDO_REQUEST_CARD_CLASS =
  "relative w-full rounded-xl border border-border/60 bg-message px-3.5 py-2.5 text-message-foreground";

export function AldoRequestHeading(props: { readonly from: AldoRequestFrom }) {
  return (
    <h3 className="mb-1 flex select-none items-center gap-1.5 text-message-foreground/70 text-xs">
      <CornerDownRightIcon aria-hidden className="size-3.5 shrink-0" />
      {aldoRequestLabel(props.from)}
    </h3>
  );
}

/** What Aldo told the agent, a click away. */
export function AldoRequestBrief(props: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        data-scroll-anchor-ignore
        onClick={() => setOpen((value) => !value)}
        className="-ms-0.5 flex items-center gap-1 rounded-sm text-message-foreground/70 text-xs hover:text-message-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        What Aldo told the agent
      </button>
      {open ? (
        <div className="mt-2 border-message-foreground/15 border-s-2 ps-3">{props.children}</div>
      ) : null}
    </div>
  );
}
