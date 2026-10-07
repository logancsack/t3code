// Talking to Aldo: the orb to talk, the composer to type (with a few things to
// say when it's empty), and the conversation: what was said, and what Aldo
// did, the newest action about each thread as a live card (AldoLiveCard.tsx).
// The home screen lays them out as a page (AldoHome.tsx) or, beside the
// board, as a pane (AldoPane); the summon bar shows the end of the same
// conversation (AldoSummon.tsx). The conversation itself lives in
// assistantSession.ts, so it carries on when Aldo opens a thread (the dock
// shows it there). AldoAtAGlance is what needs the user and what's working,
// read the way Aldo reads it (its overview): the board for an Aldo without
// the home screen's read.

import { Link } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ImageIcon,
  ImagePlusIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "~/lib/utils";
import { isHeicImageFile, prepareImageForAttachment } from "~/lib/imageCompression";
import {
  classifyComposerAttachmentFile,
  normalizeComposerImageFileMimeType,
} from "../components/chat/composerAttachmentFiles";
import { useIsMobile, useMediaQuery } from "../hooks/useMediaQuery";
import { useThreadShells } from "../state/entities";
import { AldoBriefEntry } from "./AldoBrief";
import { showAldoCall } from "./callView";
import { AldoThreadCard } from "./AldoLiveCard";
import {
  ACTION_LABELS,
  liveCardIndexes,
  withoutImageNotes,
  type AldoAssistantPhase,
  type AldoOpenTarget,
} from "./assistant.logic";
import {
  connectAldo,
  disconnectAldo,
  loadAldoConversation,
  sendText,
  setAldoMuted,
  useAldoAssistant,
  type AldoConversationEntry,
} from "./assistantSession";
import {
  aldoAssistant,
  aldoAssistantInfo,
  type AldoImageLimits,
  type AldoImageUpload,
} from "./cloud";

const OVERVIEW_EVERY_MS = 20_000;

const PHASE_LABEL: Record<AldoAssistantPhase, string> = {
  idle: "Tap to talk",
  connecting: "Connecting…",
  listening: "Listening",
  hearing: "Listening",
  thinking: "Thinking…",
  speaking: "Aldo",
  error: "Tap to talk again",
};

/**
 * Aldo's side of the home screen: the conversation, then the orb, caption and
 * composer. `chips` are things to say when the composer is empty. On a phone
 * the conversation is folded under a line of what Aldo last said, and opens
 * when the user says something.
 */
export function AldoPane(props: {
  readonly chips: ReadonlyArray<string>;
  readonly onChip: (chip: string) => void;
  readonly className?: string;
}) {
  useEffect(() => {
    void loadAldoConversation();
  }, []);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [open, setOpen] = useState(false);
  const count = useAldoAssistant((s) => s.entries.length);
  const replying = useAldoAssistant((s) => s.replying);
  const lastSaid = useAldoAssistant((s) => {
    const last = s.entries.findLast((e) => e.kind === "message" && e.role === "assistant");
    return last?.kind === "message" ? last.text : "";
  });
  const loaded = useAldoAssistant((s) => s.historyLoaded);
  // What's said after the conversation has loaded opens it; the history itself doesn't.
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (seen.current !== null && count > seen.current) setOpen(true);
    seen.current = count;
  }, [count, loaded]);
  useEffect(() => {
    if (replying) setOpen(true);
  }, [replying]);
  return (
    <aside className={cn("flex min-h-0 flex-col bg-background", props.className)} aria-label="Aldo">
      {wide ? null : (
        <button
          type="button"
          aria-expanded={open}
          className="flex shrink-0 items-center gap-2 border-border/60 border-b px-4 py-2 text-left text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {lastSaid || "Your conversation with Aldo"}
          </span>
          {open ? (
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronUpIcon className="size-3.5 text-muted-foreground" />
          )}
        </button>
      )}
      {wide || open ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-4 pt-4 pb-3">
            <AldoConversation />
          </div>
        </div>
      ) : null}
      <div
        className="shrink-0 border-t border-border/60 bg-background/95 backdrop-blur"
        data-aldo-assistant-footer=""
      >
        <div className="flex w-full flex-col items-center gap-2.5 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <AldoCaption />
          <AldoTalkControls />
          <AldoComposer chips={props.chips} onChip={props.onChip} />
        </div>
      </div>
    </aside>
  );
}

