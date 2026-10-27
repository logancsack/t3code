// Talking to Aldo: the mark to talk, the composer to type (with a few things to
// say when it's empty), and the conversation: what was said, and what Aldo
// did, the newest action about each thread as a live card (AldoLiveCard.tsx).
// The home screen lays them out as a page (AldoConversationPage.tsx); the
// summon bar shows the end of the same conversation (AldoSummon.tsx). The
// conversation itself lives in assistantSession.ts, so it carries on when
// Aldo opens a thread (the dock shows it there). AldoAtAGlance is what needs the user and what's working,
// read the way Aldo reads it (its overview): the board for an Aldo without
// the home screen's read.

import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  AudioLinesIcon,
  ChevronRightIcon,
  ImageIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
import { OpenThread, threadLink, WorkstreamGlyph } from "./AldoWorkstream";
import { AldoFeedRun } from "./AldoFeed";
import { showAldoCall } from "./callView";
import { AldoThreadCard } from "./AldoLiveCard";
import { AldoFrame } from "./AldoFrame";
import { ALDO_TALK_LABEL } from "./summon.logic";
import {
  ACTION_LABELS,
  closingThread,
  linkRuns,
  liveCardIndexes,
  onCall,
  withoutImageNotes,
  type AldoOpenTarget,
} from "./assistant.logic";
import {
  connectAldo,
  disconnectAldo,
  sendText,
  retryAldoMessage,
  setAldoMuted,
  useAldoAssistant,
  type AldoConversationEntry,
} from "./assistantSession";
import {
  aldoAssistant,
  aldoAssistantInfo,
  type AldoFileLimits,
  type AldoFileUpload,
  type AldoImageLimits,
  type AldoImageUpload,
} from "./assistantApi";
import { AldoAttachMenu, AldoFileChip } from "./AldoAttach";
import { aldoAttachmentId } from "./held.logic";
import { uploadAldoHomeFile } from "./threadApi";
import { randomUUID } from "~/lib/utils";
import { useAldoArrive, useAldoArrived } from "./arrive";
import { beatDelay, splitBeats } from "./beats.logic";
import { sameTarget } from "./home.logic";
import { useAldoHomeFeed } from "./homeFeed";
import type { AldoHomeConversation } from "./homeApi";
import { WORKSTREAM_WORDS, workstreamMeta, workstreamState } from "./workstream.logic";
import { voicePresenceState } from "./presence.logic";
import { acknowledgeAldo, setAldoReading } from "./presenceReactions";
import { dedupeLiveCards, interleave, type AldoFeedEvent } from "./feed.logic";
import { type AldoPlaceable } from "./decisions.logic";
import { linkRows, withoutShownLinks, type AldoArtifact } from "./artifacts.logic";
import { useAldoFirstViewHold } from "./firstView";
import { AldoCallCard } from "./AldoCallCard";
import { AldoPlanPicker } from "./AldoPlanPicker";
import { CHIP } from "./surface";
import "./presence.css";

const OVERVIEW_EVERY_MS = 20_000;

/** The mark: tap to talk or hang up; its light follows whoever is speaking. */
let assistantInfo: ReturnType<typeof aldoAssistantInfo> | null = null;
let assistantAvailable: boolean | null = null;

/** Whether this Aldo has the assistant, asked once per page (not until `ask`); null until it's known. */
export function useAldoAssistantAvailable(ask = true): boolean | null {
  // Known at once after the first answer, so a screen that opens again doesn't blank a frame.
  const [available, setAvailable] = useState<boolean | null>(() =>
    ask ? assistantAvailable : null,
  );
  useEffect(() => {
    if (!ask) return;
    let current = true;
    assistantInfo ??= aldoAssistantInfo();
    void assistantInfo.then((info) => {
      assistantAvailable = info.available;
      if (current) setAvailable(info.available);
    });
    return () => {
      current = false;
    };
  }, [ask]);
  return available;
}

