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
      className="inline-flex min-h-8 min-w-0 max-w-44 shrink items-center gap-1.5 rounded-full border border-warning/40 bg-warning/8 px-2 text-xs text-foreground outline-none hover:bg-warning/15 focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-12 max-sm:max-w-28"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
      <span className="truncate">
        <span className="max-sm:hidden">Take over · </span>
        {site}
      </span>
    </button>
  );
}
