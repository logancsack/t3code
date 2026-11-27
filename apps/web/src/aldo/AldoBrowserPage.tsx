// The page in the Browser panel (AldoBrowserPanel.tsx): its picture, and what
// a hand does to it.
//
// With a mouse and a keyboard it's as a browser: clicks, the wheel and keys
// go to the page as they are. With a finger: a touch is the page's own touch
// (it scrolls, flings and taps as a phone's browser), two fingers zoom the
// picture here, one moves it about while it's zoomed, and a long press offers
// Paste. The phone's own keyboard opens when a tap lands on a field, and
// closes when the page's focus leaves it (browserInput.logic.ts says how the
// panel knows either).
//
// A phone opens its keyboard only as focus arrives at a field, inside the tap
// that asked for it. So there are two hidden inputs, and focus goes to the
// one it isn't in: that's what shows the keyboard again after its own "hide"
// (which leaves focus where it was) and what changes its kind between a
// password, a code and an email.

import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type RefObject,
} from "react";

import { cn } from "../lib/utils";
import {
  ALDO_NO_LENS,
  ALDO_TYPING_SEED as SEED,
  aldoFieldAt,
  aldoIsPageKey,
  aldoKeyboardFor,
  aldoKeyPress,
  aldoPanLens,
  aldoPinchLens,
  aldoSameKeyboard,
  aldoTyped,
  aldoTypingMessages,
  type AldoKeyboard,
  type AldoLens,
  type AldoPageField,
  type AldoPageFields,
  type AldoPinch,
} from "./browserInput.logic";

/** The page's size in its own CSS pixels, which input is sent in. */
export type AldoFrameMeta = { deviceWidth: number; deviceHeight: number };
export interface AldoBrowserPageHandle {
  /** Keys go to the page from here on (after the address bar sent it somewhere). */
  focus: () => void;
}

type Point = { x: number; y: number };
type Timer = ReturnType<typeof setTimeout>;
type Gesture =
  | {
      kind: "page";
      id: number;
      x: number;
      y: number;
      at: number;
      moved: boolean;
      point: Point;
      lastY: number;
      scrolled: boolean;
      hold: Timer | null;
    }
  | { kind: "lens"; from: AldoPinch; start: AldoLens }
  | { kind: "pan"; id: number; x: number; y: number; start: AldoLens }
  // What's left of one that ended with a finger still down: it does nothing more.
  | { kind: "over" };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** A finger that moved less than this, for less long, tapped. */
const TAP_SLOP = 10;
const TAP_MS = 600;
const HOLD_MS = 550;
/** How long after the user's last tap or key the page's focus is theirs to follow with a keyboard. */
const FOLLOW_MS = 3000;
/** How long a keyboard waits for the page's focus to come back (the next step of a sign-in) before it goes. */
const LINGER_MS = 1500;
/** How much of the app's height a keyboard takes, at least. */
const KEYBOARD_GONE = 120;
const HIDDEN_INPUT =
  "pointer-events-none absolute top-0 left-0 size-px resize-none border-0 bg-transparent p-0 text-base opacity-0 outline-none";

/** Keeps a pointer's moves coming to the page's picture once they leave it. */
function capture(e: ReactPointerEvent<HTMLCanvasElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Already lifted: there's nothing more of it to follow.
  }
}

function modifiers(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  getModifierState(key: "AltGraph"): boolean;
}) {
  // AltGr (a keyboard's third level: "@", "{", "€" on many) is told as Ctrl and Alt on Windows,
  // and as those the page would take the character for a shortcut.
  const graph = e.getModifierState("AltGraph");
  let bits =
    (e.altKey && !graph ? 1 : 0) |
    (e.ctrlKey && !graph ? 2 : 0) |
    (e.metaKey ? 4 : 0) |
    (e.shiftKey ? 8 : 0);
  // The remote Chrome runs on Linux: ⌘ shortcuts become Ctrl ones there.
  if (isMac && e.metaKey) bits = (bits & ~4) | 2;
  return bits;
}

/**
 * A keyboard put away with the phone's own Back key leaves focus where it
 * was, so nothing says it went but the app getting taller again: once it has
 * stayed that way (a keyboard changing its kind can go and come back).
 */
