import type RFB from "@novnc/novnc";
import { LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { AldoApiError, aldoBrowserConnection, aldoOfflineMessage } from "./cloud";
import { aldoDesktopScreenUrl, type AldoDesktopScreen } from "./computer.logic";
import { aldoCanDecodeH264, AldoVideoPlayer } from "./liveVideo";
import { ALDO_FRAME_VIDEO, aldoDesktopVideoHello, aldoDesktopVideoUrls } from "./liveVideo.logic";
import { aldoLiveViewSize, parseAldoLiveFrame } from "./liveView.logic";
import { useAldoPageVisible } from "./pageVisibility";

type Status = "connecting" | "live" | "asleep" | "error";

/**
 * A desktop over VNC: by default the sandbox's own (Chrome, desktop apps, the
 * taskbar), where clicking or typing counts as the user using the machine and
 * makes agents wait (aldod sees the input and holds their desktop and browser
 * input); with `screen="windows"`, the user's Windows computer, while it runs.
 *
 * Where this browser decodes H.264 and the machine streams it, the sandbox's
 * screen comes as video (a fraction of VNC's bandwidth) under a VNC
 * connection that carries just the input: noVNC handles the mouse, keyboard
 * and touch as always, over a screen it never draws (the machine doesn't pass
 * its requests for one on), with a dot for the local pointer while the video
 * shows the screen's own. An older machine answers the video's URL with VNC,
 * and gets VNC alone.
 */
export function AldoDesktopView({
  environmentId,
  screen = "machine",
}: {
  environmentId: string;
  screen?: AldoDesktopScreen;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  // VNC streams whatever changes on the screen while connected: let go of it
  // once the page has been hidden for a while (a quick tab switch keeps it).
  const pageVisible = useAldoPageVisible(10_000);

  useEffect(() => {
    if (!pageVisible) return;
    let disposed = false;
    let rfb: RFB | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    // Video until the machine says it has none (an older one, or it can't now): VNC alone from then on.
    let vncOnly = screen !== "machine";
    setStatus("connecting");
    setError(null);

    const schedule = (delay: number) => {
      if (!disposed) retry = setTimeout(connect, delay);
    };

    const clearVideo = () => {
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    };

    /** Ends this connection's video and VNC; whichever ends first takes the other with it. */
    const hangUp = () => {
      const video = videoRef.current;
      videoRef.current = null;
      video?.close();
      rfb?.disconnect();
    };

    /** The screen as video: "video" once the machine says it streams it, "vnc" if it speaks VNC (an older one), else "failed". */
    const openVideo = (url: string) =>
      new Promise<"video" | "vnc" | "failed">((resolve) => {
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        let streaming = false;
        const timer = setTimeout(() => socket.close(), 15_000);
        const tell = (message: Record<string, unknown>) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
        };
        const player = new AldoVideoPlayer(
          (picture) => {
            const canvas = canvasRef.current;
            const context = canvas?.getContext("2d");
            if (!canvas || !context) return;
            if (canvas.width !== picture.displayWidth || canvas.height !== picture.displayHeight) {
              canvas.width = picture.displayWidth;
              canvas.height = picture.displayHeight;
            }
            context.drawImage(picture, 0, 0);
          },
          () => tell({ type: "videoAck" }),
          () => tell({ type: "keyframe" }),
        );
        socket.onmessage = (event) => {
          if (!streaming) {
            clearTimeout(timer);
            const hello = aldoDesktopVideoHello(event.data);
            streaming = hello === "video";
            if (!streaming) socket.close();
            resolve(hello === "unknown" ? "failed" : hello);
            return;
          }
          if (typeof event.data === "string") {
            try {
              const message = JSON.parse(event.data) as { type?: unknown };
              if (message.type === "video") player.configure(message);
            } catch {
              // Not for this view.
            }
            return;
          }
          const frame = event.data instanceof ArrayBuffer ? parseAldoLiveFrame(event.data) : null;
          if (frame?.kind === ALDO_FRAME_VIDEO) player.decode(frame);
        };
        socket.onclose = (event) => {
          clearTimeout(timer);
          player.close();
          if (!streaming) return resolve("failed");
          // The machine gave up on video for this screen: VNC from here on.
          if (event.reason.startsWith("No video")) vncOnly = true;
          if (videoRef.current === socket) hangUp();
        };
        videoRef.current = socket;
      });

    const connect = async () => {
      const container = containerRef.current;
      if (disposed || !container) return;
      let client: RFB;
      let video = false;
      try {
        const { desktopUrl } = await aldoBrowserConnection(environmentId);
        let vncUrl = aldoDesktopScreenUrl(desktopUrl, screen);
        if (!vncOnly && (await aldoCanDecodeH264())) {
          const root = rootRef.current;
          const urls = aldoDesktopVideoUrls(
            desktopUrl,
            aldoLiveViewSize(
              root?.clientWidth ?? 0,
              root?.clientHeight ?? 0,
              window.devicePixelRatio,
            ),
          );
          const answer = await openVideo(urls.video);
          if (disposed) return hangUp();
          if (answer === "failed") throw new Error("The desktop's video didn't start");
          video = answer === "video";
          if (video) vncUrl = urls.input;
          else vncOnly = true;
        }
        // noVNC touches the DOM as soon as it loads, so it's loaded only when a desktop is shown.
        const { default: VncClient } = await import("@novnc/novnc");
        if (disposed) return hangUp();
        // noVNC leaves its screen in the container when it disconnects: start from an empty one.
        container.replaceChildren();
        if (!video) clearVideo();
        client = new VncClient(container, vncUrl, { shared: true });
      } catch (cause) {
        hangUp();
        if (cause instanceof AldoApiError && cause.status === 409) {
          setStatus("asleep");
          schedule(3000);
        } else {
          // Includes noVNC failing to download (a deploy in progress, a network blip).
          setStatus("error");
          setError(cause instanceof Error ? cause.message : String(cause));
          schedule(Math.min(15_000, 1000 * 2 ** attempt++));
        }
        return;
      }
      rfb = client;
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.focusOnClick = true;
      rfb.background = "transparent";
      // Under video, noVNC never gets the screen's cursor: a dot shows where the pointer is.
      rfb.showDotCursor = video;
      rfb.addEventListener("connect", () => {
        attempt = 0;
        setStatus("live");
        setError(null);
      });
      rfb.addEventListener("disconnect", () => {
        rfb = null;
        hangUp();
        if (disposed) return;
        setStatus("connecting");
        schedule(Math.min(15_000, 1000 * 2 ** attempt++));
      });
      // The video ended while noVNC loaded: start over.
      if (video && videoRef.current?.readyState !== WebSocket.OPEN) hangUp();
    };

    void connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      hangUp();
    };
  }, [environmentId, screen, pageVisible]);

  // The video at the view's size, once a resize settles.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const socket = videoRef.current;
        if (socket?.readyState !== WebSocket.OPEN) return;
        const size = aldoLiveViewSize(root.clientWidth, root.clientHeight, window.devicePixelRatio);
        socket.send(JSON.stringify({ type: "viewport", ...size }));
      }, 150);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const what = screen === "windows" ? "your Windows computer" : "the desktop";
  return (
    <div ref={rootRef} className="relative min-h-0 flex-1 overflow-hidden bg-muted/30">
      {/* The video, under noVNC's screen (which stays empty over it). */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 size-full object-contain",
          status !== "live" && "opacity-40",
        )}
      />
      <div
        ref={containerRef}
        className={cn("relative size-full", status !== "live" && "opacity-40")}
      />
      {status !== "live" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {status === "asleep" ? (
            aldoOfflineMessage(environmentId)
          ) : status === "error" ? (
            <span className="max-w-sm">
              Couldn't reach {what}
              {error ? `: ${error}` : ""}. Retrying…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <LoaderIcon className="size-4 animate-spin" /> Connecting to {what}…
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

const SCREENS: ReadonlyArray<readonly [AldoDesktopScreen, string]> = [
  ["machine", "This machine"],
  ["windows", "Windows"],
];

/**
 * Which desktop the Desktop view shows, and a way to stop the Windows
 * computer, offered while it runs.
 */
export function AldoDesktopScreenSwitch(props: {
  screen: AldoDesktopScreen;
  onChange: (screen: AldoDesktopScreen) => void;
  /** Aldo is stopping the computer: Stop waits for it. */
  stopping: boolean;
  onStop: () => void;
}) {
  return (
    <>
      <div
        className="flex shrink-0 items-center rounded-md bg-muted/60 p-0.5"
        role="radiogroup"
        aria-label="Screen"
      >
        {SCREENS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={props.screen === value}
            onClick={() => props.onChange(value)}
            className={cn(
              "inline-flex h-6 items-center rounded px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
              props.screen === value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label="Stop your Windows computer"
        title="Stop your Windows computer: it stops using credits, and its disk stays as it is."
        disabled={props.stopping}
        onClick={props.onStop}
      >
        {props.stopping ? "Stopping…" : "Stop"}
      </Button>
    </>
  );
}
