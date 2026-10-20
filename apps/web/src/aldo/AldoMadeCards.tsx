// "What it made", under a finished answer in a thread that isn't code: the
// work itself rather than links to it (results.logic.ts). One main item large
// (a video that plays, or a page with its preview), then a gallery of images
// and clips (hover plays a clip; a tap opens the full-screen viewer), live
// links as cards with their address, and documents as rows that open a reader
// with Copy on each part. Each says who can open it, and Share… says how to
// change that: Aldo can't change a share's audience, so it asks the agent for
// a link anyone can open, and the Library stops one. What the answer already
// shows in place isn't repeated. The turn's full list of changes, the one
// code threads show, stays behind "All changes".

import { resolveMediaSource } from "@t3tools/client-runtime/media-source";
import type { AssetResource, ScopedThreadRef } from "@t3tools/contracts";
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  GlobeIcon,
  ImageIcon,
  LibraryBigIcon,
  LinkIcon,
  LockIcon,
  PlayIcon,
  PresentationIcon,
  UnlinkIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, useMemo, useRef, useState, type ReactNode } from "react";

import { useAssetUrlState, useAssetUrls } from "../assets/assetUrls";
import type {
  ExpandedImageItem,
  ExpandedImagePreview,
} from "../components/chat/ExpandedImagePreview";
import type { MediaActionSource } from "../components/media/MediaActions";
import { MediaVideoPlayer } from "../components/media/MediaVideoPlayer";
import { Button } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { readComposerThreadPrompt, useComposerDraftStore } from "../composerDraftStore";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import { AldoChatVideo } from "./AldoChatVideo";
import { AldoDocumentReader } from "./AldoDocumentReader";
import { aldoShareAudience, aldoShareIdOf } from "./library.logic";
import {
  ALDO_MADE_KIND_LABEL,
  aldoTurnMade,
  type AldoMadeKind,
  type AldoShare,
} from "./made.logic";
import {
  aldoAddress,
  aldoAnswerMedia,
  aldoReadable,
  aldoResults,
  type AldoAudience,
  type AldoLiveShot,
  type AldoResultItem,
  type AldoResultLink,
} from "./results.logic";
import { useAldoShareList } from "./shareList";
import { promptWith } from "./summon.logic";

/** Shown in each section before "N more". */
const SHOWN = { gallery: 8, links: 6, documents: 6 } as const;

