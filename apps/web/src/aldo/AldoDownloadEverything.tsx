// "Download everything" under a conversation's results (AldoMadeCards): one
// zip of the files the turn made, made on its computer when the user asks,
// with its size once the computer has said (download.logic.ts). A computer
// asleep is woken only once the user says so. An Aldo that can't make zips
// (its directory doesn't say `downloads`) shows nothing.

import type { ScopedThreadRef } from "@t3tools/contracts";
import { DownloadIcon } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { useThreadShell } from "../state/entities";
import { AldoApiError, isAldoEnvironmentId } from "./api";
import {
  aldoMachineIsAsleep,
  aldoZipsResults,
  subscribeAldoEnvironments,
  wakeAldoEnvironment,
} from "./directory";
import {
  aldoOffersZip,
  aldoZipKey,
  aldoZipLabel,
  aldoZipLeftLines,
  aldoZipMadeText,
  type AldoZip,
  type AldoZipFile,
} from "./download.logic";
import { zipAldoFiles } from "./workspaceApi";

// ---------------------------------------------------------------------------
// What each zip would come to, as its computer said

type KnownSize = { readonly bytes: number; readonly files: number; readonly at: number };

/** A size is shown this long; the files may change in a later turn. */
const SIZE_MS = 5 * 60_000;
/** A check that failed is tried again after this long. */
const RETRY_MS = 60_000;

const sizes = new Map<string, KnownSize>();
const askedAt = new Map<string, number>();
const sizeListeners = new Set<() => void>();
let checking: Promise<void> = Promise.resolve();

function knownSize(key: string): KnownSize | null {
  const size = sizes.get(key);
  return size && Date.now() - size.at < SIZE_MS ? size : null;
}

function noteSize(key: string, bytes: number, files: number): void {
  sizes.set(key, { bytes, files, at: Date.now() });
  for (const listener of sizeListeners) listener();
}

/** Asks the computer what the zip would come to, one block at a time, so a long conversation doesn't ask all at once. */
function askSize(environmentId: string, files: ReadonlyArray<AldoZipFile>): void {
  const key = aldoZipKey(environmentId, files);
  const asked = askedAt.get(key);
  if (knownSize(key) || (asked !== undefined && Date.now() - asked < RETRY_MS)) return;
  askedAt.set(key, Date.now());
  checking = checking.then(() =>
    zipAldoFiles(environmentId, files, { check: true }).then(
      (zip) => noteSize(key, zip.bytes, zip.files),
      // No size, then: the action says none.
      () => {},
    ),
  );
}

