import { useImperativeHandle, useRef, type Ref } from "react";

import { cn } from "../lib/utils";
import { ALDO_TYPING_PAD, aldoTyped, type AldoKeyboard } from "./livePage.logic";

/** iOS and iPadOS: their keyboard opens only from a tap, and follows a field's inputmode as it changes. */
export const aldoApplePhone =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** A key as the machine takes it (the page sees keydown and keyup). */
export interface AldoKey {
  event: "down" | "up";
  key: string;
  code: string;
  keyCode: number;
  text: string;
  modifiers: number;
}

/** Where what's typed goes: the shared browser, or a desktop over VNC. */
export interface AldoKeyOutput {
  key: (key: AldoKey) => void;
  /** Typed, a character at a time. */
  type: (text: string) => void;
  /** Pasted or composed: all at once. */
  insert: (text: string) => void;
  backspace: (count: number) => void;
}

export interface AldoKeyInputHandle {
  /** Takes the keys, with the phone keyboard `keyboard` asks for (none for inputmode "none"). Called in a tap, it can open the keyboard. */
  focus: (keyboard: AldoKeyboard) => void;
  blur: () => void;
  focused: () => boolean;
}

export function aldoModifiers(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  let bits = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
  // The remote Chrome runs on Linux: ⌘ shortcuts become Ctrl ones there.
  if (isMac && e.metaKey) bits = (bits & ~4) | 2;
  return bits;
}

// With a phone's keyboard, keys that don't change the text go as keys; the
// rest is read from what the keyboard did to the field.
const PHONE_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Delete",
]);

function keyboardOf(input: HTMLInputElement): AldoKeyboard {
  return {
    type: input.type === "password" ? "password" : "text",
    inputMode: (input.inputMode || "text") as AldoKeyboard["inputMode"],
    autoComplete: input.autocomplete,
    enterKeyHint: input.enterKeyHint,
  };
}

function setKeyboard(input: HTMLInputElement, keyboard: AldoKeyboard) {
  input.type = keyboard.type;
  // A text keyboard by taking "none" away, as WebKit's own test of it does.
  if (keyboard.inputMode === "text") input.removeAttribute("inputmode");
  else input.inputMode = keyboard.inputMode;
  input.setAttribute("autocomplete", keyboard.autoComplete);
  input.enterKeyHint = keyboard.enterKeyHint;
}

const sameKeyboard = (a: AldoKeyboard, b: AldoKeyboard) =>
  a.type === b.type &&
  a.inputMode === b.inputMode &&
  a.autoComplete === b.autoComplete &&
  a.enterKeyHint === b.enterKeyHint;

/**
 * The field every key goes through, out of sight. With a mouse, keys go as
 * they're pressed, and composed text (an IME, dictation) once it's done. With
 * a phone's keyboard, which says little about its keys, what it does to the
 * field (ALDO_TYPING_PAD) is turned into keys: a word as it's typed, its
 * corrections, Backspace. Its text is 16px, so iOS doesn't zoom to it.
 */
export function AldoKeyInput(props: {
  ref?: Ref<AldoKeyInputHandle>;
  /** A phone's keyboard: what it does to the field becomes keys. */
  touch: boolean;
  output: AldoKeyOutput;
  label: string;
  onUse?: (() => void) | undefined;
  onFocusChange?: ((focused: boolean) => void) | undefined;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const last = useRef("");
  const forwarded = useRef(new Set<string>());
  const { output, touch } = props;

  const reset = () => {
    const input = inputRef.current;
    if (!input) return;
    const value = touch ? ALDO_TYPING_PAD : "";
    input.value = value;
    last.current = value;
    try {
      input.setSelectionRange(value.length, value.length);
    } catch {
      // Not every type has a caret to place.
    }
  };

  useImperativeHandle(props.ref, () => ({
    focus: (keyboard) => {
      const input = inputRef.current;
      if (!input) return;
      const focused = document.activeElement === input;
      if (focused && sameKeyboard(keyboardOf(input), keyboard)) return;
      setKeyboard(input, keyboard);
      // iOS reloads its keyboard for the new mode; elsewhere it's the next focus that shows it.
      if (focused && !aldoApplePhone) input.blur();
      if (!focused || !aldoApplePhone) input.focus({ preventScroll: true });
      reset();
    },
    blur: () => inputRef.current?.blur(),
    focused: () => document.activeElement === inputRef.current,
  }));

  return (
    <input
      ref={inputRef}
      aria-label={props.label}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      data-1p-ignore=""
      data-lpignore="true"
      className={cn(
        "pointer-events-none absolute top-0 left-0 size-px resize-none border-0 bg-transparent p-0 text-[16px] caret-transparent opacity-0 outline-none",
        props.className,
      )}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.key === "Process" || e.key === "Unidentified") return;
        props.onUse?.();
        const shortcut = e.ctrlKey || e.metaKey || e.altKey;
        // Let the browser fire `paste` so the user's own clipboard is what's pasted.
        if (shortcut && e.key.toLowerCase() === "v") return;
        if (touch && !shortcut && !PHONE_KEYS.has(e.key)) return;
        e.preventDefault();
        if (touch) forwarded.current.add(e.code || e.key);
        output.key({
          event: "down",
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          text: e.key === "Enter" ? "\r" : e.key.length === 1 ? e.key : "",
          modifiers: aldoModifiers(e),
        });
        // The page may go on to another field, or another page: typing starts over.
        if (touch && e.key === "Enter") reset();
      }}
      onKeyUp={(e) => {
        if (e.nativeEvent.isComposing || e.key === "Process" || e.key === "Unidentified") return;
        const wasForwarded = forwarded.current.delete(e.code || e.key);
        if (touch ? !wasForwarded : (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
          return;
        }
        e.preventDefault();
        output.key({
          event: "up",
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          text: "",
          modifiers: aldoModifiers(e),
        });
      }}
      onPaste={(e) => {
        const text = e.clipboardData.getData("text/plain");
        if (!text) return;
        e.preventDefault();
        props.onUse?.();
        output.insert(text);
      }}
      onInput={(e) => {
        const native = e.nativeEvent as InputEvent;
        const input = e.currentTarget;
        if (!touch) {
          // Keys went as keys: what's left is dictation, or a Backspace that came as an edit.
          if (native.isComposing) return;
          if (native.inputType === "deleteContentBackward") output.backspace(1);
          else if (input.value) output.insert(input.value);
          input.value = "";
          return;
        }
        props.onUse?.();
        const deleting = (native.inputType ?? "").startsWith("delete");
        const typed = aldoTyped(last.current, input.value, deleting);
        last.current = input.value;
        if (typed.backspaces) output.backspace(typed.backspaces);
        if (typed.text) output.type(typed.text);
        // Back to the pad once it's been edited or the field grows long, between words.
        if (
          !native.isComposing &&
          (!input.value.startsWith(ALDO_TYPING_PAD) ||
            input.value.length > ALDO_TYPING_PAD.length + 200)
        ) {
          reset();
        }
      }}
      onCompositionEnd={(e) => {
        if (touch) return;
        if (e.data) output.insert(e.data);
        e.currentTarget.value = "";
      }}
      onFocus={() => {
        reset();
        props.onFocusChange?.(true);
      }}
      onBlur={() => props.onFocusChange?.(false)}
    />
  );
}
