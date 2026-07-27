"use client";

import { ExternalLink, RotateCw } from "lucide-react";
import { useCallback, useState } from "react";

import { managedWorkspaceBrowserUrl } from "~/managedDevPc";

import { Button } from "./ui/button";

/**
 * The shared workspace browser, embedded as an ordinary web page.
 *
 * This deliberately does not go through the preview subsystem. Previews render
 * through the Electron desktop bridge, so on a managed workspace — which is
 * always reached from a browser, on desktop or on a phone — a preview surface
 * only ever shows "Preview is only available in the T3 Code desktop app".
 *
 * noVNC is itself a web app, so an iframe is all it needs, and it brings its own
 * touch handling: drag to move the pointer, tap to click, two-finger scroll. The
 * grant URL already carries `resize=remote`, so the remote display follows the
 * size of this frame and a phone gets a phone-shaped screen rather than a
 * scaled-down desktop.
 */
export function WorkspaceBrowserPanel() {
  const url = managedWorkspaceBrowserUrl();
  // Remounting the frame is the only way to force a reconnect from here: the
  // noVNC session lives inside the iframe's own document.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  if (!url) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          This workspace does not provide a shared browser.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <span className="truncate text-xs text-muted-foreground">Shared workspace browser</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reconnect the workspace browser"
            onClick={reload}
          >
            <RotateCw className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Open the workspace browser in a new tab"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>
      <iframe
        key={reloadKey}
        src={url}
        title="Shared workspace browser"
        // `touch-none` stops the panel scrolling under a drag that is meant for
        // the remote screen, which otherwise makes the browser unusable by touch.
        className="min-h-0 w-full flex-1 touch-none border-0 bg-black"
        // noVNC needs scripts, and `allow-same-origin` for the WebSocket it opens
        // back to its own host and the viewer settings it keeps in local storage.
        //
        // The linter flags this pair because same-origin framed content can lift
        // its own sandbox. Here the frame is served from the preview origin, a
        // different host from the app, so it keeps its own origin and cannot reach
        // this document — and the restrictions that still bite are the ones worth
        // having: no top-level navigation, no popups, no downloads, no forms.
        // eslint-disable-next-line react/iframe-missing-sandbox -- see above
        sandbox="allow-scripts allow-same-origin"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
}
