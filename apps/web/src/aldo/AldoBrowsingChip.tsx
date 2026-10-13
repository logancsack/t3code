// "On opentable.com" in a thread's header while its agent works in its
// browser (Aldo's read, `browsing`): where the agent is, at a glance. A tap
// opens the Browser panel; while the agent waits on the user there (a
// handoff), the chip says so and opens the takeover.

import { cn } from "~/lib/utils";
import { openAldoHandoffTakeover } from "./AldoHandoffCard";
import { aldoHandoffFor } from "./handoffs.logic";
import { sameTarget } from "./home.logic";
import { useAldoHomeRead } from "./homeFeed";

export function AldoBrowsingChip(props: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly onOpenBrowser: () => void;
}) {
  const { home } = useAldoHomeRead();
  const target = { environmentId: props.environmentId, threadId: props.threadId };
  const handoff = aldoHandoffFor(home, target);
  const browsing = home?.conversations.find((c) => sameTarget(c.thread, target))?.browsing;
  const site = handoff ? handoff.site : (browsing?.site ?? null);
  if (!site) return null;
  return (
    <button
      type="button"
      aria-label={
        handoff
          ? `Your agent waits for you on ${site}: take over its browser`
          : `Your agent is on ${site}: open its browser`
      }
      onClick={() => (handoff ? openAldoHandoffTakeover(handoff.id) : props.onOpenBrowser())}
      className={cn(
        "inline-flex min-w-0 max-w-44 shrink items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
        handoff
          ? "border-warning/40 bg-warning/8 text-foreground hover:bg-warning/15"
          : "border-border bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {/* Still: a browsing session can last hours, and a pulse would repaint all along. */}
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", handoff ? "bg-warning" : "bg-primary")}
      />
      <span className="truncate">On {site}</span>
    </button>
  );
}
