// Where a thread card's live view gets its frames (AldoLiveView.tsx): stills
// aldod takes of the machine's browser page or the Windows computer's screen
// (with the browser panel's signed link), and the GPU computer's newest frame
// from Aldo, with how far its render is (useAldoGpuRender, for the card's
// line). The card shows a view only while Aldo's read says what it shows is
// running, and a machine asleep gives no link, so watching never wakes one.
// An Aldo without stills gives no frames, and the view stays as it was.

import { useSyncExternalStore } from "react";

import { api, threadIdForEnvironment } from "./api";
import type { AldoHomeTarget } from "./homeApi";
import type { AldoLiveRender, AldoLiveSurface } from "./liveWork.logic";
import { aldoBrowserConnection } from "./workspaceApi";

/** A frame, ready to show, and when it was taken. */
export interface AldoLiveFrame {
  readonly url: string;
  readonly at: number;
}

/** A view's frames: one about every `everyMs`, about `width` device pixels wide, until it's stopped. */
export interface AldoLiveFrames {
  readonly watch: (
    options: { readonly width: number; readonly everyMs: number },
    onFrame: (frame: AldoLiveFrame) => void,
  ) => () => void;
}

/** The GPU computer's render is read this often, whatever the view's pace: a frame takes seconds at least. */
export const GPU_EVERY_MS = 5_000;
/** A machine's still link is kept this long (it's signed for 12 hours); one asleep is asked again sooner. */
const LINK_MS = 30 * 60_000;
const ASLEEP_MS = 30_000;

const links = new Map<string, { at: number; link: Promise<string | null> }>();

/** The machine's still link, or null while it's asleep or its Aldo takes none. */
function stillLink(environmentId: string): Promise<string | null> {
  const kept = links.get(environmentId);
  if (kept && Date.now() - kept.at < LINK_MS) return kept.link;
  const entry = {
    at: Date.now(),
    link: aldoBrowserConnection(environmentId).then(
      (connection) => connection.stillUrl ?? null,
      () => null,
    ),
  };
  links.set(environmentId, entry);
  void entry.link.then((link) => {
    if (link === null) entry.at = Date.now() - LINK_MS + ASLEEP_MS;
  });
  return entry.link;
}

/** Loads and decodes an image, so a frame never shows half drawn. */
async function decoded(url: string): Promise<string> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return url;
}

/** Runs `take` now and again `everyMs` after each one ends, until stopped. */
function polled(everyMs: number, take: () => Promise<void>): () => void {
  let stopped = false;
  let timer = 0;
  const tick = () =>
    void take()
      .catch(() => undefined)
      .finally(() => {
        if (!stopped) timer = window.setTimeout(tick, everyMs);
      });
  tick();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

const renders = new Map<string, AldoLiveRender>();
/** Views reading each thread's render now: its read is forgotten a while after the last stops. */
const reading = new Map<string, number>();
const renderListeners = new Set<() => void>();
const keyOf = (target: AldoHomeTarget) => `${target.environmentId}\n${target.threadId}`;

function setRender(key: string, render: AldoLiveRender | null): void {
  if (render) renders.set(key, render);
  else renders.delete(key);
  for (const listener of renderListeners) listener();
}

function subscribeRenders(listener: () => void): () => void {
  renderListeners.add(listener);
  return () => renderListeners.delete(listener);
}

/** The render under way on the thread's GPU computer, while a view of it reads it; null otherwise. */
export function useAldoGpuRender(target: AldoHomeTarget): AldoLiveRender | null {
  return useSyncExternalStore(subscribeRenders, () => renders.get(keyOf(target)) ?? null);
}

type GpuRead = AldoLiveRender & { readonly image: string | null };

function gpuFrames(target: AldoHomeTarget): AldoLiveFrames {
  const key = keyOf(target);
  return {
    watch: (_options, onFrame) => {
      reading.set(key, (reading.get(key) ?? 0) + 1);
      const stop = polled(GPU_EVERY_MS, async () => {
        let read: GpuRead | null = null;
        try {
          ({ render: read } = await api<{ render: GpuRead | null }>(
            `/api/environments/${threadIdForEnvironment(target.environmentId)}/gpu`,
          ));
        } finally {
          setRender(key, read && { frame: read.frame, frames: read.frames, leftMs: read.leftMs });
        }
        if (read?.image) onFrame({ url: await decoded(read.image), at: Date.now() });
      });
      return () => {
        stop();
        const left = (reading.get(key) ?? 1) - 1;
        if (left > 0) return void reading.set(key, left);
        reading.delete(key);
        // Not at once: a view opened in its place reads it again first.
        window.setTimeout(() => {
          if (!reading.has(key)) setRender(key, null);
        }, GPU_EVERY_MS);
      };
    },
  };
}

function stillFrames(surface: "browser" | "windows", target: AldoHomeTarget): AldoLiveFrames {
  return {
    watch: ({ width, everyMs }, onFrame) =>
      polled(everyMs, async () => {
        const link = await stillLink(target.environmentId);
        if (!link) return;
        const at = Date.now();
        onFrame({ url: await decoded(`${link}&surface=${surface}&w=${width}&at=${at}`), at });
      }),
  };
}

/** Where a view of `surface` for the thread gets its frames. */
export function aldoLiveFrames(surface: AldoLiveSurface, target: AldoHomeTarget): AldoLiveFrames {
  return surface === "gpu" ? gpuFrames(target) : stillFrames(surface, target);
}
