import { autoAnimate, getTransitionSizes, type AutoAnimationPlugin } from "@formkit/auto-animate";
import { useEffect, useRef, type ReactNode } from "react";

import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "~/lib/utils";

/** Both Home actions share one surface; each label can wrap without losing its count. */
export const COMPOSER_ACTION =
  "relative flex min-h-12 min-w-0 flex-auto items-center justify-center gap-2 rounded-3xl px-3 py-2 text-center font-medium text-[14px] leading-5 text-popover-foreground outline-none transition-colors duration-100 hover:bg-foreground/[0.05] active:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none";

// AutoAnimate owns interrupted layout changes and removed nodes. Use the same
// short ease-out for entry, exit and recentering, without its default scale.
const actionMotion: AutoAnimationPlugin = (element, action, before, after) => {
  let frames: Keyframe[] =
    action === "remove" ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }];
  if (action === "remain" && before && after) {
    frames = [
      {
        transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)`,
      },
      { transform: "translate(0, 0)" },
    ];
    // Resize only the absolute surface. Animating the flex box's width would
    // squeeze its labels into extra lines while a second action arrives.
    if (element.hasAttribute("data-aldo-action-surface")) {
      const [widthFrom, widthTo, heightFrom, heightTo] = getTransitionSizes(element, before, after);
      Object.assign(frames[0]!, { width: `${widthFrom}px`, height: `${heightFrom}px` });
      Object.assign(frames[1]!, { width: `${widthTo}px`, height: `${heightTo}px` });
    }
  }
  if (action === "remove") {
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("inert", "");
  }
  return new KeyframeEffect(element, frames, {
    duration: 160,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  });
};

export function HomeComposerActions(props: {
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  const group = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  useEffect(() => {
    const element = group.current;
    if (!element || reduced) return;
    const animation = autoAnimate(element, actionMotion);
    return () => {
      animation.destroy?.();
      // A motion preference change must also retire any fading, removed button.
      element.querySelectorAll(":scope > [inert]").forEach((button) => button.remove());
    };
  }, [reduced]);
  return (
    <div
      data-aldo-composer-actions=""
      className={cn(
        "grid w-full min-w-0 transition-[grid-template-rows,opacity] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
        props.active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      inert={!props.active}
      aria-hidden={!props.active}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex min-w-0 justify-center px-1 pt-1 pb-1">
          <div
            ref={group}
            role="group"
            aria-label="Conversation actions"
            className="relative inline-flex min-w-0 max-w-full items-stretch rounded-3xl"
          >
            <span
              aria-hidden
              data-aldo-action-surface=""
              className="pointer-events-none absolute inset-0 rounded-3xl border border-foreground/[0.10] shadow-sm [background-color:var(--app-theme-surface-overlay,var(--popover))]"
            />
            {props.children}
          </div>
        </div>
      </div>
    </div>
  );
}
