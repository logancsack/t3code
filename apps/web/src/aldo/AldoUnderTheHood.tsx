// What runs under Aldo's conversation, on a page of its own in the home
// screen's place, opened from what Aldo's at (AldoPresence.tsx): what's
// important is in the conversation; this is what's set up and kept. The pull
// requests Aldo follows (merged here too), what's due to be sent (sent now or
// cancelled), the routines (run, paused, removed or set up), what Aldo did,
// the plan's room and credits, and how Aldo works for the user, with its
// "Always allow" rules. The board's own sections, from the same home read.
// Back (or Escape) returns to the conversation.

import { ArrowLeftIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Skeleton } from "../components/ui/skeleton";
import { SidebarInset } from "../components/ui/sidebar";
import {
  CapacitySection,
  LogSection,
  PolicySection,
  ShipLaneSection,
  UpcomingSection,
} from "./AldoHomeBoard";
import { RoutinesSection } from "./AldoRoutines";
import { type AldoHome } from "./homeApi";
import { refreshAldoHome } from "./homeFeed";
import { setAldoUnderTheHood } from "./simpleMode";
import { ICON_BUTTON } from "./surface";

export function AldoUnderTheHood(props: {
  readonly home: AldoHome | null;
  readonly error: string | null;
  readonly repos: ReadonlyArray<string>;
  readonly now: number;
  readonly lastSeen: string | null;
  /** Simple mode's places, on a phone: at the foot. */
  readonly tabs: ReactNode;
}) {
  const { home, now } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Not while something over the page (a routine being set up, a confirmation) has it.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      setAldoUnderTheHood(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const acted = () => void refreshAldoHome();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-14 pb-8 sm:px-5 sm:pt-6">
          <header className="-ms-1.5 flex items-center gap-1.5">
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label="Back to Aldo"
              onClick={() => setAldoUnderTheHood(false)}
            >
              <ArrowLeftIcon className="size-4" strokeWidth={1.75} />
            </button>
            <h1 className="font-semibold text-lg">Under the hood</h1>
          </header>
          {home ? (
            <>
              <ShipLaneSection
                pullRequests={home.pullRequests}
                repos={props.repos}
                now={now}
                lastSeen={props.lastSeen}
                onActed={acted}
              />
              <UpcomingSection deliveries={home.upcoming} now={now} onActed={acted} />
              {/* An older Aldo has no routines to show. */}
              {home.routines ? (
                <RoutinesSection routines={home.routines} now={now} onChanged={acted} />
              ) : null}
              <LogSection actions={home.actions} now={now} />
              <CapacitySection usage={home.usage} spends={home.spends} />
              <PolicySection policy={home.policy} />
            </>
          ) : props.error ? (
            <p className="text-destructive-foreground text-sm">{props.error}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          )}
        </div>
      </div>
      {props.tabs ? (
        <div className="shrink-0 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {props.tabs}
        </div>
      ) : null}
    </SidebarInset>
  );
}