const KIND_ICON: Record<AldoMadeKind, { icon: LucideIcon; tint: string }> = {
  sheet: { icon: FileSpreadsheetIcon, tint: "bg-emerald-500/15 text-emerald-500" },
  document: { icon: FileTextIcon, tint: "bg-sky-500/15 text-sky-500" },
  deck: { icon: PresentationIcon, tint: "bg-orange-500/15 text-orange-500" },
  pdf: { icon: FileTextIcon, tint: "bg-rose-500/15 text-rose-500" },
  image: { icon: ImageIcon, tint: "bg-violet-500/15 text-violet-500" },
  page: { icon: GlobeIcon, tint: "bg-cyan-500/15 text-cyan-500" },
  video: { icon: FileVideoIcon, tint: "bg-fuchsia-500/15 text-fuchsia-500" },
  audio: { icon: FileAudioIcon, tint: "bg-amber-500/15 text-amber-500" },
  archive: { icon: FileArchiveIcon, tint: "bg-zinc-500/15 text-zinc-500" },
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

/** A made thing's icon by its kind, or the image itself when it's one in the thread's folder. */
export function AldoMadeThumb(props: {
  readonly kind: AldoMadeKind | null;
  readonly path: string | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
}) {
  const { icon: Icon, tint } = (props.kind && KIND_ICON[props.kind]) || {
    icon: FileIcon,
    tint: "bg-muted text-muted-foreground",
  };
  const iconBox = (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", tint)}>
      <Icon className="size-5" />
    </span>
  );
  return props.kind === "image" && props.path && props.threadRef && props.workspaceRoot ? (
    <ImageThumb
      threadRef={props.threadRef}
      absolutePath={joinPath(props.workspaceRoot, props.path)}
      fallback={iconBox}
    />
  ) : (
    iconBox
  );
}

/** Puts a sentence for the agent in the composer, to send. */
function aldoAskAgent(threadRef: ScopedThreadRef, sentence: string) {
  useComposerDraftStore
    .getState()
    .setPrompt(threadRef, promptWith(readComposerThreadPrompt(threadRef), sentence));
  window.setTimeout(
    () => document.querySelector<HTMLElement>('[data-testid="composer-editor"]')?.focus(),
    50,
  );
}

/** Asks the agent to share a file by link: the sentence goes in the composer, to send. */
export function aldoAskToShare(threadRef: ScopedThreadRef, name: string) {
  aldoAskAgent(threadRef, `Share ${name} with a link.`);
}

// ---------------------------------------------------------------------------
// Who can open it

const AUDIENCE: Record<AldoAudience, { icon: LucideIcon; label: string; detail: string }> = {
  public: { icon: GlobeIcon, ...aldoShareAudience({ public: true }) },
  private: { icon: LockIcon, ...aldoShareAudience({ public: false }) },
  stopped: {
    icon: UnlinkIcon,
    label: "Sharing stopped",
    detail: "Its link was stopped, so no one can open it.",
  },
};

/** Who can open one thing, in a sentence: a file no link was made for stays in the thread. */
function audienceDetail(audience: AldoAudience | null, url: string | null): string {
  if (audience === "private" && !url) return "Only you can open it, in this thread.";
  return audience ? AUDIENCE[audience].detail : "It’s shared by link.";
}

function AudienceChip(props: { readonly audience: AldoAudience; readonly detail: string }) {
  const { icon: Icon, label } = AUDIENCE[props.audience];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-[11px]",
              props.audience === "public"
                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                : "bg-muted text-muted-foreground",
            )}
          />
        }
      >
        <Icon className="size-3" />
        {label}
      </TooltipTrigger>
      <TooltipPopup>{props.detail}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Who can open it, and how to change that: copy or open its link, ask the
 * agent for a link anyone can open, or stop a link in the Library (Aldo can't
 * change who can open a link it made).
 */