export function useAldoKeyboardGone(typing: boolean, onGone: () => void): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!typing || !viewport) return;
    let least = viewport.height;
    let width = viewport.width;
    let gone: Timer | null = null;
    const onResize = () => {
      if (gone) clearTimeout(gone);
      gone = null;
      // Turned on its side: another size altogether.
      if (viewport.width !== width) {
        width = viewport.width;
        least = viewport.height;
        return;
      }
      least = Math.min(least, viewport.height);
      if (viewport.height - least > KEYBOARD_GONE) gone = setTimeout(onGone, 250);
    };
    viewport.addEventListener("resize", onResize);
    return () => {
      viewport.removeEventListener("resize", onResize);
      if (gone) clearTimeout(gone);
    };
  }, [typing, onGone]);
}

/**
 * Whether the phone's keyboard is up, by the room it takes from the app. The
 * panel's layout follows this, not focus, so it changes once, as the keyboard
 * arrives, and again as it goes (whoever put it away).
 */
export function useAldoKeyboardUp(enabled: boolean): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    let width = viewport.width;
    let most = viewport.height;
    const measure = () => {
      // Zoomed in on the app itself, less of it shows for that, not for a keyboard.
      if (Math.abs(viewport.scale - 1) > 0.01) return;
      // Turned on its side: another size altogether.
      if (viewport.width !== width) {
        width = viewport.width;
        most = viewport.height;
      }
      most = Math.max(most, viewport.height);
      setUp(most - viewport.height > KEYBOARD_GONE);
    };
    viewport.addEventListener("resize", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      setUp(false);
    };
  }, [enabled]);
  return up;
}

type TypingHandlers = {
  input: (e: FormEvent<HTMLInputElement>) => void;
  keyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  paste: (e: ReactClipboardEvent<HTMLInputElement>) => void;
  focus: () => void;
  blur: (e: ReactFocusEvent<HTMLInputElement>) => void;
};

/**
 * One of the two inputs the phone's keyboard types into. Rendered once: the
 * keyboard it asks for is set on it as a tap opens it, and a render would
 * undo part of that (React takes away the `type` of an input it gave none).
 */
const TypingInput = memo(function TypingInput(props: {
  ref: RefObject<HTMLInputElement | null>;
  handlers: RefObject<TypingHandlers | null>;
}) {
  const { handlers } = props;
  return (
    <input
      ref={props.ref}
      aria-label="Type into the shared browser"
      tabIndex={-1}
      // No password manager offers this site's sign-in for another's page.
      data-1p-ignore=""
      data-lpignore="true"
      data-bwignore=""
      className={HIDDEN_INPUT}
      onInput={(e) => handlers.current?.input(e)}
      onKeyDown={(e) => handlers.current?.keyDown(e)}
      onPaste={(e) => handlers.current?.paste(e)}
      onFocus={() => handlers.current?.focus()}
      onBlur={(e) => handlers.current?.blur(e)}
    />
  );
});