/** The orb: tap to talk or hang up; it swells with whoever is speaking. */
let assistantInfo: ReturnType<typeof aldoAssistantInfo> | null = null;

/** Whether this Aldo has the assistant, asked once per page; null until it's known. */
export function useAldoAssistantAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    assistantInfo ??= aldoAssistantInfo();
    void assistantInfo.then((info) => {
      if (current) setAvailable(info.available);
    });
    return () => {
      current = false;
    };
  }, []);
  return available;
}

/** The images this Aldo's written messages take, asked once per page; null when none (or not known yet). */
function useAldoImageLimits(): AldoImageLimits | null {
  const [limits, setLimits] = useState<AldoImageLimits | null>(null);
  useEffect(() => {
    let current = true;
    assistantInfo ??= aldoAssistantInfo();
    void assistantInfo.then((info) => {
      if (current) setLimits(info.images);
    });
    return () => {
      current = false;
    };
  }, []);
  return limits;
}

/** A request to Aldo is at most 4.5 MB: the images of one message share about 3 MB, before base64. */
const IMAGES_BYTES = 3_000_000;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Couldn't read the image.")),
    );
    reader.readAsDataURL(file);
  });
}

/** An image the user gave, made small enough to send: null (with why) if it can't be. */
async function imageUpload(
  given: File,
  limits: AldoImageLimits,
): Promise<{ image: AldoImageUpload } | { error: string }> {
  // A file dragged from another app may have no type: its name says it, as in the thread's composer.
  const file = normalizeComposerImageFileMimeType(given);
  const heic = isHeicImageFile(file);
  if (!heic && !limits.types.includes(file.type)) {
    return { error: `${file.name || "That file"} isn't a PNG, JPEG, WebP or GIF image.` };
  }
  const budget = Math.min(limits.maxBytes, Math.floor(IMAGES_BYTES / limits.max));
  const prepared = await prepareImageForAttachment(file, budget);
  if (!prepared.ok) return { error: `${file.name || "That image"} is too large to send.` };
  return {
    image: {
      name: prepared.file.name || file.name || "image",
      dataUrl: await readAsDataUrl(prepared.file),
    },
  };
}

/** How to talk to Aldo from anywhere (AldoAssistantDock listens for it). */
export const ALDO_SHORTCUT_LABEL =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘⇧A"
    : "Ctrl+Shift+A";

export function AldoOrb(props: {
  readonly size?: "xl" | "lg" | "sm" | "xs";
  readonly className?: string;
  /** Just the orb, swelling with who speaks: not a button (the call screen's, AldoCallScreen.tsx). */
  readonly display?: boolean;
}) {
  const phase = useAldoAssistant((s) => s.phase);
  const levels = useAldoAssistant((s) => s.levels);
  const live = phase !== "idle" && phase !== "error";
  const level =
    phase === "speaking"
      ? levels.aldo
      : phase === "hearing" || phase === "listening"
        ? levels.mic
        : 0;
  const scale = 1 + Math.min(1, level * 2.5) * (props.display ? 0.14 : 0.28);
  const size = props.size ?? "lg";
  const visuals = (
    <>
      {size === "xl" ? (
        <span
          aria-hidden
          className="absolute -inset-8 rounded-full bg-primary/10 transition-transform duration-150 motion-reduce:transition-none"
          style={{ transform: `scale(${1 + Math.min(1, level * 2.5) * 0.25})` }}
        />
      ) : null}
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full bg-gradient-to-br from-primary/90 to-primary/50 shadow-lg shadow-primary/20 transition-transform duration-100 motion-reduce:transition-none",
          (phase === "thinking" || phase === "connecting") && "animate-pulse",
          !live && !props.display && "opacity-80",
        )}
        style={{ transform: `scale(${scale})` }}
      />
      <span
        aria-hidden
        className={cn(
          "absolute rounded-full bg-background/25",
          size === "xl"
            ? "inset-[30%]"
            : size === "lg"
              ? "inset-5"
              : size === "sm"
                ? "inset-2"
                : "inset-1.5",
        )}
      />
      {live || props.display ? null : (
        <MicIcon
          className={cn(
            "relative text-primary-foreground",
            size === "lg" || size === "xl" ? "size-7" : size === "sm" ? "size-4" : "size-3",
          )}
        />
      )}
    </>
  );
  const box = cn(
    "relative flex shrink-0 items-center justify-center rounded-full",
    size === "xl" ? "size-40" : size === "lg" ? "size-20" : size === "sm" ? "size-9" : "size-6",
    props.className,
  );
  if (props.display) {
    return (
      <span aria-hidden className={box}>
        {visuals}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={live ? "End the conversation with Aldo" : "Talk to Aldo"}
            onClick={() => (live ? disconnectAldo() : void connectAldo())}
            className={cn(box, "outline-none focus-visible:ring-2 focus-visible:ring-ring")}
          />
        }
      >
        {visuals}
      </TooltipTrigger>
      <TooltipPopup side={size === "xs" ? "right" : "top"}>
        {live ? "Hang up" : `Talk to Aldo (${ALDO_SHORTCUT_LABEL})`}
      </TooltipPopup>
    </Tooltip>
  );
}

