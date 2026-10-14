// General's mark, wherever a project's tile would be: an empty dashed tile.
// It's no project, so it has no letters or colour of its own.

import { cn } from "~/lib/utils";

export function AldoGeneralTile(props: { readonly className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      data-aldo-general-tile=""
      className={cn(
        "inline-block size-4 shrink-0 rounded-[25%] border border-muted-foreground/70 border-dashed",
        props.className,
      )}
    />
  );
}
