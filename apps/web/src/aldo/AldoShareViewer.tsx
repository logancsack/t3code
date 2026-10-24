// A shared page or file opened in Aldo itself (shareViewer.ts): beside the
// conversation on a wide screen, the whole screen on a phone. It's the share's
// own link (/s/<id>), so a page that stays current shows its latest version,
// says when that was, and can be pinned first in the Library. A page runs
// sandboxed, as its link serves it; "Open in a new tab" leaves Aldo for it.

import {
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  GlobeIcon,
  PinIcon,
  PinOffIcon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { canShowPdfInFrame } from "../components/files/filePreviewMode";
import { Button } from "../components/ui/button";
import { Sheet, SheetPopup, SheetTitle } from "../components/ui/sheet";
import { Spinner } from "../components/ui/spinner";
import { toastManager } from "../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { downloadHref } from "./artifacts.logic";
import { aldoShareUpdated } from "./library.logic";
import {
  aldoShareChanged,
  closeAldoShare,
  useAldoOpenShare,
  type AldoOpenShare,
} from "./shareViewer";
import { pinAldoShare } from "./workspaceApi";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Mounted once (routes/__root.tsx): the viewer, while a share is open in it. */
export function AldoShareViewerHost() {
  const open = useAldoOpenShare();
  return open ? <AldoShareViewer key={open.url} open={open} /> : null;
}

function IconButton(props: {
  readonly label: string;
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly href?: string;
  /** Saves what `href` goes to, named so, rather than opening it. */
  readonly download?: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={props.label}
            {...(props.pressed === undefined ? {} : { "aria-pressed": props.pressed })}
            {...(props.disabled ? { disabled: true } : {})}
            {...(props.onClick ? { onClick: props.onClick } : {})}
            {...(props.href
              ? {
                  render:
                    props.download === undefined ? (
                      <a href={props.href} target="_blank" rel="noopener noreferrer" />
                    ) : (
                      <a href={props.href} download={props.download} />
                    ),
                }
              : {})}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function AldoShareViewer(props: { readonly open: AldoOpenShare }) {
  const { open } = props;
  const listed = open.share;
  const type = open.contentType.split(";")[0]!.trim().toLowerCase();
  // Chrome on Android has no PDF viewer for a frame: the PDF opens in a new tab instead.
  const pdfOutside =
    type === "application/pdf" &&
    !canShowPdfInFrame(typeof navigator === "undefined" ? undefined : navigator);
  // A player shows itself at once, as does what's said in place of a PDF.
  const [loaded, setLoaded] = useState(type.startsWith("audio/") || pdfOutside);
  const [pinning, setPinning] = useState(false);
  // What /s/ serves as a page (Markdown too, as one to read): sandboxed here as well.
  const page = type === "text/html" || type === "image/svg+xml" || type === "text/markdown";
  const updated = listed ? aldoShareUpdated(listed, new Date()) : null;
  const pin = () => {
    if (!open.id || listed?.pinned === undefined) return;
    setPinning(true);
    pinAldoShare(open.id, !listed.pinned)
      .then(aldoShareChanged)
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: listed.pinned ? "Couldn't unpin it" : "Couldn't pin it",
          description: messageOf(cause),
        }),
      )
      .finally(() => setPinning(false));
  };
  const Icon = page ? GlobeIcon : FileIcon;
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) closeAldoShare();
      }}
    >
      {/* Full width on a phone, clear of the notch and the home indicator. */}
      <SheetPopup
        side="right"
        showCloseButton={false}
        className="w-full max-w-3xl pt-safe pb-safe max-sm:border-s-0"
      >
        {/* On a phone the sidebar's toggle floats over the sheet's corner: its title starts past it. */}
        <div className="flex items-center gap-2 border-border/60 border-b px-4 py-2 max-sm:ps-14">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <SheetTitle className="truncate font-semibold text-base">{open.title}</SheetTitle>
            {updated ? <p className="truncate text-muted-foreground text-xs">{updated}</p> : null}
          </div>
          <span className="ms-auto flex shrink-0 items-center gap-1">
            {open.id && listed?.pinned !== undefined ? (
              <IconButton
                label={listed.pinned ? "Unpin from the Library" : "Pin first in the Library"}
                pressed={listed.pinned}
                disabled={pinning}
                onClick={pin}
              >
                {listed.pinned ? <PinOffIcon /> : <PinIcon />}
              </IconButton>
            ) : null}
            <IconButton
              label="Download"
              href={downloadHref(open.url, window.location.origin, type)}
              // Named as /s/ names it, with its type's extension.
              download=""
            >
              <DownloadIcon />
            </IconButton>
            <IconButton label="Open in a new tab" href={open.url}>
              <ExternalLinkIcon />
            </IconButton>
            <IconButton label="Close" onClick={closeAldoShare}>
              <XIcon />
            </IconButton>
          </span>
        </div>
        <div className="relative min-h-0 flex-1 bg-muted/40">
          {!loaded ? (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <Spinner />
            </div>
          ) : null}
          {type.startsWith("image/") && !page ? (
            <img
              src={open.url}
              alt={open.title}
              className="size-full object-contain"
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
            />
          ) : type.startsWith("video/") ? (
            <video
              src={open.url}
              controls
              playsInline
              className="size-full bg-black object-contain"
              onLoadedData={() => setLoaded(true)}
              onError={() => setLoaded(true)}
            />
          ) : type.startsWith("audio/") ? (
            <div className="flex size-full items-center justify-center p-6">
              <audio src={open.url} controls className="w-full max-w-md" />
            </div>
          ) : pdfOutside ? (
            <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-muted-foreground text-sm">This browser can’t show the PDF here.</p>
              <Button
                variant="outline"
                size="sm"
                render={<a href={open.url} target="_blank" rel="noopener noreferrer" />}
              >
                <ExternalLinkIcon />
                Open the PDF
              </Button>
            </div>
          ) : (
            // A PDF doesn't show in a sandboxed frame; it, text and data run nothing.
            // oxlint-disable-next-line react/iframe-missing-sandbox
            <iframe
              src={open.url}
              title={open.title}
              className={page ? "size-full border-0 bg-white" : "size-full border-0"}
              // As its link serves a page: its own origin, never Aldo's.
              {...(page
                ? {
                    sandbox:
                      "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads",
                  }
                : {})}
              onLoad={() => setLoaded(true)}
            />
          )}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
