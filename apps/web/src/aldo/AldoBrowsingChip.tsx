// A direct takeover request stays visible independently of local previews.

import { openAldoHandoffTakeover } from "./AldoHandoffCard";
import { aldoHandoffFor } from "./handoffs.logic";
import { useAldoHomeRead } from "./homeFeed";

export function AldoBrowsingChip(props: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly onOpenBrowser: () => void;
}) {
  const { home } = useAldoHomeRead();
  const target = { environmentId: props.environmentId, threadId: props.threadId };
  const handoff = aldoHandoffFor(home, target);
  // Ordinary browser activity lives in Thread tools. Keep a visible, direct
  // takeover request even when there is no local app to preview.
  if (!handoff) return null;
  const site = handoff.site;
  return (
    <button
      type="button"
      aria-label={`Your agent waits for you on ${site}: take over its browser`}
      onClick={(event) => openAldoHandoffTakeover(handoff.id, event.currentTarget)}
      className="relative inline-flex h-9 min-w-0 max-w-56 shrink items-center gap-1.5 rounded-full border border-warning/40 bg-warning/8 px-3 text-[13px] font-medium text-foreground outline-none after:absolute after:-inset-y-1.5 hover:bg-warning/15 focus-visible:ring-2 focus-visible:ring-ring md:h-8"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
      <span className="truncate">
        Take over<span className="max-md:hidden"> · {site}</span>
      </span>
    </button>
  );
}