export function AldoTalkControls() {
  const phase = useAldoAssistant((s) => s.phase);
  const micOn = useAldoAssistant((s) => s.micOn);
  const muted = useAldoAssistant((s) => s.muted);
  const replying = useAldoAssistant((s) => s.replying);
  const live = phase !== "idle" && phase !== "error";
  return (
    <div className="flex items-center gap-4">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={muted ? "Unmute" : "Mute"}
        className={cn(!live || !micOn ? "invisible" : undefined)}
        onClick={() => setAldoMuted(!muted)}
      >
        {muted ? <MicOffIcon /> : <MicIcon />}
      </Button>
      <div className="flex flex-col items-center gap-1">
        <AldoOrb size="sm" />
        <span className="text-muted-foreground text-[11px]">
          {muted && live ? "Muted" : !live && replying ? "Thinking…" : PHASE_LABEL[phase]}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Hang up"
        className={cn(!live ? "invisible" : undefined)}
        onClick={disconnectAldo}
      >
        <PhoneOffIcon />
      </Button>
    </div>
  );
}

/** What Aldo is saying now; or what went wrong. */
export function AldoCaption() {
  const said = useAldoAssistant((s) => s.said);
  const error = useAldoAssistant((s) => s.error);
  const phase = useAldoAssistant((s) => s.phase);
  if (error)
    return <p className="max-w-lg text-center text-destructive-foreground text-sm">{error}</p>;
  // While Aldo speaks; after, its words are in the conversation above.
  if (!said || phase !== "speaking") return null;
  return <p className="line-clamp-3 max-w-lg text-center text-foreground/90 text-sm">{said}</p>;
}

/**
 * Typing to Aldo. In the pane it's a field under the orb; as the page's
 * composer (`page`) it's one large field with the orb in it, and mute and hang
 * up while a call is on.
 */
