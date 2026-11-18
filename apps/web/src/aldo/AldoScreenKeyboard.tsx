import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

/** A real local input opens the phone keyboard; a streamed screen cannot. */
export function AldoScreenKeyboard({
  onText,
  onKey,
}: {
  onText: (text: string) => void;
  onKey: (key: "Enter" | "Backspace" | "Tab") => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const clear = () => {
      if (input.current) input.current.value = "";
    };
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = footer.current;
    if (!open || !viewport || !element) return;
    const resize = () => {
      const inset =
        viewport.scale === 1
          ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
          : 0;
      element.style.paddingBottom = `max(0.5rem, calc(env(safe-area-inset-bottom) + ${inset}px))`;
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      element.style.paddingBottom = "";
    };
  }, [open]);
  const type = () => {
    const field = input.current;
    if (!field) return;
    onText(field.value);
    field.value = "";
    field.focus();
  };
  return (
    <div ref={footer} className="shrink-0 border-t bg-background p-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide keyboard" : "Keyboard"}
      </Button>
      {open ? (
        <form
          id={id}
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            type();
          }}
        >
          <label htmlFor={`${id}-text`} className="w-full text-sm text-muted-foreground">
            Select a field on the screen, then type here.
          </label>
          <Input
            ref={input}
            id={`${id}-text`}
            nativeInput
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 min-w-32 flex-1 [&_input]:min-h-11 [&_input]:text-base"
          />
          <Button type="submit" variant="outline" className="min-h-11">
            Type
          </Button>
          {(["Enter", "Tab", "Backspace"] as const).map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => {
                type();
                onKey(key);
              }}
            >
              {key}
            </Button>
          ))}
        </form>
      ) : null}
    </div>
  );
}
