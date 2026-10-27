// Home's pending list doesn't depend on which cards are visible or loaded.
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { LoaderCircleIcon, XIcon } from "lucide-react";
import { useRef, useState, type RefObject } from "react";

import { DialogPopup, DialogTitle } from "../components/ui/dialog";
import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import { refreshAldoHome } from "./homeFeed";
import { needsYouWords, type NeedsYouItem } from "./needsYou.logic";
import { revealAldoCard, showAldoDecisionKey } from "./show";
import { FOCUS } from "./surface";
import { COMPOSER_ACTION } from "./HomeComposerActions";

export function NeedsYouPill(props: {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly items: ReadonlyArray<NeedsYouItem>;
  readonly className?: string;
}) {
  const { scroller, items } = props;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = useRef<NeedsYouItem | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const jumping = useRef(false);
  // Another device, a countdown, or an inline answer can settle the list while it is open.
  if (open && items.length < 2) setOpen(false);

  const jump = async (item: NeedsYouItem) => {
    if (jumping.current) return;
    jumping.current = true;
    setBusy(true);
    try {
      // The pending read places cards independently of message history. Unfold a grouped one.
      if (showAldoDecisionKey(item.key)) return;
      const find = () => scroller.current?.querySelector<HTMLElement>(item.selector);
      // Give an unfolding card a render before looking for it.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      let card = find();
      if (!card) {
        await refreshAldoHome();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        card = find();
      }
      if (card) revealAldoCard(card);
      else
        toastManager.add({
          type: "info",
          title: "That request is no longer in this conversation",
          description: "Check Needs you for anything still waiting.",
        });
    } catch {
      toastManager.add({
        type: "error",
        title: "Couldn't find that request",
        description: "Try again in a moment.",
      });
    } finally {
      jumping.current = false;
      setBusy(false);
    }
  };
  const words = needsYouWords(items.length);
  if (!words) return null;
  return (
    <SheetPrimitive.Root
      open={open && items.length > 1}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        // Wait until the modal has released focus and scrolling before revealing the card.
        if (isOpen || !selected.current) return;
        const item = selected.current;
        selected.current = null;
        void jump(item);
      }}
    >
      <button
        ref={trigger}
        type="button"
        data-aldo-needs-you=""
        aria-haspopup={items.length > 1 ? "dialog" : undefined}
        aria-expanded={items.length > 1 ? open : undefined}
        aria-busy={busy}
        className={cn(COMPOSER_ACTION, props.className)}
        onClick={() => {
          if (items.length === 1) void jump(items[0]!);
          else setOpen(true);
        }}
      >
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
          {busy ? (
            <LoaderCircleIcon
              aria-hidden
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
          )}
        </span>
        <span className="min-w-0 wrap-anywhere">{words}</span>
      </button>
      <DialogPopup
        showCloseButton={false}
        finalFocus={trigger}
        className="max-h-[min(75dvh,36rem)] overflow-hidden bg-popover pb-[env(safe-area-inset-bottom)] max-sm:rounded-t-2xl motion-reduce:transition-none"
      >
        <header
          className="shrink-0 touch-pan-x px-4 pt-2 pb-3 sm:pt-4"
          onTouchStart={(event) => {
            const touch = event.touches[0];
            gesture.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const start = gesture.current;
            gesture.current = null;
            const end = event.changedTouches[0];
            if (
              start &&
              end &&
              end.clientY - start.y > 64 &&
              end.clientY - start.y > Math.abs(end.clientX - start.x) * 1.5
            )
              setOpen(false);
          }}
          onTouchCancel={() => {
            gesture.current = null;
          }}
        >
          <div
            aria-hidden
            className="mx-auto mb-2 h-1 w-9 rounded-full bg-muted-foreground/30 sm:hidden"
          />
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base font-semibold">
              Needs you{" "}
              <span className="ms-1 font-normal text-muted-foreground">{items.length}</span>
            </DialogTitle>
            <SheetPrimitive.Close
              aria-label="Close needs you"
              className={cn(
                FOCUS,
                "flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted",
              )}
            >
              <XIcon aria-hidden className="size-5" />
            </SheetPrimitive.Close>
          </div>
        </header>
        <ul className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-2">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className={cn(
                  FOCUS,
                  "flex min-h-16 w-full min-w-0 flex-col gap-1 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted active:bg-muted",
                )}
                onClick={() => {
                  selected.current = item;
                  setOpen(false);
                }}
              >
                <span className="line-clamp-2 w-full break-words [overflow-wrap:anywhere] text-sm font-medium">
                  {item.title}
                </span>
                <span className="flex w-full min-w-0 flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{item.kind}</span>
                  <time dateTime={item.at} aria-label={new Date(item.at).toLocaleString()}>
                    {new Date(item.at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogPopup>
    </SheetPrimitive.Root>
  );
}
