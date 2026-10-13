// "What it made", under a finished answer in a thread that isn't code: a card
// for each thing the turn made or shared (made.logic.ts), opening in the file
// panel, with its link to copy once shared or a Share that asks the agent to
// share it (in the composer, to send). The turn's full list of changes, the
// one code threads show, stays behind "All changes".

import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  CheckIcon,
  FileAudioIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  PresentationIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";

import { useAssetUrlState } from "../assets/assetUrls";
import { readComposerThreadPrompt, useComposerDraftStore } from "../composerDraftStore";
import { cn } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import {
  ALDO_MADE_KIND_LABEL,
  aldoTurnMade,
  type AldoMadeItem,
  type AldoMadeKind,
  type AldoShare,
} from "./made.logic";
import { promptWith } from "./summon.logic";

/** Cards shown before "and N more". */
const SHOWN = 6;

const KIND_ICON: Record<AldoMadeKind, { icon: LucideIcon; tint: string }> = {
  sheet: { icon: FileSpreadsheetIcon, tint: "bg-emerald-500/15 text-emerald-500" },
  document: { icon: FileTextIcon, tint: "bg-sky-500/15 text-sky-500" },
  deck: { icon: PresentationIcon, tint: "bg-orange-500/15 text-orange-500" },
  pdf: { icon: FileTextIcon, tint: "bg-rose-500/15 text-rose-500" },
  image: { icon: ImageIcon, tint: "bg-violet-500/15 text-violet-500" },
  page: { icon: GlobeIcon, tint: "bg-cyan-500/15 text-cyan-500" },
  video: { icon: FileVideoIcon, tint: "bg-fuchsia-500/15 text-fuchsia-500" },
  audio: { icon: FileAudioIcon, tint: "bg-amber-500/15 text-amber-500" },
};

function joinPath(root: string, path: string): string {
  return `${root.replace(/\/+$/, "")}/${path}`;
}

function ImageThumb(props: {
  readonly threadRef: ScopedThreadRef;
  readonly absolutePath: string;
  readonly fallback: ReactNode;
}) {
  const resource = useMemo(
    () => ({
      _tag: "workspace-file" as const,
      threadId: props.threadRef.threadId,
      path: props.absolutePath,
    }),
    [props.threadRef.threadId, props.absolutePath],
  );
  const asset = useAssetUrlState(props.threadRef.environmentId, resource);
  const [failed, setFailed] = useState(false);
  if (asset._tag !== "Success" || failed) return props.fallback;
  return (
    <img
      src={asset.url}
      alt=""
      className="size-10 shrink-0 rounded-md object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function shareInComposer(threadRef: ScopedThreadRef, name: string) {
  useComposerDraftStore
    .getState()
    .setPrompt(
      threadRef,
      promptWith(readComposerThreadPrompt(threadRef), `Share ${name} with a link.`),
    );
  window.setTimeout(
    () => document.querySelector<HTMLElement>('[data-testid="composer-editor"]')?.focus(),
    50,
  );
}

function MadeCard(props: {
  readonly item: AldoMadeItem;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
}) {
  const { item, threadRef, workspaceRoot } = props;
  const [copied, setCopied] = useState(false);
  const { icon: Icon, tint } = KIND_ICON[item.kind] ?? { icon: FileIcon, tint: "" };
  const iconBox = (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", tint)}>
      <Icon className="size-5" />
    </span>
  );
  const canOpen = item.path !== null && threadRef !== null;
  const open = () => {
    if (item.path && threadRef) useRightPanelStore.getState().openFile(threadRef, item.path);
  };
  const action = "rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-accent";
  return (
    <li className="flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-border/60 bg-card/30 p-2 sm:w-[calc(50%-0.25rem)]">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
        disabled={!canOpen}
        onClick={open}
        aria-label={canOpen ? `Open ${item.name}` : undefined}
      >
        {item.kind === "image" && item.path && threadRef && workspaceRoot ? (
          <ImageThumb
            threadRef={threadRef}
            absolutePath={joinPath(workspaceRoot, item.path)}
            fallback={iconBox}
          />
        ) : (
          iconBox
        )}
        <span className="min-w-0">
          <span className="block truncate font-medium text-sm">{item.sharedAs ?? item.name}</span>
          <span className="block truncate text-muted-foreground text-xs">
            {item.sharedAs && item.sharedAs !== item.name
              ? item.name
              : ALDO_MADE_KIND_LABEL[item.kind]}
            {item.sharedAs ? " · Shared" : ""}
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5 text-xs">
        {item.url ? (
          <button
            type="button"
            className={cn(action, "inline-flex items-center gap-1")}
            onClick={() => {
              void navigator.clipboard?.writeText(item.url!).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <CheckIcon className="size-3.5" /> : <LinkIcon className="size-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        ) : !item.sharedAs && threadRef ? (
          <button
            type="button"
            className={action}
            onClick={() => shareInComposer(threadRef, item.name)}
            aria-label={`Ask the agent to share ${item.name} by link`}
          >
            Share
          </button>
        ) : null}
      </span>
    </li>
  );
}

export const AldoMadeCards = memo(function AldoMadeCards(props: {
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
  readonly shares: ReadonlyArray<AldoShare>;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
  /** The turn's full list of changes, behind "All changes". */
  readonly allChanges: ReactNode;
}) {
  const { items, others } = useMemo(
    () =>
      aldoTurnMade({
        files: props.files,
        shares: props.shares,
        workspaceRoot: props.workspaceRoot,
      }),
    [props.files, props.shares, props.workspaceRoot],
  );
  const [showAll, setShowAll] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  if (items.length === 0) {
    return props.allChanges;
  }
  const shown = showAll ? items : items.slice(0, SHOWN);
  const hidden = items.length - shown.length;
  return (
    <section className="mt-3">
      <h3 className="mb-1.5 font-medium text-muted-foreground text-xs">What it made</h3>
      <ul className="flex flex-wrap gap-2">
        {shown.map((item) => (
          <MadeCard
            key={item.path ?? item.url ?? item.name}
            item={item}
            threadRef={props.threadRef}
            workspaceRoot={props.workspaceRoot}
          />
        ))}
      </ul>
      <div className="mt-1.5 flex gap-3 text-muted-foreground text-xs">
        {hidden > 0 ? (
          <button type="button" className="hover:text-foreground" onClick={() => setShowAll(true)}>
            {hidden} more
          </button>
        ) : null}
        {others > 0 && props.allChanges ? (
          <button
            type="button"
            className="hover:text-foreground"
            aria-expanded={showChanges}
            onClick={() => setShowChanges((value) => !value)}
          >
            {showChanges ? "Hide changes" : "All changes"}
          </button>
        ) : null}
      </div>
      {showChanges ? props.allChanges : null}
    </section>
  );
});