function subscribeSizes(listener: () => void): () => void {
  sizeListeners.add(listener);
  return () => sizeListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// The action

type Phase =
  | { readonly tag: "idle" }
  | { readonly tag: "asleep"; readonly message: string }
  | { readonly tag: "waking" }
  | { readonly tag: "making" }
  | { readonly tag: "made"; readonly zip: AldoZip }
  | {
      readonly tag: "failed";
      readonly message: string;
      /** Whether trying again can help: not past a limit, or with nothing to zip. */
      readonly retry: boolean;
      readonly zip?: AldoZip;
    };

const ASLEEP = "Its computer is asleep. Making the zip wakes it, which takes about 20 seconds.";

/** Starts the zip's download in this tab: the computer sends it as a file, so the page stays. */
function startDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

export function AldoDownloadEverything(props: {
  readonly threadRef: ScopedThreadRef;
  readonly files: ReadonlyArray<AldoZipFile>;
  /** The results that are only a link, with no file on the computer. */
  readonly links: ReadonlyArray<string>;
}) {
  const { threadRef, files, links } = props;
  const environmentId = threadRef.environmentId;
  const offered = useSyncExternalStore(subscribeAldoEnvironments, aldoZipsResults);
  const asleep = useSyncExternalStore(subscribeAldoEnvironments, () =>
    aldoMachineIsAsleep(environmentId),
  );
  const title = useThreadShell(threadRef)?.title;
  const key = aldoZipKey(environmentId, files);
  const size = useSyncExternalStore(subscribeSizes, () => knownSize(key));
  const [phase, setPhase] = useState<Phase>({ tag: "idle" });
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const shown =
    offered && isAldoEnvironmentId(environmentId) && aldoOffersZip(files) && size?.files !== 0;

  // Its size, asked once the row is on screen, and never of a computer asleep.
  const observeRow = useCallback((element: HTMLDivElement | null) => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (shown && visible && !asleep) askSize(environmentId, files);
  }, [shown, visible, asleep, environmentId, files]);

  // A made zip's link works until it expires; then the action makes a new one.
  const expiresAt = phase.tag === "made" ? phase.zip.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const left = Date.parse(expiresAt) - Date.now() - 15_000;
    const timer = setTimeout(() => setPhase({ tag: "idle" }), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  if (!shown) return null;

  const make = async () => {
    setPhase({ tag: "making" });
    try {
      const zip = await zipAldoFiles(environmentId, files, { check: false, name: title });
      if (!zip.url) {
        setPhase({ tag: "failed", message: "Nothing could go in the zip.", retry: false, zip });
        return;
      }
      noteSize(key, zip.bytes, zip.files);
      setPhase({ tag: "made", zip });
      startDownload(zip.url);
    } catch (error) {
      const body = error instanceof AldoApiError ? (error.body as { asleep?: unknown }) : null;
      if (body?.asleep === true) {
        setPhase({ tag: "asleep", message: error instanceof Error ? error.message : ASLEEP });
        return;
      }
      setPhase(
        error instanceof AldoApiError
          ? { tag: "failed", message: error.message, retry: error.status >= 500 }
          : {
              tag: "failed",
              message: "Aldo couldn’t reach its computer to make the zip. Try again.",
              retry: true,
            },
      );
    }
  };

  const wakeAndMake = async () => {
    setPhase({ tag: "waking" });
    try {
      await wakeAldoEnvironment(environmentId);
    } catch {
      setPhase({
        tag: "failed",
        message: "Its computer didn’t wake. Try again in a minute.",
        retry: true,
      });
      return;
    }
    await make();
  };

  const start = () => {
    if (aldoMachineIsAsleep(environmentId)) setPhase({ tag: "asleep", message: ASLEEP });
    else void make();
  };

  const busy = phase.tag === "making" || phase.tag === "waking";
  const answered = phase.tag === "made" || phase.tag === "failed" ? phase.zip : undefined;
  const notes = answered ? aldoZipLeftLines(answered.left, links) : [];

  return (
    <div
      ref={visible ? undefined : observeRow}
      className="flex flex-col gap-1.5 text-muted-foreground text-xs"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {phase.tag === "made" && phase.zip.url ? (
          <a
            href={phase.zip.url}
            rel="noopener noreferrer"
            className="inline-flex min-h-6 items-center gap-1.5 hover:text-foreground"
          >
            <DownloadIcon aria-hidden className="size-3.5" />
            Download it again
          </a>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-6 items-center gap-1.5 hover:text-foreground disabled:pointer-events-none"
            disabled={busy}
            onClick={start}
          >
            {busy ? (
              <Spinner size="xs" aria-hidden />
            ) : (
              <DownloadIcon aria-hidden className="size-3.5" />
            )}
            {phase.tag === "making"
              ? "Making the zip…"
              : phase.tag === "waking"
                ? "Waking its computer…"
                : aldoZipLabel(size?.bytes ?? null)}
          </button>
        )}
        <span role="status" className="min-w-0">
          {phase.tag === "made" ? aldoZipMadeText(phase.zip) : null}
        </span>
      </div>
      {phase.tag === "asleep" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>{phase.message}</span>
          <Button size="xs" variant="outline" onClick={() => void wakeAndMake()}>
            Wake it and make the zip
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setPhase({ tag: "idle" })}>
            Not now
          </Button>
        </div>
      ) : null}
      {phase.tag === "failed" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <span className="text-destructive-foreground">{phase.message}</span>
          {phase.retry ? (
            <Button size="xs" variant="ghost" onClick={start}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
