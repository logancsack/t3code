// A thread's step waiting for approval, in plain words on Home: why the agent
// asks, whether it can change anything, and (on the buttons) which answer Aldo
// recommends. What the agent literally sent (a command, a tool's name and its
// input) is behind "Details", never the headline.

import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Quoted } from "./AldoQuoted";
import { SAFETY_LABEL } from "./approvalWords";
import type { AldoApprovalExplain } from "./homeApi";
import { FOCUS } from "./surface";

export function ApprovalWords(props: {
  readonly explain: AldoApprovalExplain;
  /** What the agent sent, exactly: a command, or a tool's name with its input. */
  readonly detail: string | undefined;
  readonly kind: string | undefined;
}) {
  const { explain: e, detail } = props;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 text-[14px] leading-5">
      <p className="text-muted-foreground dark:text-foreground/70">{e.why}</p>
      <p>
        <span className={cn("font-medium", e.safety.level === "risky" && "text-destructive")}>
          {SAFETY_LABEL[e.safety.level]}.
        </span>{" "}
        {e.safety.text}
      </p>
      {detail ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            aria-expanded={open}
            className={cn(
              FOCUS,
              "-mx-1 inline-flex min-h-8 w-fit items-center gap-1 rounded-full px-1 text-[13px] text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setOpen((on) => !on)}
          >
            Details
            <ChevronDownIcon
              aria-hidden
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
              strokeWidth={1.75}
            />
          </button>
          {open ? (
            <div className="flex flex-col gap-1.5 rounded-xl bg-foreground/[0.04] p-3">
              {props.kind ? (
                <p className="text-[12px] text-muted-foreground">Request type: {props.kind}</p>
              ) : null}
              <Quoted
                lines={6}
                className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5"
              >
                {detail}
              </Quoted>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
