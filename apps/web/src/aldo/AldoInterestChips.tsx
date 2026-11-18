// The kinds of work Aldo asks about (onboarding.logic.ts), as chips to pick
// any number of: in the welcome (AldoWelcome.tsx) and in Settings → General.

import {
  BriefcaseIcon,
  CodeIcon,
  PaletteIcon,
  PresentationIcon,
  SearchIcon,
  SheetIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { ALDO_INTERESTS, type AldoInterest } from "./onboarding.logic";
import { FOCUS } from "./surface";

const ICONS: Record<AldoInterest, LucideIcon> = {
  business: BriefcaseIcon,
  finance: SheetIcon,
  documents: PresentationIcon,
  media: PaletteIcon,
  research: SearchIcon,
  code: CodeIcon,
};

/** The kinds of work to pick from, any number of them. */
export function AldoInterestChips(props: {
  readonly value: ReadonlyArray<AldoInterest>;
  readonly onChange: (next: ReadonlyArray<AldoInterest>) => void;
  readonly className?: string;
  /** What names the group: an element's id, or words. */
  readonly labelledBy?: string;
  readonly label?: string;
}) {
  return (
    <div
      role="group"
      aria-labelledby={props.labelledBy}
      aria-label={props.label}
      className={cn("flex flex-wrap gap-2", props.className)}
    >
      {ALDO_INTERESTS.map(({ id, label }) => {
        const Icon = ICONS[id];
        const on = props.value.includes(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors duration-150 pointer-coarse:h-11",
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-foreground/[0.10] bg-card text-foreground hover:border-foreground/[0.2] dark:border-white/[0.12] dark:bg-white/[0.035]",
              FOCUS,
            )}
            onClick={() =>
              props.onChange(
                // In the welcome's order, whatever order they're tapped in.
                ALDO_INTERESTS.map((interest) => interest.id).filter((interest) =>
                  interest === id ? !on : props.value.includes(interest),
                ),
              )
            }
          >
            <Icon
              aria-hidden
              className={cn("size-4", on ? "text-primary" : "text-muted-foreground")}
              strokeWidth={1.75}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
