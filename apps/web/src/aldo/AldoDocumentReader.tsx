// A document the turn made, read as a page beside the thread (AldoMadeCards):
// Markdown or text, split at its headings (results.logic.ts) so each part, a
// listing's title, its tags, its description, has its own Copy. Copy takes
// the words as they read, without the Markdown around them, ready to paste
// into a form field.

import type { ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, CopyIcon, FileTextIcon, PanelRightIcon, XIcon } from "lucide-react";
import { useMemo, useRef } from "react";
import type { ReactNode } from "react";

import ChatMarkdown from "../components/ChatMarkdown";
import { useProjectFileQuery } from "../components/files/projectFilesQueryState";
import { Button } from "../components/ui/button";
import { Sheet, SheetPopup, SheetTitle } from "../components/ui/sheet";
import { Spinner } from "../components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";
import { useRightPanelStore } from "../rightPanelStore";
import { resolvePathLinkTarget } from "../terminal-links";
import {
  aldoDocumentSections,
  type AldoDocumentSection,
  type AldoResultItem,
} from "./results.logic";

/** A heading's words without the Markdown around them. */
function plainHeading(heading: string): string {
  return heading.replace(/(\*\*|__|`)/g, "").trim();
}

function CopyButton(props: { readonly label: string; readonly copy: () => string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <Button
      size="xs"
      variant="ghost"
      className="ms-auto"
      aria-label={`Copy ${props.label}`}
      onClick={() => copyToClipboard(props.copy(), undefined)}
    >
      {isCopied ? <CheckIcon /> : <CopyIcon />}
      {isCopied ? "Copied" : "Copy"}
    </Button>
  );
}

function SectionBlock(props: {
  readonly section: AldoDocumentSection;
  readonly markdown: boolean;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRoot: string;
  readonly imageBaseDir: string;
}) {
  const { section } = props;
  const body = useRef<HTMLDivElement>(null);
  const heading = section.heading ? plainHeading(section.heading) : null;
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card/30">
      <div className="flex min-h-9 items-center gap-2 border-border/40 border-b px-3 py-1">
        {heading ? <h3 className="min-w-0 truncate font-medium text-sm">{heading}</h3> : null}
        <CopyButton
          label={heading ?? "this part"}
          // As it reads: what a form field takes, without the Markdown.
          copy={() => body.current?.innerText.trim() || section.body}
        />
      </div>
      <div ref={body} className="px-3 py-2">
        {props.markdown ? (
          <ChatMarkdown
            text={section.body}
            cwd={props.workspaceRoot}
            imageBaseDir={props.imageBaseDir}
            threadRef={props.threadRef}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{section.body}</p>
        )}
      </div>
    </section>
  );
}

export function AldoDocumentReader(props: {
  readonly item: AldoResultItem;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRoot: string;
  /** Who can open it, and Share…. */
  readonly audience: ReactNode;
  readonly onClose: () => void;
}) {
  const { item, threadRef, workspaceRoot } = props;
  const path = item.path;
  const file = useProjectFileQuery(threadRef.environmentId, workspaceRoot, path, path !== null);
  const contents = file.data?.contents ?? null;
  const markdown = /\.(md|markdown)$/i.test(item.fileName);
  const parts = useMemo(
    () => (contents === null ? null : aldoDocumentSections(contents)),
    [contents],
  );
  const imageBaseDir = useMemo(() => {
    const slash = path ? path.lastIndexOf("/") : -1;
    return slash >= 0 && path
      ? resolvePathLinkTarget(path.slice(0, slash), workspaceRoot)
      : workspaceRoot;
  }, [path, workspaceRoot]);
  const title = parts?.title ? plainHeading(parts.title) : item.name;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      {/* Full width on a phone, clear of the notch and the home indicator. */}
      <SheetPopup
        side="right"
        showCloseButton={false}
        className="w-full max-w-2xl pt-safe pb-safe max-sm:border-s-0"
      >
        <div className="flex items-center gap-2 border-border/60 border-b px-4 py-2.5">
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          <SheetTitle className="min-w-0 truncate font-semibold text-base">{title}</SheetTitle>
          <span className="ms-auto flex shrink-0 items-center gap-1">
            {props.audience}
            {path ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Open in Files"
                      onClick={() => {
                        useRightPanelStore.getState().openFile(threadRef, path);
                        props.onClose();
                      }}
                    />
                  }
                >
                  <PanelRightIcon />
                </TooltipTrigger>
                <TooltipPopup>Open in Files</TooltipPopup>
              </Tooltip>
            ) : null}
            <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={props.onClose}>
              <XIcon />
            </Button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {parts ? (
            <div className="flex flex-col gap-3">
              {file.data?.truncated ? (
                <p className="text-muted-foreground text-xs">
                  It’s too long to show in full here. The rest is in the file.
                </p>
              ) : null}
              {parts.sections.map((section, index) =>
                section.body === "" && section.heading ? (
                  // A heading over the parts below it.
                  <h2
                    // oxlint-disable-next-line react/no-array-index-key -- a document's parts have no ids
                    key={index}
                    className={cn(
                      "font-semibold text-foreground",
                      index > 0 && "mt-3",
                      section.depth <= 2 ? "text-lg" : "text-base",
                    )}
                  >
                    {plainHeading(section.heading)}
                  </h2>
                ) : (
                  <SectionBlock
                    // oxlint-disable-next-line react/no-array-index-key -- a document's parts have no ids
                    key={index}
                    section={section}
                    markdown={markdown}
                    threadRef={threadRef}
                    workspaceRoot={workspaceRoot}
                    imageBaseDir={imageBaseDir}
                  />
                ),
              )}
              {parts.sections.length === 0 ? (
                <p className="text-muted-foreground text-sm">It’s empty.</p>
              ) : null}
            </div>
          ) : file.error ? (
            <p className="text-muted-foreground text-sm">
              Aldo couldn’t read {item.fileName} from the thread’s computer: {file.error}
            </p>
          ) : (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Spinner />
            </div>
          )}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
