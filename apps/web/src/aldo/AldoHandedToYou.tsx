// Threads handed to the user as a colleague left their organization
// (offboarding.logic.ts): at the top of the Library while there are any, each
// opening a page of its own (/library/handed/$handoverId) to read its
// conversations, download its files, and carry it on in a thread of the
// user's. Someone in no organization has none, so their Library is as it was.

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, FolderInputIcon, LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { aldoOffboarding } from "./accountApi";
import { aldoReceivedLine, type AldoReceived } from "./offboarding.logic";

/** How often a copy still being made is looked at again. */
export const ALDO_COPYING_EVERY_MS = 10_000;

/**
 * The copies handed to the user: null until read, and from an Aldo without
 * them, or after a read that failed (the Library shows nothing of them then).
 * Read again as the window comes back, and while one is being made.
 */
function useReceived(): ReadonlyArray<AldoReceived> | null {
  const [received, setReceived] = useState<ReadonlyArray<AldoReceived> | null>(null);
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const request = ++latest.current;
    aldoOffboarding.received().then(
      (next) => request === latest.current && setReceived(next),
      () => undefined,
    );
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const copying = Boolean(received?.some((r) => r.state === "copying"));
  useEffect(() => {
    if (!copying) return;
    const timer = window.setInterval(refresh, ALDO_COPYING_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [copying, refresh]);
  return received;
}

/** The Library's "Handed to you", while there's something in it. */
export function AldoHandedToYou() {
  const received = useReceived();
  if (!received?.length) return null;
  return (
    <section aria-labelledby="aldo-handed-to-you" className="flex flex-col px-3 pb-2 sm:px-4">
      <h2 id="aldo-handed-to-you" className="mb-1.5 px-1 font-medium text-muted-foreground text-xs">
        Handed to you
      </h2>
      <ul className="flex flex-col gap-2">
        {received.map((r) => (
          <ReceivedRow key={r.id} received={r} />
        ))}
      </ul>
    </section>
  );
}

function ReceivedRow({ received }: { received: AldoReceived }) {
  const ready = received.state === "copied";
  const body = (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/60 text-muted-foreground"
      >
        {ready ? (
          <FolderInputIcon className="size-4.5" />
        ) : (
          <LoaderCircleIcon className="size-4 animate-spin" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 font-medium text-foreground text-sm [overflow-wrap:anywhere]">
            {received.title.trim() || "Untitled"}
          </span>
          {ready && !received.seen ? (
            <Badge variant="info" size="sm">
              New
            </Badge>
          ) : received.continued ? (
            <Badge variant="outline" size="sm" className="font-normal text-muted-foreground">
              Carried on
            </Badge>
          ) : null}
        </span>
        <span className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
          {aldoReceivedLine(received)}
        </span>
      </span>
      {ready ? (
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
      ) : null}
    </>
  );
  const row = "flex min-w-0 items-center gap-2.5 rounded-xl border border-border/60 bg-card/30 p-2";
  return (
    <li>
      {ready ? (
        <Link
          to="/library/handed/$handoverId"
          params={{ handoverId: received.id }}
          className={cn(
            row,
            "outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring active:bg-accent/60",
          )}
        >
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}
