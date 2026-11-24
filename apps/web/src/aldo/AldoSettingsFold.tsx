import { ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useSettingsSearchTargetId } from "../components/settings/settingsLayout";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";

/**
 * Settings folded away behind a heading that names what's there, which a
 * search for one of them (`opensFor`) unfolds.
 */
export function AldoSettingsFold(props: {
  readonly title: string;
  readonly hint: string;
  readonly opensFor: (targetId: string) => boolean;
  readonly children: ReactNode;
}) {
  const { opensFor } = props;
  const [open, setOpen] = useState(false);
  const targetId = useSettingsSearchTargetId();
  // Unfold once per search jump, so the user can fold it again while the target is still set.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (targetId === null) {
      openedFor.current = null;
      return;
    }
    if (!opensFor(targetId) || openedFor.current === targetId) return;
    openedFor.current = targetId;
    setOpen(true);
  }, [opensFor, targetId]);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-start gap-2 rounded-lg px-3 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4">
        <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-90" />
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-foreground text-sm">{props.title}</span>
          <span className="text-muted-foreground text-xs">{props.hint}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-8 pt-3">{props.children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
