// A share one of Aldo's replies links to, as a card under the reply: its
// kind, title and when it last changed, a tap opening it in Aldo's viewer
// (one the viewer can't show opens at its link). Only the user's own shares,
// as Aldo lists them. No preview, so Home stays light and a look isn't
// counted as someone opening it.

import { ChevronRightIcon, FileIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { ALDO_KIND_ICON } from "./kindIcon";
import {
  aldoShareKind,
  aldoShareUpdated,
  aldoShareViewable,
  type AldoShareView,
} from "./library.logic";
import { ALDO_MADE_KIND_LABEL } from "./made.logic";
import { openAldoShare } from "./shareViewer";

/** Opens a share in Aldo's viewer when it shows its kind; says whether it did. */
export function openAldoShareInAldo(share: AldoShareView): boolean {
  if (!aldoShareViewable(share.contentType)) return false;
  openAldoShare({
    id: share.id,
    url: share.url,
    title: share.title,
    contentType: share.contentType,
    share,
  });
  return true;
}

export function AldoShareCard(props: { readonly share: AldoShareView }) {
  const { share } = props;
  const kind = aldoShareKind(share.contentType);
  const { icon: Icon, tint } = (kind && ALDO_KIND_ICON[kind]) || {
    icon: FileIcon,
    tint: "bg-muted text-muted-foreground",
  };
  const detail = [kind ? ALDO_MADE_KIND_LABEL[kind] : "File", aldoShareUpdated(share, new Date())]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      className="flex w-72 max-w-full items-center gap-3 rounded-2xl border border-foreground/[0.07] bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/60 dark:border-white/[0.08] dark:bg-white/[0.045]"
      onClick={() => {
        if (!openAldoShareInAldo(share)) window.open(share.url, "_blank", "noopener,noreferrer");
      }}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tint)}>
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-[15px] leading-5">{share.title}</span>
        <span className="block truncate text-[13px] text-muted-foreground leading-5">{detail}</span>
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