/** The images and files this Aldo's written messages take, asked once per page; each null when none (or not known yet). */
function useAldoAttachLimits(): {
  readonly images: AldoImageLimits | null;
  readonly files: AldoFileLimits | null;
} {
  const [limits, setLimits] = useState<{
    images: AldoImageLimits | null;
    files: AldoFileLimits | null;
  }>({ images: null, files: null });
  useEffect(() => {
    let current = true;
    assistantInfo ??= aldoAssistantInfo();
    void assistantInfo.then((info) => {
      if (current) setLimits({ images: info.images, files: info.files });
    });
    return () => {
      current = false;
    };
  }, []);
  return limits;
}

/** A file attached in Home's composer: named as the message will name it, with its bytes while it uploads. */
type HomeFile = AldoFileUpload & {
  readonly file: File | null;
  readonly state: "uploading" | "ready" | "failed";
};

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
export const ALDO_SHORTCUT_LABEL = ALDO_TALK_LABEL;

export function AldoVoiceMark(props: {
  readonly size?: "xl" | "lg" | "sm" | "xs";
  readonly className?: string;
  /** The audio-reactive mark: not a button (the call screen's, AldoCallScreen.tsx). */
  readonly display?: boolean;
}) {
  const phase = useAldoAssistant((s) => s.phase);
  const live = phase !== "idle" && phase !== "error";
  const size = props.size ?? "lg";
  const pixels = { xl: 160, lg: 80, sm: 36, xs: 24 }[size];
  const visuals = <AldoFrame size={pixels} state={voicePresenceState(phase)} />;
  const box = cn(
    "relative flex shrink-0 items-center justify-center rounded-lg",
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

/** How long after the last key Aldo stops looking at what the user writes. */
const READING_MS = 600;

/** The composer's field grows with what's typed, up to about five lines, then scrolls. */
const FIELD_MAX_PX = 132;

/**
 * Typing to Aldo: one field that grows with what's written, images on the
 * left, and on the right one button that's the voice while it's empty and
 * send once there's something to send. On a call it has mute and hang up
 * (and on a phone, back to the call). `chips` are things to say, under it:
 * the empty conversation's. Enter sends where there's a keyboard to make a
 * new line otherwise (Shift+Enter); a phone's return makes a new line.
 */
export function AldoComposer(props: {
  readonly chips: ReadonlyArray<string>;
  readonly onChip: (chip: string) => void;
  /** Called with the send about to happen: the page glides the composer to its place for it. */
  readonly onSend?: (send: () => void) => void;
}) {
  const phone = useIsMobile();
  const coarse = useMediaQuery("(pointer: coarse)");
  const muted = useAldoAssistant((s) => s.muted);
  const micOn = useAldoAssistant((s) => s.micOn);
  const [text, setText] = useState("");
  const [images, setImages] = useState<ReadonlyArray<AldoImageUpload>>([]);
  /** Files attached, each uploading as it's attached (its bytes gone once given back: `file` null). */
  const [files, setFiles] = useState<ReadonlyArray<HomeFile>>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  /** Images being made ready to send: the message waits for them. */
  const [preparing, setPreparing] = useState(0);
  const phase = useAldoAssistant((s) => s.phase);
  const unsent = useAldoAssistant((s) => s.unsent);
  const unsentImages = useAldoAssistant((s) => s.unsentImages);
  const unsentFiles = useAldoAssistant((s) => s.unsentFiles);
  const input = useRef<HTMLTextAreaElement>(null);
  const { images: limits, files: fileLimits } = useAldoAttachLimits();
  const live = phase !== "idle" && phase !== "error";
  // Images and files go in writing: not into a call.
  const canAttach = limits !== null && !live;
  // Briefly emphasize the mark while the user types.
  const reading = useRef<ReturnType<typeof setTimeout> | null>(null);
  const read = (on: boolean) => {
    if (reading.current) clearTimeout(reading.current);
    reading.current = null;
    setAldoReading(on);
    if (on) reading.current = setTimeout(() => setAldoReading(false), READING_MS);
  };
  useEffect(
    () => () => {
      if (reading.current) clearTimeout(reading.current);
      setAldoReading(false);
    },
    [],
  );
  // The field fits what's in it, as it's typed and as it narrows (a window resized).
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const fit = () => {
      field.style.height = "auto";
      field.style.height = `${Math.min(field.scrollHeight, FIELD_MAX_PX)}px`;
      field.style.overflowY = field.scrollHeight > FIELD_MAX_PX ? "auto" : "hidden";
    };
    fit();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      fit();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [text]);
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
  // And files, uploaded already.
  useEffect(() => {
    if (unsentFiles === null) return;
    setFiles((current) => [
      ...unsentFiles.map((named) => ({ ...named, file: null, state: "ready" as const })),
      ...current.filter((file) => !unsentFiles.some((u) => u.id === file.id)),
    ]);
    useAldoAssistant.setState({ unsentFiles: null });
  }, [unsentFiles]);
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
  /** A file goes up to Aldo as it's attached, so the message only names it. */
  const upload = (attached: HomeFile) => {
    if (!attached.file) return;
    const mark = (state: HomeFile["state"]) =>
      setFiles((current) => current.map((f) => (f.id === attached.id ? { ...f, state } : f)));
    mark("uploading");
    uploadAldoHomeFile(attached.id, attached.file).then(
      () => mark("ready"),
      (error: unknown) => {
        mark("failed");
        setImageError(error instanceof Error ? error.message : null);
      },
    );
  };
  const addFiles = (picked: ReadonlyArray<File>) => {
    if (!fileLimits || picked.length === 0) return;
    setImageError(null);
    const fits = picked.filter((file) => file.size > 0 && file.size <= fileLimits.maxBytes);
    const room = fileLimits.max - files.length;
    if (fits.length < picked.length)
      setImageError(`A file is at most ${Math.round(fileLimits.maxBytes / 1024 / 1024)} MB.`);
    else if (fits.length > room) setImageError(`At most ${fileLimits.max} files with a message.`);
    const added = fits.slice(0, Math.max(0, room)).flatMap((file): HomeFile[] => {
      const name = file.name || "file";
      const id = aldoAttachmentId({ type: "file", name, mimeType: file.type }, randomUUID());
      if (!id) return [];
      const mimeType = file.type || "application/octet-stream";
      return [{ id, name, mimeType, sizeBytes: file.size, file, state: "uploading" }];
    });
    setFiles((current) => [...current, ...added]);
    added.forEach(upload);
  };
  /** What was picked, dropped or pasted: images Aldo sees as images, anything else as a file (where Aldo takes files). */
  const attach = (picked: ReadonlyArray<File>) => {
    const asImage = (file: File) =>
      !fileLimits ||
      isHeicImageFile(file) ||
      (limits?.types.includes(normalizeComposerImageFileMimeType(file).type) ?? false);
    addImages(picked.filter(asImage));
    addFiles(picked.filter((file) => !asImage(file)));
  };
  /** The words last seeded, so another seed replaces them while they're untouched. */
  const seeded = useRef<string | null>(null);
  // What couldn't be sent comes back to be sent again, and words seeded for
  // the user to finish; a draft already in the field is kept, after them.
  useEffect(() => {
    if (unsent === null) return;
    setText((current) => {
      if (!current.trim() || current === seeded.current) return unsent;
      if (!unsent.trim()) return current;
      return `${unsent} ${current}`;
    });
    seeded.current = unsent;
    useAldoAssistant.setState({ unsent: null });
    const field = input.current;
    field?.focus();
    // At the end of what was seeded, to carry on from there.
    requestAnimationFrame(() => field?.setSelectionRange(field.value.length, field.value.length));
  }, [unsent]);
  const sendable = text.trim().length > 0 || (canAttach && images.length + files.length > 0);
  // The message waits for its images to be ready and its files uploaded.
  const waiting = preparing > 0 || (canAttach && files.some((file) => file.state !== "ready"));
  const submit = () => {
    if (waiting) return;
    // During a call images and files don't go: they stay for after it.
    const sending = canAttach ? images : [];
    const sendingFiles: AldoFileUpload[] = canAttach
      ? files.map(({ id, name, mimeType, sizeBytes }) => ({ id, name, mimeType, sizeBytes }))
      : [];
    if (!text.trim() && sending.length + sendingFiles.length === 0) return;
    const send = () => {
      sendText(text, sending, sendingFiles);
      setText("");
      if (sending.length > 0) setImages([]);
      if (sendingFiles.length > 0) setFiles([]);
      setImageError(null);
    };
    if (props.onSend) props.onSend(send);
    else send();
    // A touch screen's keyboard would otherwise cover the reply.
    if (coarse) input.current?.blur();
    read(false);
    acknowledgeAldo();
  };
  const round =
    "relative flex size-11 shrink-0 items-center justify-center rounded-full outline-none transition-[background-color,opacity,transform] duration-100 focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-40 motion-reduce:transition-none";
  const quiet = cn(round, "text-foreground/75 hover:bg-foreground/[0.06] hover:text-foreground");
  return (
    <div className="flex w-full flex-col gap-3">
      <form
        className="group/composer flex w-full min-w-0 flex-col rounded-[28px] border border-foreground/[0.10] bg-card p-1.5 shadow-composer transition-[border-color] duration-[120ms] focus-within:border-foreground/20 dark:border-white/[0.10] dark:bg-white/[0.06] dark:shadow-composer-dark dark:focus-within:border-white/20"
        data-aldo-composer="page"
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
          attach([...event.dataTransfer.files]);
        }}
      >
        {canAttach && (images.length > 0 || files.length > 0 || preparing > 0 || imageError) ? (
          <div className="flex flex-col gap-1.5 px-2 pt-1.5 pb-1">
            <div className="flex flex-wrap gap-2">
              {images.map((image, index) => (
                <div key={image.dataUrl} data-aldo-arrive="" className="group/image relative">
                  <img
                    src={image.dataUrl}
                    alt={image.name}
                    className="size-12 rounded-xl object-cover ring-1 ring-foreground/10"
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${image.name}`}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                  >
                    <XIcon className="size-3" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
              {preparing > 0 ? (
                <div
                  role="status"
                  aria-label="Getting the image ready"
                  className="size-12 animate-pulse rounded-xl bg-foreground/[0.06] motion-reduce:animate-none"
                />
              ) : null}
              {files.map((file) => (
                <AldoFileChip
                  key={file.id}
                  name={file.name}
                  sizeBytes={file.sizeBytes}
                  state={file.state}
                  onRemove={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
                  onRetry={file.file ? () => upload(file) : undefined}
                />
              ))}
            </div>
            {imageError ? (
              <p className="text-[12px] text-destructive-foreground leading-[18px]">{imageError}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-end gap-1">
          {canAttach ? (
            <AldoAttachMenu
              trigger={
                <button
                  type="button"
                  aria-label={fileLimits ? "Add photos and files" : "Add photos"}
                  className={quiet}
                />
              }
              disabled={
                images.length >= limits.max && (!fileLimits || files.length >= fileLimits.max)
              }
              photos="image/*"
              files={fileLimits !== null}
              onPick={attach}
            >
              <PlusIcon className="size-5" strokeWidth={1.75} />
            </AldoAttachMenu>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <textarea
            ref={input}
            rows={1}
            className="block max-h-[132px] min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-6 outline-none placeholder:text-muted-foreground/75 sm:text-[15px]"
            autoComplete="off"
            aria-label="Message Aldo"
            enterKeyHint={coarse ? "enter" : "send"}
            value={text}
            placeholder={live ? "Or type to Aldo…" : "Message Aldo"}
            onChange={(event) => {
              setText(event.target.value);
              read(event.target.value.length > 0);
            }}
            onBlur={() => read(false)}
            onKeyDown={(event) => {
              // Enter sends where Shift+Enter can make a new line; never mid-composition (an IME's Enter picks a word).
              if (event.key !== "Enter" || event.shiftKey || coarse) return;
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              submit();
            }}
            onPaste={(event) => {
              if (!canAttach) return;
              const pasted = [...event.clipboardData.files].filter(
                (file) => fileLimits !== null || classifyComposerAttachmentFile(file) !== "file",
              );
              if (pasted.length === 0) return;
              event.preventDefault();
              attach(pasted);
            }}
          />
          {live && micOn ? (
            <button
              type="button"
              aria-label={muted ? "Unmute" : "Mute"}
              className={quiet}
              onClick={() => setAldoMuted(!muted)}
            >
              {muted ? (
                <MicOffIcon className="size-5" strokeWidth={1.75} />
              ) : (
                <MicIcon className="size-5" strokeWidth={1.75} />
              )}
            </button>
          ) : null}
          {live && phone ? (
            <button
              type="button"
              aria-label="Back to the call"
              className={quiet}
              onClick={showAldoCall}
            >
              <span aria-hidden className="size-2.5 rounded-full bg-primary" />
            </button>
          ) : null}
          {live ? (
            <button
              type="button"
              aria-label="Hang up"
              className={cn(
                round,
                "bg-destructive/12 text-destructive-foreground hover:bg-destructive/20",
              )}
              onClick={disconnectAldo}
            >
              <PhoneOffIcon className="size-[18px]" strokeWidth={1.75} />
            </button>
          ) : null}
          {live && !sendable ? null : (
            // One place for both: the voice while there's nothing to send, send once there is.
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type={sendable ? "submit" : "button"}
                    aria-label={sendable ? "Send" : "Talk to Aldo"}
                    disabled={sendable && waiting}
                    // Keep the keyboard and composer in place as the user sends follow-ups on a phone.
                    onPointerDown={(event) => {
                      if (sendable && document.activeElement === input.current)
                        event.preventDefault();
                    }}
                    className={cn(round, "bg-foreground text-background hover:bg-foreground/88")}
                    onClick={sendable ? undefined : () => void connectAldo()}
                  />
                }
              >
                <AudioLinesIcon
                  aria-hidden
                  className={cn(
                    "absolute size-5 transition-[opacity,scale] duration-100 motion-reduce:transition-none",
                    sendable ? "scale-50 opacity-0" : "scale-100 opacity-100",
                  )}
                  strokeWidth={1.75}
                />
                <ArrowUpIcon
                  aria-hidden
                  className={cn(
                    "absolute size-5 transition-[opacity,scale] duration-100 motion-reduce:transition-none",
                    sendable ? "scale-100 opacity-100" : "scale-50 opacity-0",
                  )}
                  strokeWidth={2.25}
                />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {sendable ? "Send" : `Talk to Aldo (${ALDO_SHORTCUT_LABEL})`}
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
      </form>
      {props.chips.length > 0 && !text ? (
        <div className="flex flex-wrap justify-center gap-2">
          {props.chips.map((chip) => (
            <button key={chip} type="button" className={CHIP} onClick={() => props.onChip(chip)}>
              {chip}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The conversation: from the start, or `since` an entry (the summon bar shows
 * what followed its question), the newest action about each thread as a live
 * card. On the home screen it's a messaging thread: days marked, what happened
 * to the user's agents put where it happened (`feed`, AldoFeed.tsx), and what
 * waits on them at its creation time (`decisions`, drawn by
 * `renderDecisions`: AldoUpNext.tsx).
 */
export function AldoConversation(
  props: {
    readonly since?: number;
    readonly feed?: ReadonlyArray<AldoFeedEvent>;
    readonly decisions?: ReadonlyArray<AldoPlaceable>;
    /** Cards in the timeline, or null for the conversation's walkthrough control. */
    readonly renderDecisions?: (
      keys: ReadonlyArray<string> | null,
      placedAt: ReadonlyMap<string, string>,
    ) => ReactNode;
  } = {},
) {
  const all = useAldoAssistant((s) => s.entries);
  const loaded = useAldoAssistant((s) => s.historyLoaded);
  useAldoFirstViewHold(!loaded);
  const replying = useAldoAssistant((s) => s.replying);
  const planPick = useAldoAssistant((s) => s.planPick);
  const since = props.since ?? 0;
  const live = useMemo(() => liveCardIndexes(all), [all]);
  const entries = since > 0 ? all.slice(since) : all;
  const items = useMemo(() => {
    const shown = entries.flatMap((entry, index) =>
      entry.kind === "action" && entry.open && !entry.call && live.has(since + index)
        ? [entry.open]
        : [],
    );
    const feed = dedupeLiveCards(props.feed ?? [], shown);
    return interleave(
      entries,
      feed,
      (entry) => (onCall(entry) ? null : entry.kind === "action" ? null : entry.at),
      props.decisions,
    ).filter((item) => item.kind !== "entry" || !onCall(item.entry));
  }, [entries, props.feed, props.decisions, live, since]);
  const shownCount = items.length;
  const placedAt = useMemo(
    () => new Map((props.decisions ?? []).map((card) => [card.key, card.at])),
    [props.decisions],
  );
  const { renderDecisions } = props;
  // Acknowledge the completed reply.
  const wasReplying = useRef(replying);
  useEffect(() => {
    if (wasReplying.current && !replying) acknowledgeAldo();
    wasReplying.current = replying;
  }, [replying]);
  const end = useRef<HTMLDivElement>(null);
  const last = entries.at(-1);
  const sent = last?.kind === "message" && last.role === "user" ? last.at : null;
  // What the user just said shows, wherever they'd scrolled to; on the page,
  // everything else follows the end only while they're at it (its
  // useStickToBottom). The summon has nothing like it, so there it all follows.
  useEffect(() => {
    if (sent) end.current?.scrollIntoView({ block: "end" });
  }, [sent]);
  const follows = props.feed === undefined;
  useEffect(() => {
    if (follows) end.current?.scrollIntoView({ block: "end" });
  }, [follows, shownCount, replying, planPick?.stage]);
  let day: string | null = null;
  return (
    <div className="flex flex-col gap-6">
      {items.map((item) => {
        const at =
          item.kind === "entry"
            ? item.entry.kind === "action"
              ? null
              : item.entry.at
            : item.kind === "card"
              ? item.at
              : item.events[0]!.at;
        const label = props.feed && at ? dayLabel(at) : null;
        const marker =
          label && label !== day ? (
            <p
              key={`day-${at}`}
              className="pt-1 text-center font-medium text-[12px] text-muted-foreground/70"
            >
              {label}
            </p>
          ) : null;
        if (label) day = label;
        if (item.kind === "card")
          return [
            marker,
            <Fragment key={item.key}>{renderDecisions?.([item.key], placedAt)}</Fragment>,
          ];
        if (item.kind === "events")
          return [marker, <AldoFeedRun key={item.key} events={item.events} />];
        const { entry, index } = item;
        return [
          marker,
          <ConversationEntry
            key={
              entry.kind === "action"
                ? entry.id
                : entry.kind === "call"
                  ? `call-${entry.id}`
                  : `${entry.at}-${since + index}`
            }
            entry={entry}
            live={live.has(since + index)}
            beats={props.feed !== undefined}
          />,
          // A request kept until a plan's chosen: the plan picker under it.
          planPick?.entry === entry ? (
            <AldoPlanPicker key={`plan-${planPick.requestId}`} pick={planPick} />
          ) : null,
        ];
      })}
      {replying ? <TypingDots /> : null}
      {renderDecisions?.(null, placedAt)}
      <div ref={end} />
    </div>
  );
}

/** A day in the conversation, as a messaging app marks it: Today, Yesterday, a weekday, a date. */
function dayLabel(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) /
      86_400_000,
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return at.toLocaleDateString(undefined, { weekday: "long" });
  return at.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function ConversationEntry({
  entry,
  live,
  beats,
}: {
  readonly entry: AldoConversationEntry;
  readonly live: boolean;
  /** Replies that arrive come in beats: on the home screen's page, not the bar, which shows the end at once. */
  readonly beats?: boolean;
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
        {entry.open ? <ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} /> : null}
      </span>
    );
    const line = (
      <div className="flex items-center gap-2.5 self-start text-[14px] text-muted-foreground leading-5">
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
          <AldoFrame size={14} />
        </span>
        {entry.href ? (
          <a href={entry.href} target="_blank" rel="noreferrer" className="hover:text-foreground">
            <span className="inline-flex items-center gap-1">
              {entry.label}
              <ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} />
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
  if (entry.kind === "call") return <AldoCallCard call={entry} />;
  if (entry.role === "user") return <UserMessage entry={entry} />;
  if (entry.source === "brief") return <AldoBriefEntry text={entry.text} at={entry.at} />;
  return <AldoReply text={entry.text} beats={beats === true} artifacts={entry.artifacts} />;
}

/** What a reply shows under its words: loaded once one does, off the first screen. */
const AldoArtifacts = lazy(() => import("./AldoArtifacts"));

/**
 * What Aldo said, in bubbles: a paragraph each, a beat apart with the dots
 * between when it's just arrived on the page (`beats`; beats.logic.ts), all at
 * once from history, in the bar and under reduced motion. A result about a
 * thread carries that thread's name and where it stands over its words, a tap
 * into it, rather than its address. What it shows (`artifacts`) follows its
 * words, the width of the conversation, without the lines that only link to it;
 * the other links a result ends with are listed with it.
 */
function AldoReply(props: {
  readonly text: string;
  readonly beats?: boolean;
  readonly artifacts?: ReadonlyArray<AldoArtifact> | undefined;
}) {
  const arrived = useAldoArrived();
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  const artifacts = props.artifacts ?? [];
  const closing = closingThread(props.text);
  // The thread it's about, as the home screen reads it: none for an older Aldo or a thread since deleted.
  const about = useAldoHomeFeed((s) =>
    closing ? s.home?.conversations.find((c) => sameTarget(c.thread, closing.thread)) : undefined,
  );
  const kept = withoutShownLinks(closing?.text ?? props.text, artifacts);
  const { text, links } = closing ? linkRows(kept) : { text: kept, links: [] };
  const said = useMemo(() => splitBeats(text), [text]);
  // Nothing but the thread's link, and nothing known about it: the link alone.
  const linkOnly = said.length === 0 && closing !== null && !about;
  const beats = useMemo(() => (linkOnly ? [""] : said), [linkOnly, said]);
  const [shown, setShown] = useState(() =>
    props.beats && arrived && !still ? 1 : Number.POSITIVE_INFINITY,
  );
  useEffect(() => {
    if (shown >= beats.length) return;
    const timer = window.setTimeout(() => setShown((n) => n + 1), beatDelay(beats[shown]!));
    return () => window.clearTimeout(timer);
  }, [shown, beats]);
  const visible = beats.slice(0, shown);
  const words = (
    <div className="flex max-w-[88%] flex-col items-start gap-1 self-start sm:max-w-[80%]">
      {about ? <WorkstreamLabel conversation={about} /> : null}
      {visible.map((beat, index) => {
        const last = index === beats.length - 1;
        return (
          <p
            // oxlint-disable-next-line react/no-array-index-key -- A reply's beats only ever add on, and two may read the same.
            key={index}
            {...(arrived ? { "data-aldo-reply": "" } : {})}
            className={cn(
              "whitespace-pre-wrap wrap-anywhere rounded-[20px] border border-foreground/[0.07] bg-card px-4 py-2 text-[16px] leading-6 sm:text-[15px] dark:border-white/[0.08] dark:bg-white/[0.045]",
              last && "rounded-bl-[8px]",
            )}
          >
            {linkRuns(beat).map((run) =>
              run.href ? (
                <a
                  key={run.at}
                  href={run.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-foreground"
                >
                  {run.text}
                </a>
              ) : (
                run.text
              ),
            )}
            {last && closing && !about ? (
              <>
                {beat ? "\n" : null}
                {threadLink(
                  closing.thread,
                  "Open the thread",
                  "text-[14px] text-muted-foreground underline decoration-foreground/20 underline-offset-4 hover:text-foreground",
                )}
              </>
            ) : null}
          </p>
        );
      })}
      {shown < beats.length ? <TypingDots quiet /> : null}
    </div>
  );
  if (artifacts.length === 0 && links.length === 0) return words;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {words}
      {shown >= beats.length ? (
        <Suspense fallback={null}>
          <AldoArtifacts artifacts={artifacts} links={links} />
        </Suspense>
      ) : null}
    </div>
  );
}

/**
 * The thread a reply is about, over it: its glyph (a hand when it needs the
 * user, a spinner while it works, a check once it's done, a clock while it's
 * put off), its name and how long, from the home screen's read. A tap opens
 * it. When the read doesn't have it, the reply ends with a link to it instead.
 */
function WorkstreamLabel(props: { readonly conversation: AldoHomeConversation }) {
  const { conversation } = props;
  const now = Date.now();
  const state = workstreamState(conversation, now);
  const body = (
    <>
      {state ? (
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
          <WorkstreamGlyph state={state} />
        </span>
      ) : null}
      {state ? <span className="sr-only">{WORKSTREAM_WORDS[state]}: </span> : null}
      <span className="min-w-0 truncate font-medium text-foreground">{conversation.title}</span>
      {state ? (
        <span className="shrink-0 whitespace-nowrap">
          {"· "}
          {workstreamMeta(conversation, state, now)}
        </span>
      ) : null}
      <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 opacity-60" strokeWidth={2} />
    </>
  );
  const className =
    "-ms-1.5 mt-1 inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-1.5 text-[13px] text-muted-foreground leading-4 transition-colors hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11";
  return (
    <OpenThread target={conversation.thread} className={className}>
      {body}
    </OpenThread>
  );
}

/** Aldo typing: three dots in a bubble of its own. `quiet` between a reply's beats, which the reply itself is there for. */
function TypingDots(props: { readonly quiet?: boolean }) {
  return (
    <div
      data-aldo-typing=""
      className="flex h-10 items-center gap-1 self-start rounded-[20px] rounded-bl-[8px] border border-foreground/[0.07] bg-card px-4 dark:border-white/[0.08] dark:bg-white/[0.045]"
      {...(props.quiet
        ? { "aria-hidden": true }
        : { role: "status", "aria-label": "Aldo is typing" })}
    >
      <span className="size-1.5 rounded-full bg-muted-foreground" />
      <span className="size-1.5 rounded-full bg-muted-foreground" />
      <span className="size-1.5 rounded-full bg-muted-foreground" />
    </div>
  );
}

/** What the user said, with the images they sent: shown, or named when the message was kept (from before this page). */
function UserMessage({
  entry,
}: {
  readonly entry: Extract<AldoConversationEntry, { kind: "message" }>;
}) {
  const { text, images: named, files: namedFiles } = withoutImageNotes(entry.text);
  const files: ReadonlyArray<{ id: string; name: string; sizeBytes?: number }> =
    entry.files ?? namedFiles;
  const trouble = useAldoAssistant((s) => s.undelivered?.find((u) => u.entry === entry));
  const arrive = useAldoArrive();
  return (
    <div {...arrive} className="flex min-w-0 max-w-[80%] flex-col items-end gap-1.5 self-end">
      {entry.images && entry.images.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {entry.images.map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              className="size-20 rounded-2xl object-cover ring-1 ring-foreground/10"
            />
          ))}
        </div>
      ) : null}
      {!entry.images?.length && named.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {named.map(({ id, name }) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.05] px-2.5 py-0.5 text-[12px] text-muted-foreground"
            >
              <ImageIcon className="size-3" />
              {name}
            </span>
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="flex max-w-full flex-wrap justify-end gap-1.5">
          {files.map((file) => (
            <AldoFileChip key={file.id} name={file.name} sizeBytes={file.sizeBytes} />
          ))}
        </div>
      ) : null}
      {text ? (
        <p className="max-w-full whitespace-pre-wrap wrap-anywhere rounded-[20px] rounded-br-[8px] bg-message px-4 py-2 text-[16px] text-message-foreground leading-6 sm:text-[15px]">
          {text}
        </p>
      ) : null}
      {trouble?.error ? (
        <div
          role="status"
          className="max-w-full wrap-anywhere text-right text-[12px] text-muted-foreground"
        >
          {trouble.error}{" "}
          <button
            type="button"
            className="min-h-11 underline underline-offset-2"
            onClick={() => retryAldoMessage(entry)}
          >
            Try again
          </button>
        </div>
      ) : trouble ? (
        <span role="status" className="max-w-full text-[12px] text-muted-foreground">
          Sending…
        </span>
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