export function AldoBrowserPage(props: {
  ref?: Ref<AldoBrowserPageHandle>;
  /** Drawn by the panel's connection; a child of the panel's stage, which clips it. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  metaRef: RefObject<AldoFrameMeta | null>;
  send: (message: Record<string, unknown>) => void;
  /** The user used the page: agents wait a moment. */
  onUse: () => void;
  /** A touch screen, whose own keyboard types. */
  coarse: boolean;
  /** The page is laid out at the panel's width: its picture fills it across, however tall. */
  fit: boolean;
  /** The machine takes fingers as touches. An older one gets a drag as the wheel and a tap as a click. */
  touch: boolean;
  /** An older machine's "Phone view": the mouse is its finger. */
  mouseTouch: boolean;
  /** Where the page's fields are; null from a machine that doesn't say. */
  fields: AldoPageFields | null;
  dimmed: boolean;
  hidden: boolean;
  /** Types what the user copied; offered after a long press. */
  onPaste?: (() => void) | undefined;
}) {
  const { canvasRef, metaRef, send, onUse, coarse, fit, touch, mouseTouch, onPaste } = props;
  const keysRef = useRef<HTMLTextAreaElement | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);
  const secondRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [typing, setTyping] = useState(false);
  const [lens, setLens] = useState<AldoLens>(ALDO_NO_LENS);
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const [pasteAt, setPasteAt] = useState<Point | null>(null);
  const fieldsRef = useRef(props.fields);
  fieldsRef.current = props.fields;
  const keyboard = useRef({
    typing: false,
    /** What the input in use held when it last spoke: typing is sent as the difference. */
    held: "",
    field: "",
    kind: null as AldoKeyboard | null,
    actedAt: 0,
    tappedAt: 0,
    closing: null as Timer | null,
    waiting: null as Timer | null,
  });
  const fingers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const pendingTap = useRef<Point | null>(null);
  const touchMove = useRef<Point | null>(null);
  const mouseMove = useRef<(Point & { buttons: number; mods: number }) | null>(null);

  useEffect(() => setLens(ALDO_NO_LENS), [fit]);
  // The room under a zoomed picture changed (the keyboard came, the phone turned): the picture stays in it.
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const box = {
        width: canvas.offsetWidth,
        height: canvas.offsetHeight,
        viewWidth: stage.clientWidth - canvas.offsetLeft,
        viewHeight: stage.clientHeight - canvas.offsetTop,
      };
      setLens((lens) => {
        if (lens.scale <= 1) return lens;
        const kept = aldoPanLens(lens, 0, 0, box);
        return kept.x === lens.x && kept.y === lens.y ? lens : kept;
      });
    });
    observer.observe(stage);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);
  useImperativeHandle(props.ref, () => ({
    focus: () => {
      if (!coarse) keysRef.current?.focus({ preventScroll: true });
    },
  }));

  // ---- The phone's keyboard.

  /** Puts the keyboard away as the page asks: its focus may still bring it back (the next step of a sign-in). */
  const closeKeyboard = useCallback(() => {
    const k = keyboard.current;
    if (k.closing) clearTimeout(k.closing);
    if (k.waiting) clearTimeout(k.waiting);
    k.closing = k.waiting = null;
    const acted = k.actedAt;
    for (const input of [firstRef.current, secondRef.current]) {
      // Leaving the input is what hides the keyboard, on every phone.
      if (input && document.activeElement === input) input.blur();
    }
    k.actedAt = acted;
  }, []);
  /** The user put it away (the phone's Back key): it stays away until they're back at the page. */
  const keyboardGone = useCallback(() => {
    closeKeyboard();
    keyboard.current.actedAt = 0;
  }, [closeKeyboard]);

  /** `tapped`: inside the user's tap, which always gets its keyboard; otherwise only a field or a kind that changed does. */
  const openKeyboard = useCallback((field: AldoPageField | null, tapped: boolean) => {
    const k = keyboard.current;
    if (k.closing) clearTimeout(k.closing);
    k.closing = null;
    const kind = aldoKeyboardFor(field);
    const id = field?.id ?? "";
    if (k.typing && !tapped && k.field === id && k.kind && aldoSameKeyboard(k.kind, kind)) return;
    const input =
      document.activeElement === firstRef.current ? secondRef.current : firstRef.current;
    if (!input) return;
    input.type = kind.type;
    input.inputMode = kind.inputMode;
    input.enterKeyHint = kind.enterKeyHint;
    input.autocomplete = kind.autoComplete as AutoFill;
    input.autocapitalize = kind.autoCapitalize;
    input.setAttribute("autocorrect", kind.autoCorrect ? "on" : "off");
    input.spellcheck = kind.autoCorrect;
    input.value = SEED;
    k.held = SEED;
    k.field = id;
    k.kind = kind;
    input.focus({ preventScroll: true });
  }, []);

  /** A tap landed on the page here. Called inside the tap: a phone opens its keyboard at no other time. */
  const tap = (point: Point) => {
    const k = keyboard.current;
    const now = Date.now();
    k.actedAt = now;
    if (!coarse) return;
    const fields = fieldsRef.current;
    const field = fields ? aldoFieldAt(fields, point.x, point.y) : null;
    if (fields && !field) {
      k.tappedAt = now;
      // Something to hold focus, without a keyboard: keys from one that's plugged in go to the
      // page, and a field the page focuses a moment from now can take the keyboard from it.
      if (!k.typing && document.activeElement !== keysRef.current) {
        keysRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    // An older machine doesn't say where fields are: any tap may be on one.
    openKeyboard(field, true);
    if (k.waiting) clearTimeout(k.waiting);
    // The tap missed (the field had moved): nothing took focus, so there's nothing to type into.
    k.waiting = fields
      ? setTimeout(() => {
          k.waiting = null;
          if (!fieldsRef.current?.focus) closeKeyboard();
        }, LINGER_MS)
      : null;
  };
  const takeTap = () => {
    const point = pendingTap.current;
    pendingTap.current = null;
    if (point) tap(point);
  };

  // The page's focus moved: the keyboard follows it, when it's the user who's typing here.
  useEffect(() => {
    const fields = props.fields;
    const k = keyboard.current;
    if (!coarse || !fields) return;
    if (fields.focus) {
      if (k.typing || Date.now() - k.actedAt < FOLLOW_MS) openKeyboard(fields.focus, false);
    } else if (k.typing && !k.closing) {
      // At once after a tap elsewhere on the page, as a phone's browser does; else it waits
      // for the next field (a sign-in's password after its email).
      k.closing = setTimeout(closeKeyboard, Date.now() - k.tappedAt < LINGER_MS ? 150 : LINGER_MS);
    }
  }, [props.fields, coarse, openKeyboard, closeKeyboard]);

  useAldoKeyboardGone(typing, keyboardGone);

  useEffect(() => closeKeyboard, [closeKeyboard]);
  // A long press still being timed as the page goes has nothing left to offer Paste on.
  useEffect(
    () => () => {
      const g = gesture.current;
      if (g?.kind === "page" && g.hold) clearTimeout(g.hold);
    },
    [],
  );

  const type = (messages: Record<string, unknown>[]) => {
    if (messages.length === 0) return;
    keyboard.current.actedAt = Date.now();
    onUse();
    for (const message of messages) send(message);
  };
  /** A key the page takes as a key. What the input held is behind it now: the next typing starts clean. */
  const press = (input: HTMLInputElement, messages: Record<string, unknown>[]) => {
    type(messages);
    input.value = SEED;
    keyboard.current.held = SEED;
  };

  const onTypingInput = (e: FormEvent<HTMLInputElement>) => {
    const k = keyboard.current;
    const input = e.currentTarget;
    const { inputType, isComposing } = e.nativeEvent as InputEvent;
    const typed = aldoTyped(
      k.held,
      input.value,
      SEED,
      inputType ? inputType.startsWith("delete") : input.value === "",
    );
    // Not under a word the keyboard is still making: it loses its place when the text changes.
    if (typed.value !== input.value && !isComposing) input.value = typed.value;
    k.held = input.value;
    type(aldoTypingMessages(typed));
  };

  const onTypingKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Composing (every word, on most phone keyboards): the input event says what was typed.
    if (
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      e.key === "Process" ||
      e.key === "Unidentified"
    ) {
      return;
    }
    // AltGr is Ctrl and Alt on Windows, and types a character like any other key.
    const shortcut = (e.ctrlKey || e.metaKey) && !e.getModifierState("AltGraph");
    // The browser's own paste brings the user's clipboard, which onTypingPaste sends.
    if (shortcut && e.key.toLowerCase() === "v") return;
    if (e.key === "Backspace" && !shortcut) {
      // With nothing here to delete, the page still has something.
      if (e.currentTarget.value !== "") return;
      e.preventDefault();
      type(aldoKeyPress("Backspace"));
      return;
    }
    // Text, Option's characters too ("@" on a German iPad keyboard): the input takes it.
    if (!shortcut && !aldoIsPageKey(e.key)) return;
    e.preventDefault();
    const key = {
      type: "key",
      key: e.key,
      code: e.code || e.key,
      keyCode: e.keyCode,
      text: e.key === "Enter" ? "\r" : "",
      modifiers: modifiers(e),
    };
    press(e.currentTarget, [
      { ...key, event: "down" },
      { ...key, event: "up" },
    ]);
  };

  /**
   * What's pasted goes to the page as it was copied: an input of one line would take its line
   * breaks first. A short line (a code) is still typed a key at a time, as typing it is.
   */
  const onTypingPaste = (e: ReactClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    type(aldoTypingMessages({ backspaces: 0, text }));
  };

  // A keyboard that sends Enter as a line break, not as a key.
  useEffect(() => {
    const inputs = [firstRef.current, secondRef.current];
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "insertLineBreak" && e.inputType !== "insertParagraph") return;
      e.preventDefault();
      press(e.currentTarget as HTMLInputElement, aldoKeyPress("Enter"));
    };
    for (const input of inputs) input?.addEventListener("beforeinput", onBeforeInput);
    return () => {
      for (const input of inputs) input?.removeEventListener("beforeinput", onBeforeInput);
    };
    // press reads refs and props that don't change what it does.
  }, []);

  const onTypingFocus = () => {
    keyboard.current.typing = true;
    setTyping(true);
  };
  const onTypingBlur = (e: ReactFocusEvent<HTMLInputElement>) => {
    // To the other of the two: still typing.
    if (e.relatedTarget === firstRef.current || e.relatedTarget === secondRef.current) return;
    e.currentTarget.value = SEED;
    keyboard.current.held = SEED;
    keyboard.current.typing = false;
    // Put away by the user (the keyboard's own Done, another control): the page's focus alone
    // doesn't bring it back.
    keyboard.current.actedAt = 0;
    setTyping(false);
  };

  // ---- Keys from a keyboard that's plugged in, through a hidden textarea: real keys are sent as
  // key events (pages see keydown and keyup), and text that arrives without them (composition,
  // paste, dictation) is inserted as text.

  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>, event: "down" | "up") => {
    if (e.nativeEvent.isComposing || e.key === "Process" || e.key === "Unidentified") return;
    if (event === "down") {
      keyboard.current.actedAt = Date.now();
      onUse();
    }
    // Let the browser fire `paste` so the user's own clipboard is what's pasted.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    const text = e.key === "Enter" ? "\r" : e.key.length === 1 ? e.key : "";
    send({
      type: "key",
      event,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      text,
      modifiers: modifiers(e),
    });
  };

  const onKeysPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    send({ type: "text", text });
  };

  const onKeysInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const native = e.nativeEvent as InputEvent;
    const target = e.currentTarget;
    if (native.isComposing) return;
    if (native.inputType === "deleteContentBackward") type(aldoKeyPress("Backspace"));
    else if (target.value) send({ type: "text", text: target.value });
    target.value = "";
  };

  // ---- The mouse, and fingers.

  /** Where a pointer lands on the page, in its CSS pixels. */
  const pagePoint = (clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current;
    const meta = metaRef.current;
    if (!canvas || !meta || canvas.width === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const drawnWidth = canvas.width * scale;
    const drawnHeight = canvas.height * scale;
    const offsetX = (rect.width - drawnWidth) / 2;
    const offsetY = (rect.height - drawnHeight) / 2;
    const x = ((clientX - rect.left - offsetX) / drawnWidth) * meta.deviceWidth;
    const y = ((clientY - rect.top - offsetY) / drawnHeight) * meta.deviceHeight;
    if (x < 0 || y < 0 || x > meta.deviceWidth || y > meta.deviceHeight) return null;
    return { x, y };
  };

  const flushMouseMove = () => {
    const move = mouseMove.current;
    mouseMove.current = null;
    if (!move) return;
    send({
      type: "mouse",
      event: "mouseMoved",
      x: move.x,
      y: move.y,
      button: move.buttons & 1 ? "left" : "none",
      buttons: move.buttons,
      modifiers: move.mods,
    });
  };
  const flushTouchMove = () => {
    const point = touchMove.current;
    touchMove.current = null;
    if (point) send({ type: "touch", event: "move", points: [{ ...point, id: 0 }] });
  };

  /** The picture's size unzoomed, and the room its view has for it. */
  const lensBox = (): Parameters<typeof aldoPinchLens>[3] | null => {
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return null;
    return {
      width: canvas.offsetWidth,
      height: canvas.offsetHeight,
      viewWidth: stage.clientWidth - canvas.offsetLeft,
      viewHeight: stage.clientHeight - canvas.offsetTop,
    };
  };

  /** The fingers' middle and spread, from the picture's own corner (where it sits unzoomed). */
  const pinch = (): AldoPinch | null => {
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    const [a, b] = [...fingers.current.values()];
    if (!canvas || !stage || !a || !b) return null;
    const view = stage.getBoundingClientRect();
    return {
      x: (a.x + b.x) / 2 - view.left - canvas.offsetLeft,
      y: (a.y + b.y) / 2 - view.top - canvas.offsetTop,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  /** The page's finger lifts, or is taken from it (a second finger, a long press). */
  const letGo = (how: "end" | "cancel") => {
    const g = gesture.current;
    if (g?.kind !== "page") return;
    if (g.hold) clearTimeout(g.hold);
    if (!touch) return;
    flushTouchMove();
    send({ type: "touch", event: how, points: [] });
  };

  const fingerAsMouse = (e: ReactPointerEvent) =>
    e.pointerType !== "touch" || (mouseTouch && !touch);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    setPasteAt(null);
    // A computer's keys go to the page from here on, whether it was a mouse or a finger on its screen.
    if (!coarse) keysRef.current?.focus({ preventScroll: true });
    if (fingerAsMouse(e)) {
      const point = pagePoint(e.clientX, e.clientY);
      if (!point) return;
      e.preventDefault();
      onUse();
      capture(e);
      send({
        type: "mouse",
        event: "mousePressed",
        ...point,
        button: (["left", "middle", "right"] as const)[e.button] ?? "none",
        buttons: e.buttons,
        clickCount: e.detail || 1,
        modifiers: modifiers(e),
      });
      return;
    }
    // The browser's own answer to a touch (a click that would take focus from the keyboard) is ours to give.
    e.preventDefault();
    capture(e);
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.current.size > 2) return;
    if (fingers.current.size === 2) {
      letGo("cancel");
      const from = pinch();
      gesture.current = from ? { kind: "lens", from, start: lensRef.current } : { kind: "over" };
      return;
    }
    const point = pagePoint(e.clientX, e.clientY);
    if (!point) {
      gesture.current = { kind: "over" };
      return;
    }
    onUse();
    const g: Gesture = {
      kind: "page",
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      at: Date.now(),
      moved: false,
      point,
      lastY: e.clientY,
      scrolled: false,
      hold: null,
    };
    const stage = e.currentTarget.parentElement?.getBoundingClientRect();
    if (onPaste && stage) {
      const at = { x: e.clientX - stage.left, y: e.clientY - stage.top };
      g.hold = setTimeout(() => {
        if (gesture.current !== g || g.moved) return;
        letGo("cancel");
        gesture.current = { kind: "over" };
        setPasteAt(at);
      }, HOLD_MS);
    }
    gesture.current = g;
    if (touch) send({ type: "touch", event: "start", points: [{ ...point, id: 0 }] });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (fingerAsMouse(e)) {
      const point = pagePoint(e.clientX, e.clientY);
      if (!point) return;
      const pending = mouseMove.current;
      mouseMove.current = { ...point, buttons: e.buttons, mods: modifiers(e) };
      if (!pending) requestAnimationFrame(flushMouseMove);
      return;
    }
    const finger = fingers.current.get(e.pointerId);
    if (!finger) return;
    finger.x = e.clientX;
    finger.y = e.clientY;
    const g = gesture.current;
    const box = lensBox();
    if (g?.kind === "lens") {
      const to = pinch();
      if (to && box) setLens(aldoPinchLens(g.start, g.from, to, box));
      return;
    }
    if (g?.kind === "pan") {
      if (g.id === e.pointerId && box) {
        setLens(aldoPanLens(g.start, e.clientX - g.x, e.clientY - g.y, box));
      }
      return;
    }
    if (g?.kind !== "page" || g.id !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP_SLOP) {
      g.moved = true;
      if (g.hold) clearTimeout(g.hold);
      // Zoomed in, a finger moves the picture; once it's at its edge that way, the page scrolls.
      const start = lensRef.current;
      if (start.scale > 1 && box) {
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        const moved = aldoPanLens(start, dx, dy, box);
        if (Math.abs(dx) > Math.abs(dy) ? moved.x !== start.x : moved.y !== start.y) {
          letGo("cancel");
          gesture.current = { kind: "pan", id: g.id, x: g.x, y: g.y, start };
          setLens(moved);
          return;
        }
      }
    }
    if (touch) {
      const point = pagePoint(e.clientX, e.clientY);
      if (!point) return;
      const pending = touchMove.current;
      touchMove.current = point;
      if (!pending) requestAnimationFrame(flushTouchMove);
    } else if (Math.abs(e.clientY - g.lastY) > 2) {
      g.scrolled = true;
      send({ type: "wheel", ...g.point, deltaX: 0, deltaY: (g.lastY - e.clientY) * 2 });
      g.lastY = e.clientY;
    }
  };

  const lift = (e: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    if (!fingers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g?.kind === "page" && g.id === e.pointerId) {
      letGo(cancelled ? "cancel" : "end");
      if (!cancelled) {
        if (!touch && !g.scrolled) {
          const click = { ...g.point, button: "left", clickCount: 1, modifiers: 0 };
          send({ type: "mouse", event: "mousePressed", buttons: 1, ...click });
          send({ type: "mouse", event: "mouseReleased", buttons: 0, ...click });
        }
        if (!g.moved && Date.now() - g.at < TAP_MS) {
          // Taken as the touch ends, where every phone counts a focus as the user's own.
          pendingTap.current = g.point;
          if (!("ontouchend" in window)) takeTap();
        }
      }
    }
    gesture.current = fingers.current.size === 0 ? null : { kind: "over" };
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!fingerAsMouse(e)) return lift(e, false);
    const point = pagePoint(e.clientX, e.clientY);
    if (!point) return;
    send({
      type: "mouse",
      event: "mouseReleased",
      ...point,
      button: (["left", "middle", "right"] as const)[e.button] ?? "none",
      buttons: e.buttons,
      clickCount: e.detail || 1,
      modifiers: modifiers(e),
    });
    if (coarse) tap(point);
  };

  // Wheel needs a non-passive listener to stop the panel scrolling instead.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const point = pagePoint(e.clientX, e.clientY);
      if (!point) return;
      e.preventDefault();
      onUse();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
      send({
        type: "wheel",
        ...point,
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        modifiers: modifiers(e),
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // pagePoint reads refs only.
  }, [canvasRef, send, onUse]);

  const typingHandlers = useRef<TypingHandlers>(null);
  typingHandlers.current = {
    input: onTypingInput,
    keyDown: onTypingKeyDown,
    paste: onTypingPaste,
    focus: onTypingFocus,
    blur: onTypingBlur,
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label={coarse ? "Shared browser. Tap to use it." : "Shared browser. Click to use it."}
        className={cn(
          // The page at the top, as a browser shows one. Laid out for this panel, it fills it across
          // at its own size; otherwise as big as fits, centered across when it's narrower.
          "absolute top-0 block touch-none bg-background shadow-[0_1px_0_0_var(--color-border),0_8px_24px_-12px_rgb(0_0_0/0.18)] outline-none transition-opacity",
          fit ? "left-0 w-full" : "inset-x-0 mx-auto max-h-full max-w-full",
          props.dimmed && "opacity-40",
          props.hidden && "invisible",
          focused && !coarse && "outline-2 -outline-offset-2 outline-ring/50",
        )}
        style={
          lens.scale > 1
            ? {
                transform: `translate(${lens.x}px, ${lens.y}px) scale(${lens.scale})`,
                transformOrigin: "0 0",
              }
            : undefined
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => lift(e, true)}
        onLostPointerCapture={(e) => lift(e, true)}
        onTouchEnd={(e) => {
          if (e.cancelable) e.preventDefault();
          takeTap();
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <textarea
        ref={keysRef}
        aria-label="Type into the shared browser"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        // On a touch screen it holds focus for a keyboard that's plugged in, and asks for none on screen.
        inputMode={coarse ? "none" : undefined}
        className={HIDDEN_INPUT}
        onKeyDown={(e) => onKey(e, "down")}
        onKeyUp={(e) => onKey(e, "up")}
        onPaste={onKeysPaste}
        onInput={onKeysInput}
        onCompositionEnd={(e) => {
          if (e.data) send({ type: "text", text: e.data });
          e.currentTarget.value = "";
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <TypingInput ref={firstRef} handlers={typingHandlers} />
      <TypingInput ref={secondRef} handlers={typingHandlers} />
      {lens.scale > 1 ? (
        <button
          type="button"
          className="absolute right-3 bottom-3 z-10 inline-flex h-11 items-center rounded-full border border-border/70 bg-popover px-3.5 text-[13px] text-popover-foreground shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setLens(ALDO_NO_LENS)}
        >
          Reset zoom
        </button>
      ) : null}
      {pasteAt && onPaste ? (
        <button
          type="button"
          className="absolute z-10 inline-flex h-11 -translate-x-1/2 items-center rounded-lg border border-border/70 bg-popover px-4 font-medium text-popover-foreground text-sm shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            left: `clamp(3rem, ${pasteAt.x}px, calc(100% - 3rem))`,
            top: Math.max(8, pasteAt.y - 60),
          }}
          // Focus stays where the keyboard is.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setPasteAt(null);
            onPaste();
          }}
        >
          Paste
        </button>
      ) : null}
    </>
  );
}
