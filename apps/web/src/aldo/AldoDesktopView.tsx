import type RFB from "@novnc/novnc";
import { LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { AldoApiError, aldoBrowserConnection, aldoOfflineMessage } from "./cloud";
import { aldoDesktopScreenUrl, type AldoDesktopScreen } from "./computer.logic";
import { useAldoPageVisible } from "./pageVisibility";

type Status = "connecting" | "live" | "asleep" | "error";

/**
 * A desktop over VNC: by default the sandbox's own (Chrome, desktop apps, the
 * taskbar), where clicking or typing counts as the user using the machine and
 * makes agents wait (aldod sees the input and holds their desktop and browser
 * input); with `screen="windows"`, the user's Windows computer, while it runs.
 */
export function AldoDesktopView({
  environmentId,
  screen = "machine",
}: {
  environmentId: string;
  screen?: AldoDesktopScreen;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
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
    setStatus("connecting");
    setError(null);

    const schedule = (delay: number) => {
      if (!disposed) retry = setTimeout(connect, delay);
    };

    const connect = async () => {
      const container = containerRef.current;
      if (disposed || !container) return;
      let client: RFB;
      try {
        const { desktopUrl } = await aldoBrowserConnection(environmentId);
        // noVNC touches the DOM as soon as it loads, so it's loaded only when a desktop is shown.
        const { default: VncClient } = await import("@novnc/novnc");
        if (disposed) return;
        // noVNC leaves its screen in the container when it disconnects: start from an empty one.
        container.replaceChildren();
        client = new VncClient(container, aldoDesktopScreenUrl(desktopUrl, screen), {
          shared: true,
        });
      } catch (cause) {
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
      rfb.addEventListener("connect", () => {
        attempt = 0;
        setStatus("live");
        setError(null);
      });
      rfb.addEventListener("disconnect", () => {
        rfb = null;
        if (disposed) return;
        setStatus("connecting");
        schedule(Math.min(15_000, 1000 * 2 ** attempt++));
      });
    };

    void connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      rfb?.disconnect();
    };
  }, [environmentId, screen, pageVisible]);

  const what = screen === "windows" ? "your Windows computer" : "the desktop";
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/30">
      <div
        ref={containerRef}
        className={status === "live" ? "size-full" : "size-full opacity-40"}
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
