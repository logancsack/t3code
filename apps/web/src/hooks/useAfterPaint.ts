import { startTransition, useEffect, useState } from "react";

/**
 * `value`, once the frame showing what changed it has painted: the render it
 * starts then can't hold up the click or key that changed it, which a
 * deferred value can (React starts that at once, and a quick one commits
 * before the frame). `initial` until then; `same` says when a new value is
 * the one shown already, so it's kept as it is.
 */
export function useAfterPaint<T, I = T>(
  value: T,
  initial: I,
  same: (a: T, b: T) => boolean = Object.is,
): T | I {
  const [shown, setShown] = useState<{ readonly value: T } | null>(null);
  const current = shown !== null && same(shown.value, value);
  useEffect(() => {
    if (current) return;
    const show = () => startTransition(() => setShown({ value }));
    // A hidden page paints no frames.
    if (document.visibilityState === "hidden") {
      show();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(show, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [current, value]);
  return shown === null ? initial : shown.value;
}