export function AldoComposer(props: {
  readonly chips: ReadonlyArray<string>;
  readonly onChip: (chip: string) => void;
  readonly variant?: "pane" | "page";
}) {
  const page = props.variant === "page";
  // On a phone the page's composer is a field and, beside it, a big button to talk (or back to the call).
  const phone = useIsMobile() && page;
  const muted = useAldoAssistant((s) => s.muted);
  const micOn = useAldoAssistant((s) => s.micOn);
  const [text, setText] = useState("");
  const [images, setImages] = useState<ReadonlyArray<AldoImageUpload>>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  /** Images being made ready to send: the message waits for them. */
  const [preparing, setPreparing] = useState(0);
  const phase = useAldoAssistant((s) => s.phase);
  const unsent = useAldoAssistant((s) => s.unsent);
  const unsentImages = useAldoAssistant((s) => s.unsentImages);
  const replying = useAldoAssistant((s) => s.replying);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const limits = useAldoImageLimits();
  const live = phase !== "idle" && phase !== "error";
  // Images go in writing: not into a call.
  const canAttach = limits !== null && !live;
  // Images that couldn't be sent come back before any added since, as their words do.
  useEffect(() => {
    if (unsentImages === null) return;
    setImages((current) => {
      const merged = [
        ...unsentImages,
        ...current.filter((image) => !unsentImages.some((u) => u.dataUrl === image.dataUrl)),
      ];
      return limits ? merged.slice(0, limits.max) : merged;
    });
    useAldoAssistant.setState({ unsentImages: null });
  }, [unsentImages, limits]);
  // A batch is made ready together, and the message waits for it.
  const addImages = (files: ReadonlyArray<File>) => {
    if (!limits || files.length === 0) return;
    setImageError(null);
    const room = limits.max - images.length;
    if (room <= 0 || files.length > room)
      setImageError(`At most ${limits.max} images with a message.`);
    const batch = files.slice(0, Math.max(0, room));
    if (batch.length === 0) return;
    setPreparing((n) => n + 1);
    void Promise.all(batch.map((file) => imageUpload(file, limits)))
      .then((made) => {
        const failed = made.find((m): m is { error: string } => "error" in m);
        if (failed) setImageError(failed.error);
        const ready = made.flatMap((m) => ("image" in m ? [m.image] : []));
        setImages((current) => [...current, ...ready].slice(0, limits.max));
      })
      .finally(() => setPreparing((n) => n - 1));
  };
  // What couldn't be sent comes back to be sent again, and words seeded for
  // the user to finish; a draft already in the field is kept, after them.
  useEffect(() => {
    if (unsent === null) return;
    setText((current) => {
      if (!current.trim()) return unsent;
      if (!unsent.trim()) return current;
      return `${unsent} ${current}`;
    });
    useAldoAssistant.setState({ unsent: null });
    input.current?.focus();
  }, [unsent]);
  const submit = () => {
    if (preparing > 0) return;
    // During a call images don't go: they stay for after it.
    const sending = canAttach ? images : [];
    if (!text.trim() && sending.length === 0) return;
    sendText(text, sending);
    setText("");
    if (sending.length > 0) setImages([]);
    setImageError(null);
  };
  return (
    <div className="flex w-full flex-col gap-2">
      {!text && !replying && props.chips.length > 0 ? (
        <div className={cn("flex flex-wrap gap-1.5", page ? "justify-start" : "justify-center")}>
          {props.chips.map((chip) => (
            <button
              key={chip}
              type="button"
              className="rounded-full border border-border/70 bg-card/40 px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => props.onChip(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}
      {canAttach && images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <div key={image.dataUrl} className="relative">
              <img
                src={image.dataUrl}
                alt={image.name}
                className="size-14 rounded-md border border-border/70 object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${image.name}`}
                className="absolute -top-1.5 -right-1.5 rounded-full border border-border bg-background p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {canAttach && imageError ? (
        <p className="text-destructive-foreground text-xs">{imageError}</p>
      ) : null}
      <div className="flex w-full items-center gap-2.5">
        <form
          className={cn(
            "flex w-full min-w-0 items-center gap-2",
            page &&
              "rounded-2xl border border-border/80 bg-card py-2 ps-2 pe-2 shadow-sm/5 has-focus-visible:border-primary/50",
            phone && "rounded-full py-1.5 ps-3",
          )}
          data-aldo-composer={props.variant ?? "pane"}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onDragOver={(event) => {
            if (canAttach && event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => {
            if (!canAttach || event.dataTransfer.files.length === 0) return;
            event.preventDefault();
            addImages([...event.dataTransfer.files]);
          }}
        >
          {page && !phone ? <AldoOrb size="sm" /> : null}
          {canAttach ? (
            <>
              <input
                ref={picker}
                type="file"
                accept={[...limits.types, ".heic", ".heif"].join(",")}
                multiple
                hidden
                onChange={(event) => {
                  addImages([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Add images"
                disabled={images.length >= limits.max}
                onClick={() => picker.current?.click()}
              >
                <ImagePlusIcon />
              </Button>
            </>
          ) : null}
          <Input
            ref={input}
            className={cn("flex-1", page && "text-base")}
            size={page ? "lg" : "default"}
            unstyled={page}
            autoComplete="off"
            value={text}
            placeholder={
              replying
                ? "Aldo is thinking…"
                : live
                  ? "Or type to Aldo…"
                  : phone
                    ? "Talk or type to Aldo"
                    : "Ask Aldo, or tell it what to do"
            }
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              if (!canAttach) return;
              const files = [...event.clipboardData.files].filter(
                (file) => classifyComposerAttachmentFile(file) !== "file",
              );
              if (files.length === 0) return;
              event.preventDefault();
              addImages(files);
            }}
          />
          {page && live && micOn ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => setAldoMuted(!muted)}
            >
              {muted ? <MicOffIcon /> : <MicIcon />}
            </Button>
          ) : null}
          {page && live ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Hang up"
              onClick={disconnectAldo}
            >
              <PhoneOffIcon />
            </Button>
          ) : null}
          {phone && !text.trim() && !(canAttach && images.length > 0) ? null : (
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              className={cn(phone && "rounded-full")}
              disabled={preparing > 0 || (!text.trim() && !(canAttach && images.length > 0))}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </form>
        {phone ? <TalkButton /> : null}
      </div>
    </div>
  );
}

/** The phone's big button beside the composer: talk to Aldo, or, on a call, back to it. */
function TalkButton() {
  const phase = useAldoAssistant((s) => s.phase);
  const live = phase !== "idle" && phase !== "error";
  return (
    <button
      type="button"
      aria-label={live ? "Back to the call" : "Talk to Aldo"}
      className="relative flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/25 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      onClick={() => (live ? showAldoCall() : void connectAldo())}
    >
      {live ? (
        <span aria-hidden className="size-5 animate-pulse rounded-full bg-primary-foreground/80" />
      ) : (
        <MicIcon className="size-6" />
      )}
    </button>
  );
}

function threadLink(target: AldoOpenTarget, children: ReactNode, className?: string) {
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{
        environmentId: target.environmentId as EnvironmentId,
        threadId: target.threadId as ThreadId,
      }}
      className={className}
    >
      {children}
    </Link>
  );
}

/**
 * The conversation: from the start, or `since` an entry (the summon bar shows
 * what followed its question), the newest action about each thread as a live
 * card.
 */
export function AldoConversation(props: { readonly since?: number } = {}) {
  const all = useAldoAssistant((s) => s.entries);
  const loaded = useAldoAssistant((s) => s.historyLoaded);
  const replying = useAldoAssistant((s) => s.replying);
  const since = props.since ?? 0;
  const live = useMemo(() => liveCardIndexes(all), [all]);
  const entries = since > 0 ? all.slice(since) : all;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length, replying]);
  if (loaded && entries.length === 0 && since === 0) {
    return (
      <div className="py-8 text-center">
        <h2 className="font-semibold text-lg">What should we get done?</h2>
        <p className="mx-auto mt-2 max-w-xs text-muted-foreground text-sm">
          Tell Aldo what you want, typed or out loud. It starts threads, briefs their agents,
          follows them, and tells you how it went.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry, index) => (
        <ConversationEntry
          key={entry.kind === "action" ? entry.id : `${entry.at}-${since + index}`}
          entry={entry}
          live={live.has(since + index)}
        />
      ))}
      {replying ? (
        <p className="self-start text-muted-foreground text-sm" aria-live="polite">
          Thinking…
        </p>
      ) : null}
      <div ref={end} />
    </div>
  );
}

function ConversationEntry({
  entry,
  live,
}: {
  readonly entry: AldoConversationEntry;
  readonly live: boolean;
}) {
  if (entry.kind === "action") {
    const label = (
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          entry.failed && "text-destructive-foreground",
        )}
      >
        {entry.label}
        {entry.open ? <ArrowUpRightIcon className="size-3.5" /> : null}
      </span>
    );
    const line = (
      <div className="self-start rounded-full border border-border/60 bg-card/40 px-3 py-1 text-muted-foreground text-xs">
        {entry.href ? (
          <a href={entry.href} target="_blank" rel="noreferrer" className="hover:text-foreground">
            <span className="inline-flex items-center gap-1.5">
              {entry.label}
              <ArrowUpRightIcon className="size-3.5" />
            </span>
          </a>
        ) : entry.open && entry.open.threadId ? (
          threadLink(entry.open, label, "hover:text-foreground")
        ) : (
          label
        )}
      </div>
    );
    return live && entry.open ? (
      <AldoThreadCard
        target={entry.open}
        label={ACTION_LABELS[entry.tool] ?? entry.label}
        fallback={line}
      />
    ) : (
      line
    );
  }
  if (entry.role === "user") return <UserMessage entry={entry} />;
  if (entry.source === "brief") return <AldoBriefEntry text={entry.text} at={entry.at} />;
  return (
    <p className="max-w-[85%] self-start whitespace-pre-wrap text-sm leading-relaxed">
      {entry.text}
    </p>
  );
}