function ShareMenu(props: {
  readonly threadRef: ScopedThreadRef | null;
  /** What to ask the agent to share: a path or a title, or "the 8 clips". */
  readonly name: string;
  readonly audience: AldoAudience | null;
  readonly detail: string;
  /** Its link, to copy and open: one thing's, while it works. */
  readonly url: string | null;
  /** Whether a link was made for it (or one of them), so the Library has it. */
  readonly shared: boolean;
  /** Several things, as a gallery's. */
  readonly plural?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const { threadRef, audience, url } = props;
  const askable = threadRef !== null && audience !== "public";
  if (!url && !askable) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground text-xs hover:bg-accent"
          />
        }
      >
        <LinkIcon className="size-3.5 text-muted-foreground" />
        Share…
      </PopoverTrigger>
      <PopoverPopup width="md" align="start">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <PopoverTitle>{props.plural ? "Who can open them" : "Who can open it"}</PopoverTitle>
            <p className="text-muted-foreground text-sm">{props.detail}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {url ? (
              <>
                <Button size="xs" variant="outline" onClick={() => copyToClipboard(url, undefined)}>
                  <LinkIcon />
                  {isCopied ? "Copied" : "Copy link"}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  render={<a href={url} target="_blank" rel="noopener noreferrer" />}
                >
                  <ExternalLinkIcon />
                  Open
                </Button>
              </>
            ) : null}
            {askable ? (
              <Button
                size="xs"
                variant={url ? "ghost" : "outline"}
                onClick={() => {
                  setOpen(false);
                  aldoAskAgent(threadRef, `Share ${props.name} with a link anyone can open.`);
                }}
              >
                <GlobeIcon />
                Share with a link
              </Button>
            ) : null}
          </div>
          {askable ? (
            <p className="text-muted-foreground text-xs">
              The ask goes in the message box, for you to send.
            </p>
          ) : null}
          {threadRef && props.shared ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 self-start text-muted-foreground text-xs hover:text-foreground"
              onClick={() => {
                setOpen(false);
                useRightPanelStore.getState().open(threadRef, "library");
              }}
            >
              <LibraryBigIcon className="size-3.5" />
              Stop sharing in the Library
              <ChevronRightIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** One thing's chip and Share…, on one line. */
function ItemAudience(props: {
  readonly item: AldoResultItem;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { item } = props;
  const detail = audienceDetail(item.audience, item.url);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {item.audience ? <AudienceChip audience={item.audience} detail={detail} /> : null}
      <ShareMenu
        threadRef={props.threadRef}
        name={item.path ?? item.name}
        audience={item.audience}
        detail={detail}
        url={item.url}
        shared={item.url !== null}
      />
    </span>
  );
}

/** A group's: one chip when they're all alike, and Share… for all of them. */
function GroupAudience(props: {
  readonly items: ReadonlyArray<AldoResultItem>;
  readonly threadRef: ScopedThreadRef | null;
  /** "the 8 clips". */
  readonly name: string;
}) {
  const { items } = props;
  if (items.length === 1) return <ItemAudience item={items[0]!} threadRef={props.threadRef} />;
  const first = items[0]?.audience ?? null;
  const alike = first !== null && items.every((item) => item.audience === first);
  const linked = items.some((item) => item.url !== null);
  const detail = alike
    ? first === "private" && !linked
      ? "Only you can open them, in this thread."
      : first === "public"
        ? "Anyone with their links can open them."
        : first === "private"
          ? "Only you can open them, signed in to Aldo."
          : "Their links were stopped, so no one can open them."
    : items.some((item) => item.audience === "public")
      ? items.every((item) => item.audience === "public" || item.audience === "private")
        ? "Anyone with the link can open the ones marked with a globe. Only you can open the rest."
        : "Anyone with the link can open the ones marked with a globe."
      : "Some of them are shared by link.";
  return (
    <span className="flex shrink-0 items-center gap-1">
      {alike ? <AudienceChip audience={first} detail={detail} /> : null}
      <ShareMenu
        threadRef={props.threadRef}
        name={props.name}
        audience={alike ? first : null}
        detail={detail}
        url={null}
        shared={linked}
        plural
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Where its bytes come from

function mediaResource(
  threadRef: ScopedThreadRef,
  absolutePath: string,
): Extract<AssetResource, { _tag: "media-file" }> {
  return { _tag: "media-file", threadId: threadRef.threadId, path: absolutePath };
}

/** An image the answer named (a screenshot): on the thread's machine, or on the web. */
function useAnswerImage(
  threadRef: ScopedThreadRef | null,
  workspaceRoot: string | undefined,
  image: string | null,
): string | null {
  const media = useMemo(
    () =>
      image
        ? resolveMediaSource(image, {
            threadId: threadRef?.threadId,
            workspaceRoot,
            imageEmbed: true,
          })
        : null,
    [image, threadRef?.threadId, workspaceRoot],
  );
  const resource = media?.access === "environment" ? media.resource : null;
  const asset = useAssetUrlState(threadRef?.environmentId ?? null, resource);
  if (media?.access === "direct") return media.uri;
  return resource && asset._tag === "Success" ? asset.url : null;
}

function openItem(threadRef: ScopedThreadRef | null, item: AldoResultItem) {
  if (item.path && threadRef) {
    useRightPanelStore.getState().openFile(threadRef, item.path);
  } else if (item.url) {
    window.open(item.url, "_blank", "noopener,noreferrer");
  }
}

function SectionHeading(props: {
  readonly title: string;
  readonly detail?: string | null;
  readonly children?: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <h4 className="font-semibold text-foreground text-xs">{props.title}</h4>
      {props.detail ? (
        <span className="min-w-0 truncate text-muted-foreground text-xs">{props.detail}</span>
      ) : null}
      {props.children}
    </div>
  );
}

function MoreButton(props: { readonly hidden: number; readonly onClick: () => void }) {
  return props.hidden > 0 ? (
    <button
      type="button"
      className="mt-1.5 text-muted-foreground text-xs hover:text-foreground"
      onClick={props.onClick}
    >
      {props.hidden} more
    </button>
  ) : null;
}

// ---------------------------------------------------------------------------
// The main item

function ItemCaption(props: {
  readonly item: AldoResultItem;
  readonly threadRef: ScopedThreadRef | null;
  readonly detail: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 truncate font-medium text-sm">{props.item.name}</span>
      {props.detail ? (
        <span className="min-w-0 truncate text-muted-foreground text-xs">{props.detail}</span>
      ) : null}
      <ItemAudience item={props.item} threadRef={props.threadRef} />
    </div>
  );
}

function MainVideo(props: {
  readonly item: AldoResultItem;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
}) {
  const { item, threadRef } = props;
  const caption = (
    <ItemCaption
      item={item}
      threadRef={threadRef}
      detail={item.name !== item.fileName ? item.fileName : null}
    />
  );
  if (threadRef && item.absolutePath) {
    return (
      <AldoChatVideo
        threadRef={threadRef}
        path={item.absolutePath}
        name={item.name}
        workspaceRoot={props.workspaceRoot}
        fragment=""
        className="my-0"
      >
        {caption}
      </AldoChatVideo>
    );
  }
  // Shared only: from its link, which keeps its own sign-in.
  return (
    <figure className="flex flex-col items-start gap-1.5">
      <MediaVideoPlayer
        src={item.url}
        label={item.name}
        preload="metadata"
        className="block w-full max-w-[40rem]"
        videoClassName="block aspect-video w-full rounded-lg border border-border/40"
        actionsSource={{ kind: "video", name: item.name, src: item.url }}
      />
      <figcaption className="max-w-full">{caption}</figcaption>
    </figure>
  );
}

/**
 * A page shown large: the screenshot the answer linked to it, or the page
 * itself from the thread's machine, small and still (it opens beside the
 * thread, or at its link, to use).
 */
function MainPage(props: {
  readonly item: AldoResultItem;
  readonly image: string | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
}) {
  const { item, threadRef } = props;
  const screenshot = useAnswerImage(threadRef, props.workspaceRoot, props.image);
  const resource = useMemo(
    () =>
      !props.image && threadRef && item.absolutePath
        ? ({
            // As the file panel shows a page: from the folder, or from where it was shared.
            _tag: item.path !== null ? "workspace-file" : "media-file",
            threadId: threadRef.threadId,
            path: item.absolutePath,
          } satisfies AssetResource)
        : null,
    [props.image, threadRef, item.absolutePath, item.path],
  );
  const page = useAssetUrlState(threadRef?.environmentId ?? null, resource);
  const pageUrl = page._tag === "Success" ? page.url : null;
  const canOpen = (item.path !== null && threadRef !== null) || item.url !== null;
  return (
    <figure className="flex w-full max-w-[40rem] flex-col gap-1.5">
      <button
        type="button"
        className="relative block aspect-[16/10] w-full overflow-hidden rounded-lg border border-border/60 bg-muted/40 text-left disabled:cursor-default"
        disabled={!canOpen}
        onClick={() => openItem(threadRef, item)}
        aria-label={`Open ${item.name}`}
      >
        {screenshot ? (
          <img
            src={screenshot}
            alt=""
            className="size-full object-cover object-top"
            decoding="async"
          />
        ) : pageUrl ? (
          // Laid out at twice the size and shown at half: the page as a desktop shows it.
          <iframe
            src={pageUrl}
            title={item.name}
            loading="lazy"
            tabIndex={-1}
            aria-hidden
            sandbox="allow-scripts"
            className="pointer-events-none absolute top-0 left-0 h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-white"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <GlobeIcon className="size-6" />
          </span>
        )}
      </button>
      <figcaption>
        <ItemCaption
          item={item}
          threadRef={threadRef}
          detail={item.url ? aldoAddress(item.url) : item.fileName}
        />
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// The gallery

function formatDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * One image or clip. A clip shows its first frame and plays muted while a
 * mouse is over it; a tap opens it in the viewer.
 */
function GalleryTile(props: {
  readonly item: AldoResultItem;
  readonly src: string | null;
  /** A badge for one anyone can open, when the gallery's are mixed. */
  readonly markPublic: boolean;
  readonly onOpen: () => void;
}) {
  const { item, src } = props;
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const clip = item.kind === "video";
  // A share's link counts an opening each time it's fetched: a clip only there waits for the viewer.
  const shown = src !== null && !failed && (!clip || item.absolutePath !== null);
  return (
    <button
      type="button"
      className="relative block aspect-video w-full overflow-hidden rounded-lg border border-border/40 bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open ${item.name}`}
      onClick={props.onOpen}
      onPointerEnter={(event) => {
        if (clip && event.pointerType === "mouse") void video.current?.play().catch(() => {});
      }}
      onPointerLeave={() => {
        const element = video.current;
        if (!element) return;
        element.pause();
        element.currentTime = 0.1;
      }}
    >
      {shown ? (
        clip ? (
          <video
            ref={video}
            // From 0.1 seconds in, so its first frame stands in for a poster.
            src={`${src}#t=0.1`}
            muted
            loop
            playsInline
            preload="metadata"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none size-full object-cover"
            onLoadedMetadata={(event) => setDuration(formatDuration(event.currentTarget.duration))}
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            src={src}
            alt=""
            decoding="async"
            loading="lazy"
            className="size-full object-cover"
            onError={() => setFailed(true)}
          />
        )
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          {clip ? <FileVideoIcon className="size-5" /> : <ImageIcon className="size-5" />}
        </span>
      )}
      {clip ? (
        <span className="pointer-events-none absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 font-medium text-[11px] text-white tabular-nums">
          <PlayIcon className="size-2.5 fill-current" />
          {duration}
        </span>
      ) : null}
      {props.markPublic ? (
        <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-full bg-black/60 p-1 text-white">
          <GlobeIcon className="size-3" aria-hidden />
          <span className="sr-only">{AUDIENCE.public.label}</span>
        </span>
      ) : null}
    </button>
  );
}

const SMALL = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "3 images · 8 clips" as meta, or "three images and eight clips" in a sentence. */
function galleryWords(items: ReadonlyArray<AldoResultItem>, sentence: boolean): string {
  const clips = items.filter((item) => item.kind === "video").length;
  const images = items.length - clips;
  const count = (n: number, one: string, many: string) =>
    `${sentence && n < 10 ? SMALL[n] : n} ${n === 1 ? one : many}`;
  return [
    images ? count(images, "image", "images") : null,
    clips ? count(clips, "clip", "clips") : null,
  ]
    .filter(Boolean)
    .join(sentence ? " and " : " · ");
}

function Gallery(props: {
  readonly items: ReadonlyArray<AldoResultItem>;
  readonly sources: ReadonlyArray<string | null>;
  readonly threadRef: ScopedThreadRef | null;
  readonly onExpand: ((preview: ExpandedImagePreview) => void) | undefined;
  readonly onShowAll?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const { items, sources, threadRef } = props;
  const shown = showAll ? items : items.slice(0, SHOWN.gallery);
  const first = items[0]?.audience ?? null;
  const mixed = items.some((item) => item.audience !== first);
  const words = galleryWords(items, false);
  const open = (index: number) => {
    if (!props.onExpand) {
      const item = items[index];
      if (item) openItem(threadRef, item);
      return;
    }
    const images = items.map((item, at): ExpandedImageItem => {
      const src = sources[at] ?? null;
      const path = item.path;
      const actionsSource: MediaActionSource = {
        kind: item.kind === "video" ? "video" : "image",
        name: item.name,
        src,
        ...(threadRef && item.absolutePath
          ? {
              asset: {
                environmentId: threadRef.environmentId,
                resource: mediaResource(threadRef, item.absolutePath),
              },
            }
          : {}),
        ...(path && threadRef
          ? { onOpenFile: () => useRightPanelStore.getState().openFile(threadRef, path) }
          : {}),
      };
      return item.kind === "video"
        ? { src, name: item.name, type: "video", autoPlay: true, actionsSource }
        : { src, name: item.name, actionsSource };
    });
    props.onExpand({ images, index });
  };
  return (
    <section aria-label={words}>
      <SectionHeading
        title={items.every((item) => item.kind === "video") ? "Clips" : "Gallery"}
        detail={words}
      >
        <GroupAudience
          items={items}
          threadRef={threadRef}
          name={`the ${galleryWords(items, true)}`}
        />
      </SectionHeading>
      <div className="@container">
        <ul className="grid grid-cols-2 gap-1.5 @md:grid-cols-3 @xl:grid-cols-4">
          {shown.map((item, index) => (
            <li key={item.key} className="min-w-0">
              <GalleryTile
                item={item}
                src={sources[index] ?? null}
                markPublic={mixed && item.audience === "public"}
                onOpen={() => open(index)}
              />
            </li>
          ))}
        </ul>
      </div>
      <MoreButton
        hidden={items.length - shown.length}
        onClick={() => {
          setShowAll(true);
          props.onShowAll?.();
        }}
      />
    </section>
  );
}

/**
 * The gallery's files through the thread's machine, the tiles in view signed
 * in one request (the rest once "more" shows them; the viewer signs one it
 * opens that isn't yet).
 */
function GalleryFromThread(props: {
  readonly items: ReadonlyArray<AldoResultItem>;
  readonly threadRef: ScopedThreadRef;
  readonly onExpand: ((preview: ExpandedImagePreview) => void) | undefined;
}) {
  const { items, threadRef } = props;
  const [showAll, setShowAll] = useState(false);
  const inView = showAll ? items.length : SHOWN.gallery;
  const resources = useMemo(
    () =>
      items
        .slice(0, inView)
        .flatMap((item) =>
          item.absolutePath ? [mediaResource(threadRef, item.absolutePath)] : [],
        ),
    [items, inView, threadRef],
  );
  const signed = useAssetUrls(threadRef.environmentId, resources);
  const sources = useMemo(() => {
    let next = 0;
    return items.map((item, index) =>
      item.absolutePath ? (index < inView ? (signed[next++] ?? null) : null) : item.url,
    );
  }, [items, inView, signed]);
  return (
    <Gallery
      items={items}
      sources={sources}
      threadRef={threadRef}
      onExpand={props.onExpand}
      onShowAll={() => setShowAll(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Live links

function LinkImage(props: {
  readonly link: AldoResultLink;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
}) {
  const src = useAnswerImage(props.threadRef, props.workspaceRoot, props.link.image);
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img
      src={src}
      alt=""
      decoding="async"
      loading="lazy"
      className="size-full object-cover object-top"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="flex size-full items-center justify-center text-muted-foreground">
      <GlobeIcon className="size-5" />
    </span>
  );
}

function LinkCard(props: {
  readonly link: AldoResultLink;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
}) {
  const { link, threadRef } = props;
  const item = link.item;
  const body = (
    <>
      <span className="relative block aspect-video w-28 shrink-0 overflow-hidden bg-muted/60 @md:w-full">
        <LinkImage link={link} threadRef={threadRef} workspaceRoot={props.workspaceRoot} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 p-2">
        <span className="line-clamp-2 text-sm leading-snug">{link.title}</span>
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
          {link.url ? (
            <ExternalLinkIcon className="size-3 shrink-0" />
          ) : (
            <FileIcon className="size-3 shrink-0" />
          )}
          <span className="truncate">{link.address}</span>
        </span>
      </span>
    </>
  );
  const cardClass =
    "flex w-full min-w-0 overflow-hidden text-left hover:bg-accent/40 disabled:cursor-default @md:flex-col";
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-card/30">
      {link.url ? (
        <a href={link.url} target="_blank" rel="noopener noreferrer" className={cardClass}>
          {body}
        </a>
      ) : (
        <button
          type="button"
          className={cardClass}
          onClick={() => item && openItem(threadRef, item)}
          disabled={!item?.path || !threadRef}
        >
          {body}
        </button>
      )}
      {item ? (
        <span className="flex items-center border-border/40 border-t px-1.5 py-1">
          <ItemAudience item={item} threadRef={threadRef} />
        </span>
      ) : null}
    </li>
  );
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function Links(props: {
  readonly links: ReadonlyArray<AldoResultLink>;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? props.links : props.links.slice(0, SHOWN.links);
  const hosts = new Set(props.links.map((link) => hostOf(link.url)));
  const [host] = hosts;
  return (
    <section aria-label="Live links">
      <SectionHeading title="Live links" detail={hosts.size === 1 && host ? `on ${host}` : null} />
      <div className="@container">
        <ul className="grid grid-cols-1 gap-2 @md:grid-cols-2 @xl:grid-cols-3">
          {shown.map((link) => (
            <LinkCard
              key={link.key}
              link={link}
              threadRef={props.threadRef}
              workspaceRoot={props.workspaceRoot}
            />
          ))}
        </ul>
      </div>
      <MoreButton hidden={props.links.length - shown.length} onClick={() => setShowAll(true)} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Documents

const DOCUMENT_KINDS = new Set<AldoMadeKind>(["document", "sheet", "deck", "pdf"]);

function DocumentRow(props: {
  readonly item: AldoResultItem;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
  readonly onRead: (item: AldoResultItem) => void;
}) {
  const { item, threadRef } = props;
  const readable = aldoReadable(item) && threadRef !== null && props.workspaceRoot !== undefined;
  const canOpen = readable || (item.path !== null && threadRef !== null) || item.url !== null;
  const detail = item.name !== item.fileName ? item.fileName : ALDO_MADE_KIND_LABEL[item.kind];
  return (
    <li className="flex min-w-0 items-center gap-2 border-border/50 border-b px-2 py-1.5 last:border-b-0">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left disabled:cursor-default"
        disabled={!canOpen}
        onClick={() => (readable ? props.onRead(item) : openItem(threadRef, item))}
        aria-label={canOpen ? `Open ${item.name}` : undefined}
      >
        <AldoMadeThumb
          kind={item.kind}
          path={item.path}
          threadRef={threadRef}
          workspaceRoot={props.workspaceRoot}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{item.name}</span>
          <span className="block truncate text-muted-foreground text-xs">{detail}</span>
        </span>
        {canOpen ? (
          <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
        ) : null}
      </button>
      <ItemAudience item={item} threadRef={threadRef} />
    </li>
  );
}

function Documents(props: {
  readonly items: ReadonlyArray<AldoResultItem>;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const [reading, setReading] = useState<AldoResultItem | null>(null);
  const shown = showAll ? props.items : props.items.slice(0, SHOWN.documents);
  const title = props.items.every((item) => DOCUMENT_KINDS.has(item.kind)) ? "Documents" : "Files";
  return (
    <section aria-label={title}>
      <SectionHeading title={title} />
      <ul className="overflow-hidden rounded-lg border border-border/60 bg-card/30">
        {shown.map((item) => (
          <DocumentRow
            key={item.key}
            item={item}
            threadRef={props.threadRef}
            workspaceRoot={props.workspaceRoot}
            onRead={setReading}
          />
        ))}
      </ul>
      <MoreButton hidden={props.items.length - shown.length} onClick={() => setShowAll(true)} />
      {reading && props.threadRef && props.workspaceRoot ? (
        <AldoDocumentReader
          item={reading}
          threadRef={props.threadRef}
          workspaceRoot={props.workspaceRoot}
          audience={<ItemAudience item={reading} threadRef={props.threadRef} />}
          onClose={() => setReading(null)}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The block

const NO_SHOTS: ReadonlyArray<AldoLiveShot> = [];

export const AldoMadeCards = memo(function AldoMadeCards(props: {
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
  readonly shares: ReadonlyArray<AldoShare>;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
  /** The answer as the agent wrote it, so what it shows in place isn't shown twice. */
  readonly answer?: string | undefined;
  /** Screenshots the answer linked to live pages, taken out of its text (results.logic.ts). */
  readonly shots?: ReadonlyArray<AldoLiveShot> | undefined;
  readonly onImageExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
  /** The turn's full list of changes, behind "All changes". */
  readonly allChanges: ReactNode;
}) {
  const { threadRef, workspaceRoot } = props;
  const shots = props.shots ?? NO_SHOTS;
  const made = useMemo(
    () => aldoTurnMade({ files: props.files, shares: props.shares, workspaceRoot }),
    [props.files, props.shares, workspaceRoot],
  );
  const shareIds = useMemo(
    () =>
      made.items.flatMap((item) => {
        const id = item.url ? aldoShareIdOf(item.url) : null;
        return id ? [id] : [];
      }),
    [made.items],
  );
  const listed = useAldoShareList(shareIds);
  const shown = useMemo(
    () => aldoAnswerMedia(props.answer ?? "", workspaceRoot),
    [props.answer, workspaceRoot],
  );
  const results = useMemo(
    () => aldoResults({ items: made.items, workspaceRoot, shown, shots, listed }),
    [made.items, workspaceRoot, shown, shots, listed],
  );
  const [showChanges, setShowChanges] = useState(false);
  const { main, gallery, links, documents } = results;
  if (made.items.length === 0 && shots.length === 0) return props.allChanges;
  // With nothing made to show, its changes show as they did before; otherwise behind "All changes".
  const changes =
    made.items.length === 0 ? (
      props.allChanges
    ) : made.others > 0 && props.allChanges ? (
      <div className="text-muted-foreground text-xs">
        <button
          type="button"
          className="hover:text-foreground"
          aria-expanded={showChanges}
          onClick={() => setShowChanges((value) => !value)}
        >
          {showChanges ? "Hide changes" : "All changes"}
        </button>
        {showChanges ? props.allChanges : null}
      </div>
    ) : null;
  // All of it is in the answer already.
  if (!main && gallery.length === 0 && links.length === 0 && documents.length === 0) {
    return changes ? <div className="mt-3">{changes}</div> : null;
  }
  return (
    <section className="mt-3 flex max-w-[48rem] flex-col gap-4" aria-label="What it made">
      {main?.kind === "video" ? (
        <MainVideo item={main} threadRef={threadRef} workspaceRoot={workspaceRoot} />
      ) : main ? (
        <MainPage
          item={main}
          image={results.mainImage}
          threadRef={threadRef}
          workspaceRoot={workspaceRoot}
        />
      ) : null}
      {gallery.length > 0 ? (
        threadRef ? (
          <GalleryFromThread items={gallery} threadRef={threadRef} onExpand={props.onImageExpand} />
        ) : (
          <Gallery
            items={gallery}
            sources={gallery.map((item) => item.url)}
            threadRef={null}
            onExpand={props.onImageExpand}
          />
        )
      ) : null}
      {links.length > 0 ? (
        <Links links={links} threadRef={threadRef} workspaceRoot={workspaceRoot} />
      ) : null}
      {documents.length > 0 ? (
        <Documents items={documents} threadRef={threadRef} workspaceRoot={workspaceRoot} />
      ) : null}
      {changes ? <div className="-mt-2">{changes}</div> : null}
    </section>
  );
});
