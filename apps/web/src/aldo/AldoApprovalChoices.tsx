import { LoaderCircleIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "~/lib/utils";
import type { ApprovalChoice } from "./approvals.logic";
import { FOCUS } from "./surface";

// An approval's answers, stacked: each a full-width row with what happens
// under its label, the one to do first filled. A thumb reaches every row; a
// screen reader names each by its label and describes it by what it does.
const ROW = `flex min-h-11 w-full min-w-0 flex-col items-start gap-0.5 rounded-xl px-4 py-2.5 text-left transition-[background-color,transform,opacity] duration-150 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 ${FOCUS}`;

export function ApprovalChoices(props: {
  readonly choices: ReadonlyArray<ApprovalChoice>;
  /** The choice being sent, by its place in `choices`. */
  readonly busy: number | null;
  readonly disabled: boolean;
  readonly onChoose: (choice: ApprovalChoice, index: number) => void;
}) {
  const id = useId();
  return (
    <div role="group" aria-label="Your answer" className="flex flex-col gap-2">
      {props.choices.map((choice, index) => (
        <button
          key={choice.label}
          type="button"
          data-aldo-choice={choice.spendLimit !== undefined ? "always" : choice.decision}
          disabled={props.disabled || props.busy !== null}
          aria-busy={props.busy === index || undefined}
          aria-labelledby={`${id}-${index}-label`}
          aria-describedby={`${id}-${index}-detail`}
          className={cn(
            ROW,
            choice.primary
              ? "bg-foreground text-background hover:bg-foreground/88"
              : "border border-foreground/[0.1] text-foreground hover:bg-foreground/[0.04] dark:border-white/[0.12] dark:hover:bg-white/[0.05]",
          )}
          onClick={() => props.onChoose(choice, index)}
        >
          <span className="flex w-full min-w-0 items-center justify-between gap-2 font-semibold text-[15px] leading-5">
            <span
              id={`${id}-${index}-label`}
              data-aldo-choice-label=""
              className="min-w-0 break-words"
            >
              {choice.label}
            </span>
            {props.busy === index ? (
              <LoaderCircleIcon aria-hidden className="size-4 shrink-0 animate-spin" />
            ) : null}
          </span>
          <span
            id={`${id}-${index}-detail`}
            className={cn(
              "min-w-0 break-words text-[13px] leading-[18px]",
              choice.primary ? "text-background/75" : "text-muted-foreground",
            )}
          >
            {choice.detail}
          </span>
        </button>
      ))}
    </div>
  );
}