/** What the user said, with the images they sent: shown, or named when the message was kept (from before this page). */
function UserMessage({
  entry,
}: {
  readonly entry: Extract<AldoConversationEntry, { kind: "message" }>;
}) {
  const { text, images: named } = withoutImageNotes(entry.text);
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
      {entry.images && entry.images.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {entry.images.map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              className="size-20 rounded-lg border border-border/60 object-cover"
            />
          ))}
        </div>
      ) : null}
      {!entry.images?.length && named.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {named.map(({ id, name }) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground text-xs"
            >
              <ImageIcon className="size-3" />
              {name}
            </span>
          ))}
        </div>
      ) : null}
      {text ? (
        <p className="whitespace-pre-wrap rounded-2xl bg-muted/60 px-3.5 py-2 text-sm">{text}</p>
      ) : null}
    </div>
  );
}

type OverviewEntry = { ref: string; title: string; state: string; summary?: string };

/** The ref's thread on this page: its machine's environment, and the T3 thread its id prefix names. */
function useRefTarget(): (ref: string) => AldoOpenTarget | null {
  const shells = useThreadShells();
  return useMemo(
    () => (ref: string) => {
      const [machine, prefix = ""] = ref.split(":");
      const environmentId = `aldo-${machine}`;
      const match = shells
        .filter(
          (s) => s.environmentId === environmentId && s.id.startsWith(prefix) && !s.archivedAt,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      return match ? { environmentId, threadId: match.id } : null;
    },
    [shells],
  );
}

/** What needs the user, and what's working, as Aldo sees it: the board for an Aldo without the home screen's read. */
export function AldoAtAGlance() {
  const [overview, setOverview] = useState<{
    needsYou: OverviewEntry[];
    working: OverviewEntry[];
  } | null>(null);
  const target = useRefTarget();
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const outcome = await aldoAssistant
        .runTool("overview", { limit: 20 }, null, [])
        .catch(() => null);
      const result = outcome?.result as
        | { needsYou?: OverviewEntry[]; conversations?: OverviewEntry[] }
        | undefined;
      if (stopped || !result) return;
      setOverview({
        needsYou: result.needsYou ?? [],
        working: (result.conversations ?? []).filter(
          (c) => c.state === "working" || c.state === "starting" || c.state === "queued",
        ),
      });
    };
    void load();
    const timer = setInterval(() => void load(), OVERVIEW_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  if (!overview || (overview.needsYou.length === 0 && overview.working.length === 0)) return null;
  const row = (entry: OverviewEntry, tone: "needs" | "working") => {
    const open = target(entry.ref);
    const body = (
      <>
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            tone === "needs" ? "bg-warning" : "animate-pulse bg-primary",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">{entry.title}</span>
          {entry.summary ? (
            <span className="line-clamp-2 text-muted-foreground text-xs">{entry.summary}</span>
          ) : null}
        </span>
      </>
    );
    const className = "flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-accent/50";
    return (
      <li key={entry.ref}>
        {open ? threadLink(open, body, className) : <div className={className}>{body}</div>}
      </li>
    );
  };
  return (
    <section className="rounded-xl border border-border/60 bg-card/30 p-2">
      {overview.needsYou.length > 0 ? (
        <>
          <h2 className="px-2.5 pt-1 pb-0.5 font-medium text-muted-foreground text-xs">
            Needs you
          </h2>
          <ul>{overview.needsYou.map((e) => row(e, "needs"))}</ul>
        </>
      ) : null}
      {overview.working.length > 0 ? (
        <>
          <h2 className="px-2.5 pt-1 pb-0.5 font-medium text-muted-foreground text-xs">Working</h2>
          <ul>{overview.working.map((e) => row(e, "working"))}</ul>
        </>
      ) : null}
    </section>
  );
}
