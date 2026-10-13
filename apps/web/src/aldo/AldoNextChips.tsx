// The follow-ups an agent offered at the end of its answer (next.logic.ts), as
// chips under it; a tap sends one as the user's next message. Shown only under
// the thread's latest answer, while nothing is running.

import { CornerDownRightIcon } from "lucide-react";
import { useState } from "react";

export function AldoNextChips(props: {
  readonly next: ReadonlyArray<string>;
  /** Sends it; false when it couldn't go (the thread was busy), so the chips stay. */
  readonly onSend: (text: string) => Promise<boolean>;
}) {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {props.next.map((text) => (
        <button
          key={text}
          type="button"
          disabled={sent !== null}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-card/30 px-3 py-1 text-left text-xs transition-colors hover:border-border hover:bg-accent disabled:opacity-60"
          onClick={() => {
            setSent(text);
            void props.onSend(text).then((ok) => {
              if (!ok) setSent(null);
            });
          }}
        >
          <CornerDownRightIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{text}</span>
        </button>
      ))}
    </div>
  );
}
