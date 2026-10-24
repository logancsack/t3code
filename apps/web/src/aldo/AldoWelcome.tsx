// The welcome on a new account's first visit to Home (onboarding.logic.ts):
// who Aldo is in a line, and one optional question, what they'll hand it
// first, whose answer picks Home's starters, simple mode and whether the
// developer tools show. Continue or Skip ends it for good; it never comes
// back once Aldo has kept the answer. Its chips (AldoInterestChips.tsx) change
// the answer in Settings → General too.

import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { useAldoProfile } from "./AldoAccountMenu";
import { AldoInterestChips } from "./AldoInterestChips";
import { AldoFrame } from "./AldoFrame";
import { saveAldoOnboarding } from "./onboarding";
import { aldoFirstName, type AldoInterest } from "./onboarding.logic";
import { FOCUS, PRIMARY } from "./surface";

/** The welcome, over the whole page until it's answered or skipped. */
export function AldoWelcome() {
  const profile = useAldoProfile();
  const first = aldoFirstName(profile?.name ?? null);
  const [picked, setPicked] = useState<ReadonlyArray<AldoInterest>>([]);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
  }, []);
  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="aldo-welcome-title"
      aria-describedby="aldo-welcome-lead"
      tabIndex={-1}
      className="fixed inset-0 z-50 overflow-y-auto bg-background outline-none"
    >
      <div className="flex min-h-full items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[560px] flex-col items-center text-center">
          <AldoFrame size={56} aware />
          <h1
            id="aldo-welcome-title"
            className="mt-6 mb-2 font-semibold text-[28px] text-foreground leading-tight tracking-[-0.025em] sm:text-[30px]"
          >
            {first ? `Welcome to Aldo, ${first}.` : "Welcome to Aldo."}
          </h1>
          <p
            id="aldo-welcome-lead"
            className="mb-8 max-w-[470px] text-[15px] text-muted-foreground leading-6"
          >
            Hand it real work: research, decks, spreadsheets, videos, sites. It works on a computer
            of its own and keeps you posted.
          </p>
          <p id="aldo-welcome-question" className="mb-3 font-medium text-foreground text-sm">
            What will you hand it first? Pick any.
          </p>
          <AldoInterestChips
            labelledBy="aldo-welcome-question"
            className="justify-center"
            value={picked}
            onChange={setPicked}
          />
          <div className="mt-8 flex flex-col items-center gap-2">
            <button
              type="button"
              className={cn(PRIMARY, "min-w-[220px]")}
              onClick={() => void saveAldoOnboarding(picked)}
            >
              Continue
            </button>
            <button
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground",
                FOCUS,
              )}
              onClick={() => void saveAldoOnboarding([])}
            >
              Skip
            </button>
          </div>
          <p className="mt-4 text-muted-foreground/75 text-xs leading-5">
            Picking Code and apps adds the developer tools. You can change this in Settings →
            General.
          </p>
        </div>
      </div>
    </div>
  );
}
