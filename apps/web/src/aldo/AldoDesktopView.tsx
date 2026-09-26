import RFB from "@novnc/novnc";
import { LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AldoApiError, aldoBrowserConnection } from "./cloud";

type Status = "connecting" | "live" | "asleep" | "error";

/**
 * The sandbox's whole desktop (Chrome, desktop apps, the taskbar), over VNC.
 * Clicking or typing in it counts as the user using the machine, which makes
 * agents wait (aldod sees the input and holds their desktop and browser input).
 */
export function AldoDesktopView({ environmentId }: { environmentId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let rfb: RFB | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const schedule = (delay: number) => {
      if (!disposed) retry = setTimeout(connect, delay);
    };

    const connect = async () => {
      const container = containerRef.current;
      if (disposed || !container) return;
      let url: string;
      try {
        url = (await aldoBrowserConnection(environmentId)).desktopUrl;
      } catch (cause) {
        if (cause instanceof AldoApiError && cause.status === 409) {
          setStatus("asleep");
          schedule(3000);
        } else {
          setStatus("error");
          setError(cause instanceof Error ? cause.message : String(cause));
          schedule(Math.min(15_000, 1000 * 2 ** attempt++));
        }
        return;
      }
      if (disposed) return;
      rfb = new RFB(container, url, { shared: true });
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
  }, [environmentId]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/30">
      <div
        ref={containerRef}
        className={status === "live" ? "size-full" : "size-full opacity-40"}
      />
      {status !== "live" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {status === "asleep" ? (
            "This thread is asleep. It wakes when you open it."
          ) : status === "error" ? (
            <span className="max-w-sm">
              Couldn't reach the desktop{error ? `: ${error}` : ""}. Retrying…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <LoaderIcon className="size-4 animate-spin" /> Connecting to the desktop…
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
