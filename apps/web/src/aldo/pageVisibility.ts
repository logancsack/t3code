import { useEffect, useState } from "react";

function pageShowing(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Whether the page is showing, for live views to stop streaming while nobody
 * can see them: false once it has been hidden (another tab, a minimized
 * window, a locked phone) for `hideAfterMs`, true again as soon as it shows.
 */
export function useAldoPageVisible(hideAfterMs = 0): boolean {
  const [visible, setVisible] = useState(pageShowing);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pageShowing()) setVisible(true);
      else if (hideAfterMs > 0) timer = setTimeout(() => setVisible(false), hideAfterMs);
      else setVisible(false);
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      if (timer) clearTimeout(timer);
    };
  }, [hideAfterMs]);
  return visible;
}
