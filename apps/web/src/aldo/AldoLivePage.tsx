import { ClipboardPasteIcon, KeyboardIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "../lib/utils";
import {
  AldoKeyInput,
  aldoApplePhone,
  aldoModifiers,
  type AldoKeyInputHandle,
  type AldoKeyOutput,
} from "./AldoKeyInput";
import {
  aldoDoubleTapScale,
  aldoDrag,
  aldoFitScale,
  aldoKeyboardFor,
  aldoMaxScale,
  aldoPlace,
  aldoReveal,
  aldoTypingScale,
  aldoZoomAt,
  type AldoField,
  type AldoKeyboard,
  type AldoPlace,
  type AldoSize,
} from "./livePage.logic";

type Point = { x: number; y: number };

const NO_KEYBOARD = aldoKeyboardFor(null);
const TEXT_KEYBOARD: AldoKeyboard = {
  type: "text",
  inputMode: "text",
  autoComplete: "off",
  enterKeyHint: "",
};
/** How far a finger moves before a tap is a drag. */
const TAP_SLOP = 8;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 300;
/** How long after a tap a field the machine reports gets the phone's keyboard. */
const ARMED_MS = 2500;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// The visual viewport, and whether a phone's keyboard has taken part of it:
// the tallest it's been at this width (this orientation), less what's left.
const tallest = new Map<number, number>();

function readViewport() {
  const view = window.visualViewport;
  const rect = view
    ? { top: view.offsetTop, left: view.offsetLeft, width: view.width, height: view.height }
    : { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  const width = Math.round(rect.width);
  const most = Math.max(tallest.get(width) ?? 0, rect.height);
  tallest.set(width, most);
  return { ...rect, keyboard: most - rect.height > 150 };
}

function useVisualViewport(enabled: boolean) {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    if (!enabled) return;
    const view = window.visualViewport;
    const update = () => setViewport(readViewport());
    update();
    view?.addEventListener("resize", update);
    view?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      view?.removeEventListener("resize", update);
      view?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);
  return viewport;
}

interface Touches {
  /** The fingers down, where they are on screen. */
  points: Map<number, Point>;
  /** Still a tap; a drag (the page moves, then scrolls); a long press (a mouse drag, to select or slide); two fingers zooming. */
  mode: "tap" | "pan" | "press" | "pinch";
  start: Point;
  /** The page point under the first finger, if it's on the page: what a tap or a long press is on. */
  at: Point | null;
  /** Where the page scrolls: that point, or the page's middle from under the page. */
  anchor: Point | null;
  last: Point;
  lastTime: number;
  /** Stage pixels a millisecond. */
  velocity: Point;
  pinch: { distance: number; middle: Point; place: AldoPlace } | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * The page in the Browser panel: drawn into `canvasRef` by the panel, placed
 * here (livePage.logic.ts), and used with the mouse as a page is, or with
 * fingers as a phone's browser is: tap, drag to scroll, two fingers or a
 * double tap to zoom, a long press to drag. Tapping into a text field opens
 * the phone's keyboard for it, once the machine says one has focus; while it's
 * up, the page fills the screen above it at the size it had, with the field
 * in view, and a bar under it to paste and close the keyboard.
 */
export function AldoLivePage(props: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  keysRef: RefObject<AldoKeyInputHandle | null>;
  /** The page's size in its CSS pixels, once there's a picture. */
  page: AldoSize | null;
  /** The frames' width in pixels: with a mouse the page shows no bigger than that, as before. */
  frameWidth: number;
  /** Phone view: the machine turns the pointer into touches, and the page scrolls itself. */
  phone: boolean;
  live: boolean;
  pictured: boolean;
  /** The machine takes input: connected, with a picture. */
  canType: boolean;
  /** The Desktop view is up: this isn't shown. */
  hidden: boolean;
  /** The text field with focus in the page, by the machine's latest report. */
  field: AldoField | null;
  /** When that report came: each one is news, even of the same field. */
  fieldAt: number;
  /** Whether the machine reports focus (a newer one does); null until it's known. Without, a phone gets a keyboard button. */
  reportsFocus: boolean | null;
  send: (message: Record<string, unknown>) => void;
  onUse: () => void;
  /** How big the page shows, in CSS pixels: the machine sends frames that size. */
  onShownSize: (size: AldoSize) => void;
  /** Show it at a phone's size (Phone view), offered under a desktop page on a phone. */
  onPhoneView: () => void;
  children?: ReactNode;
}) {
  const { send, keysRef, canvasRef } = props;
  const touch = useMediaQuery("(pointer: coarse)");
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<AldoSize | null>(null);
  // Where the user zoomed and moved the page (null: fitted), and where it is while typing.
  const [userPlace, setUserPlace] = useState<AldoPlace | null>(null);
  const [typingPlace, setTypingPlace] = useState<AldoPlace | null>(null);
  const [keysFocused, setKeysFocused] = useState(false);
  // A field has focus, and the keyboard asked for didn't open: the keyboard button offers it.
  const [missed, setMissed] = useState(false);
  const [tapMark, setTapMark] = useState<(Point & { id: number }) | null>(null);
  const viewport = useVisualViewport(touch);
  const keyboardUp = touch && keysFocused && viewport.keyboard;
  const typing = keyboardUp && !props.hidden;
  // It opened after all, if late.
  if (keyboardUp && missed) setMissed(false);

  // The room the page had before the keyboard took some: typing, it keeps the size it had.
  const restStage = useRef<AldoSize | null>(null);
  if (stage && !typing) restStage.current = stage;
  const page = props.page;
  const most = !touch && page && props.frameWidth > 0 ? props.frameWidth / page.width : Infinity;
  const fitStage = typing ? restStage.current : stage;
  const fit = page && fitStage ? aldoFitScale(fitStage, page, most) : 1;
  const placeOf = (base: AldoPlace | null): AldoPlace | null => {
    if (!page || !stage) return null;
    if (!base) return aldoPlace(stage, page, fit, 0, 0);
    const scale = Math.min(aldoMaxScale(fit), Math.max(fit, base.scale));
    return aldoPlace(stage, page, scale, base.left, base.top);
  };
  const place = placeOf(typing ? (typingPlace ?? userPlace) : userPlace);

  // What the handlers read: they outlive the render that made them.
  const now = { place, page, stage, fit, typing, keyboardUp, field: props.field };
  const live = useRef(now);
  live.current = now;
  const onUse = useRef(props.onUse);
  onUse.current = props.onUse;

  const setPlace = (next: AldoPlace) => {
    live.current.place = next;
    if (live.current.typing) setTypingPlace(next);
    else setUserPlace(next.scale <= live.current.fit * 1.001 ? null : next);
  };

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () =>
      setStage((current) =>
        current?.width === area.clientWidth && current.height === area.clientHeight
          ? current
          : { width: area.clientWidth, height: area.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  // Typing: the page at least at its own size, the field in view above the keyboard.
  const field = props.field;
  useLayoutEffect(() => {
    if (!typing || !page || !stage) {
      setTypingPlace(null);
      return;
    }
    setTypingPlace((current) => {
      const from = current ?? placeOf(userPlace);
      if (!from) return current;
      const scale = field && !current ? aldoTypingScale(from.scale, fit) : from.scale;
      const next = aldoPlace(stage, page, scale, from.left, from.top);
      return field ? aldoReveal(stage, page, next, field) : next;
    });
    // A report of the same field is news too (it may have moved); placeOf reads this render.
  }, [typing, props.fieldAt, stage?.width, stage?.height, page?.width, page?.height]);

  // Frames at the size the page shows: the panel's own size, or the page's zoomed one.
  const zoomed = place && page && (typing || place.scale > fit * 1.01);
  const shownWidth = Math.round(zoomed ? page.width * place.scale : (stage?.width ?? 0));
  const shownHeight = Math.round(zoomed ? page.height * place.scale : (stage?.height ?? 0));
  const reported = useRef(false);
  const onShownSize = useRef(props.onShownSize);
  onShownSize.current = props.onShownSize;
  useEffect(() => {
    if (!shownWidth || !shownHeight) return;
    // Once a resize or a zoom settles: each new size starts the stream again.
    const timer = setTimeout(
      () => onShownSize.current({ width: shownWidth, height: shownHeight }),
      reported.current ? 200 : 0,
    );
    reported.current = true;
    return () => clearTimeout(timer);
  }, [shownWidth, shownHeight]);

  /** Where a point on screen lands on the page, in its CSS pixels. */
  const pagePoint = (clientX: number, clientY: number): Point | null => {
    const area = areaRef.current;
    const { place, page } = live.current;
    if (!area || !place || !page) return null;
    const rect = area.getBoundingClientRect();
    const x = (clientX - rect.left - place.left) / place.scale;
    const y = (clientY - rect.top - place.top) / place.scale;
    if (x < 0 || y < 0 || x > page.width || y > page.height) return null;
    return { x, y };
  };
  const stagePoint = (client: Point): Point => {
    const rect = areaRef.current?.getBoundingClientRect();
    return { x: client.x - (rect?.left ?? 0), y: client.y - (rect?.top ?? 0) };
  };

  // ---- Keys: what's typed goes to the page.

  const output = useMemo<AldoKeyOutput>(
    () => ({
      key: (key) => send({ type: "key", ...key }),
      type: (text) => {
        for (const char of text) {
          // Key events reach forms and canvas-based pages alike; the machine types one UTF-16 unit as a key.
          if (char.length > 1) {
            send({ type: "text", text: char });
            continue;
          }
          const keyCode = /^[a-z0-9]$/i.test(char) ? char.toUpperCase().charCodeAt(0) : 0;
          send({ type: "key", event: "down", key: char, keyCode, text: char, modifiers: 0 });
          send({ type: "key", event: "up", key: char, keyCode, text: "", modifiers: 0 });
        }
      },
      insert: (text) => send({ type: "text", text }),
      backspace: (count) => {
        const key = { type: "key", key: "Backspace", code: "Backspace", keyCode: 8, text: "" };
        for (let i = 0; i < count; i++) {
          send({ ...key, event: "down", modifiers: 0 });
          send({ ...key, event: "up", modifiers: 0 });
        }
      },
    }),
    [send],
  );

  // A report of a text field, just after the user tapped (into it, or a
  // button that focused one), opens the phone's keyboard, set up for it: iOS
  // shows it as the focused field's inputmode changes, others as it's focused
  // again. A report of none puts it away.
  const armedAt = useRef(0);
  useEffect(() => {
    setMissed(false);
    const keys = keysRef.current;
    if (!touch || !keys) return;
    if (field && !field.frame) {
      const up = live.current.keyboardUp;
      if (!up && Date.now() - armedAt.current > ARMED_MS) return;
      keys.focus(aldoKeyboardFor(field));
      if (up) return;
      const timer = setTimeout(() => setMissed(!live.current.keyboardUp), 900);
      return () => clearTimeout(timer);
    }
    if (!field && live.current.keyboardUp) {
      // After a short wait: a page going on to its next field reports it next.
      const timer = setTimeout(() => keys.blur(), 400);
      return () => clearTimeout(timer);
    }
  }, [props.fieldAt, touch, keysRef, field]);

  /** After a tap on the page (in the tap: iOS opens its keyboard only then). */
  const keyboardAfterTap = (point: Point) => {
    armedAt.current = Date.now();
    setMissed(false);
    const keys = keysRef.current;
    if (!touch || !keys) return;
    const { field, keyboardUp } = live.current;
    const inField =
      field &&
      !field.frame &&
      point.x >= field.x &&
      point.x <= field.x + field.width &&
      point.y >= field.y &&
      point.y <= field.y + field.height;
    if (inField) keys.focus(aldoKeyboardFor(field));
    // Focused, without a keyboard: a field the machine reports opens one.
    else if (!keyboardUp) keys.focus(NO_KEYBOARD);
  };

  const openKeyboard = () => {
    armedAt.current = Date.now();
    const field = live.current.field;
    keysRef.current?.focus(field && !field.frame ? aldoKeyboardFor(field) : TEXT_KEYBOARD);
  };

  const paste = () => {
    onUse.current();
    const failed = () =>
      toastManager.add({
        type: "error",
        title: "Couldn't paste",
        description: "Allow Aldo to read your clipboard, or paste from your keyboard.",
      });
    if (!navigator.clipboard?.readText) return failed();
    navigator.clipboard.readText().then((text) => {
      if (text) send({ type: "text", text });
    }, failed);
  };

  // ---- Fingers: the page moves and zooms here, and scrolls on the machine.

  const touches = useRef<Touches | null>(null);
  const motion = useRef<number | null>(null);
  const scrollQueued = useRef<{ x: number; y: number; at: Point } | null>(null);
  const moveQueued = useRef<{ x: number; y: number; buttons: number; mods: number } | null>(null);
  const lastTap = useRef<(Point & { time: number }) | null>(null);

  const stopMotion = () => {
    if (motion.current !== null) cancelAnimationFrame(motion.current);
    motion.current = null;
  };
  useEffect(() => stopMotion, []);

  const flushScroll = () => {
    const scroll = scrollQueued.current;
    scrollQueued.current = null;
    if (scroll && (Math.abs(scroll.x) >= 0.5 || Math.abs(scroll.y) >= 0.5)) {
      send({ type: "wheel", ...scroll.at, deltaX: scroll.x, deltaY: scroll.y });
    }
  };

  /** The finger moved (dx, dy): a zoomed page moves first, and the page scrolls with what's left. */
  const pan = (dx: number, dy: number, at: Point | null) => {
    const { place, page, stage } = live.current;
    if (!place || !page || !stage) return;
    const moved = aldoDrag(stage, page, place, dx, dy);
    if (moved.place.left !== place.left || moved.place.top !== place.top) setPlace(moved.place);
    if (!at || (moved.scroll.x === 0 && moved.scroll.y === 0)) return;
    const queued = scrollQueued.current;
    if (queued) {
      queued.x += moved.scroll.x;
      queued.y += moved.scroll.y;
    } else {
      scrollQueued.current = { x: moved.scroll.x, y: moved.scroll.y, at };
      requestAnimationFrame(flushScroll);
    }
  };

  /** A flick goes on, slowing, as a phone's scrolling does. */
  const glide = (velocity: Point, at: Point | null) => {
    stopMotion();
    let { x, y } = velocity;
    let last = performance.now();
    const step = (time: number) => {
      const dt = Math.min(32, time - last);
      last = time;
      const decay = 0.995 ** dt;
      x *= decay;
      y *= decay;
      if (Math.hypot(x, y) < 0.03) {
        motion.current = null;
        return;
      }
      pan(x * dt, y * dt, at);
      motion.current = requestAnimationFrame(step);
    };
    motion.current = requestAnimationFrame(step);
  };

  const zoomTo = (scale: number, at: Point) => {
    stopMotion();
    const { place: from, page, stage, fit } = live.current;
    if (!from || !page || !stage) return;
    const target = aldoZoomAt(stage, page, from, fit, scale, at).scale;
    if (still) return setPlace(aldoZoomAt(stage, page, from, fit, target, at));
    const start = performance.now();
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / 220);
      const eased = 1 - (1 - t) ** 3;
      setPlace(aldoZoomAt(stage, page, from, fit, from.scale + (target - from.scale) * eased, at));
      motion.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    motion.current = requestAnimationFrame(step);
  };

  const flushMove = () => {
    const move = moveQueued.current;
    moveQueued.current = null;
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
  const queueMove = (point: Point, buttons: number, mods: number) => {
    const pending = moveQueued.current;
    moveQueued.current = { ...point, buttons, mods };
    if (!pending) requestAnimationFrame(flushMove);
  };

  const click = (point: Point) => {
    const tap = { ...point, button: "left", clickCount: 1, modifiers: 0 };
    send({ type: "mouse", event: "mousePressed", buttons: 1, ...tap });
    send({ type: "mouse", event: "mouseReleased", buttons: 0, ...tap });
  };

  const flash = (at: Point) => setTapMark({ ...at, id: Date.now() });

  /** The page's own events, not an overlay's (a dialog, the start page) bubbling up. */
  const onPage = (e: { target: EventTarget | null; currentTarget: EventTarget | null }) =>
    e.target === e.currentTarget || e.target === canvasRef.current;

  /** Fingers on a page shown here; in Phone view the machine takes them as touches itself. */
  const fingers = (e: ReactPointerEvent) => e.pointerType === "touch" && !props.phone;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onPage(e)) return;
    if (!fingers(e)) {
      if (!e.isPrimary) return;
      if (e.pointerType !== "touch") keysRef.current?.focus(NO_KEYBOARD);
      const point = pagePoint(e.clientX, e.clientY);
      if (!point) return;
      e.preventDefault();
      onUse.current();
      e.currentTarget.setPointerCapture(e.pointerId);
      send({
        type: "mouse",
        event: "mousePressed",
        ...point,
        button: (["left", "middle", "right"] as const)[e.button] ?? "none",
        buttons: e.buttons,
        clickCount: e.detail || 1,
        modifiers: aldoModifiers(e),
      });
      return;
    }
    e.preventDefault();
    stopMotion();
    e.currentTarget.setPointerCapture(e.pointerId);
    const client = { x: e.clientX, y: e.clientY };
    const t = touches.current;
    if (!t) {
      const at = pagePoint(client.x, client.y);
      const page = live.current.page;
      touches.current = {
        points: new Map([[e.pointerId, client]]),
        mode: "tap",
        start: client,
        at,
        anchor: at ?? (page ? { x: page.width / 2, y: page.height / 2 } : null),
        last: client,
        lastTime: e.timeStamp,
        velocity: { x: 0, y: 0 },
        pinch: null,
        // Held still: a mouse drag, to select text or move a slider.
        timer: setTimeout(() => {
          const held = touches.current;
          if (held?.mode !== "tap" || !held.at) return;
          held.mode = "press";
          onUse.current();
          flash(stagePoint(held.start));
          send({
            type: "mouse",
            event: "mousePressed",
            ...held.at,
            button: "left",
            buttons: 1,
            clickCount: 1,
            modifiers: 0,
          });
        }, LONG_PRESS_MS),
      };
      return;
    }
    if (t.points.size >= 2) return;
    t.points.set(e.pointerId, client);
    if (t.timer) clearTimeout(t.timer);
    if (t.mode === "press" && t.at) {
      send({ type: "mouse", event: "mouseReleased", ...t.at, button: "left", buttons: 0 });
    }
    const [a, b] = [...t.points.values()] as [Point, Point];
    t.mode = "pinch";
    t.pinch = live.current.place
      ? { distance: distance(a, b), middle: stagePoint(middle(a, b)), place: live.current.place }
      : null;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = touches.current;
    if (t?.points.has(e.pointerId)) {
      const client = { x: e.clientX, y: e.clientY };
      t.points.set(e.pointerId, client);
      if (t.mode === "pinch") {
        const { page, stage, fit } = live.current;
        if (!t.pinch || !page || !stage || t.points.size < 2) return;
        const [a, b] = [...t.points.values()] as [Point, Point];
        const now = stagePoint(middle(a, b));
        const scale = t.pinch.place.scale * (distance(a, b) / Math.max(1, t.pinch.distance));
        const zoomed = aldoZoomAt(stage, page, t.pinch.place, fit, scale, t.pinch.middle);
        setPlace(
          aldoPlace(
            stage,
            page,
            zoomed.scale,
            zoomed.left + now.x - t.pinch.middle.x,
            zoomed.top + now.y - t.pinch.middle.y,
          ),
        );
        return;
      }
      if (t.mode === "press") {
        const point = pagePoint(client.x, client.y);
        if (point) queueMove(point, 1, 0);
        return;
      }
      if (t.mode === "tap") {
        if (distance(client, t.start) < TAP_SLOP) return;
        t.mode = "pan";
        if (t.timer) clearTimeout(t.timer);
        onUse.current();
      }
      const dt = Math.max(1, e.timeStamp - t.lastTime);
      const dx = client.x - t.last.x;
      const dy = client.y - t.last.y;
      t.velocity = {
        x: 0.7 * (dx / dt) + 0.3 * t.velocity.x,
        y: 0.7 * (dy / dt) + 0.3 * t.velocity.y,
      };
      t.last = client;
      t.lastTime = e.timeStamp;
      pan(dx, dy, t.anchor);
      return;
    }
    if (fingers(e) || !e.isPrimary || !e.currentTarget.hasPointerCapture(e.pointerId)) {
      // A mouse over the page still moves (hover menus); a finger only while down.
      if (e.pointerType !== "mouse" || !onPage(e)) return;
    }
    const point = pagePoint(e.clientX, e.clientY);
    if (point) queueMove(point, e.buttons, aldoModifiers(e));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = touches.current;
    if (t?.points.has(e.pointerId)) {
      t.points.delete(e.pointerId);
      if (t.mode === "pinch") {
        // One finger left: it drags on from where it is.
        const rest = [...t.points.values()][0];
        if (!rest) {
          touches.current = null;
          return;
        }
        t.mode = "pan";
        t.last = rest;
        t.lastTime = e.timeStamp;
        t.velocity = { x: 0, y: 0 };
        return;
      }
      if (t.timer) clearTimeout(t.timer);
      touches.current = null;
      if (t.mode === "press") {
        const point = pagePoint(e.clientX, e.clientY) ?? t.at;
        if (point)
          send({ type: "mouse", event: "mouseReleased", ...point, button: "left", buttons: 0 });
        return;
      }
      if (t.mode === "pan") {
        const recent = e.timeStamp - t.lastTime < 80;
        if (e.type === "pointerup" && recent && Math.hypot(t.velocity.x, t.velocity.y) > 0.3) {
          glide(t.velocity, t.anchor);
        }
        return;
      }
      if (e.type !== "pointerup") return;
      const at = stagePoint(t.start);
      const previous = lastTap.current;
      if (
        previous &&
        e.timeStamp - previous.time < DOUBLE_TAP_MS &&
        distance(previous, t.start) < 24
      ) {
        lastTap.current = null;
        const { place, fit } = live.current;
        if (place) zoomTo(aldoDoubleTapScale(place.scale, fit), at);
        return;
      }
      lastTap.current = { ...t.start, time: e.timeStamp };
      if (!t.at) return;
      flash(at);
      onUse.current();
      click(t.at);
      keyboardAfterTap(t.at);
      return;
    }
    if (fingers(e) || !e.isPrimary || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const point = pagePoint(e.clientX, e.clientY);
    if (!point) return;
    send({
      type: "mouse",
      event: "mouseReleased",
      ...point,
      button: (["left", "middle", "right"] as const)[e.button] ?? "none",
      buttons: e.buttons,
      clickCount: e.detail || 1,
      modifiers: aldoModifiers(e),
    });
    // Phone view: the machine took it as a tap.
    if (e.pointerType === "touch" && e.type === "pointerup") keyboardAfterTap(point);
  };

  // A wheel needs a listener that isn't passive, to stop the panel scrolling instead.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (e: WheelEvent) => {
      if (!onPage(e)) return;
      const point = pagePoint(e.clientX, e.clientY);
      if (!point) return;
      e.preventDefault();
      onUse.current();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? area.clientHeight : 1;
      send({
        type: "wheel",
        ...point,
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        modifiers: aldoModifiers(e),
      });
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
    // pagePoint and onPage read refs only.
  }, [send]);

  const showKeyboardButton =
    touch &&
    props.canType &&
    !props.hidden &&
    !keyboardUp &&
    (props.reportsFocus === false || Boolean(field && (field.frame || missed)));
  // A desktop page on a phone held upright leaves room under it: say how to see more.
  const room = place && page && stage ? stage.height - (place.top + page.height * place.scale) : 0;
  const hint =
    touch &&
    props.canType &&
    !props.phone &&
    !typing &&
    !userPlace &&
    page !== null &&
    page.width > page.height &&
    room > 140;
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <div
      className={cn(
        "flex flex-col",
        typing ? "fixed z-[60] bg-background" : "relative min-h-0 flex-1",
        props.hidden && "hidden",
      )}
      // Over everything, in what the keyboard leaves of the screen.
      style={
        typing
          ? {
              top: viewport.top,
              left: viewport.left,
              width: viewport.width,
              height: viewport.height,
            }
          : undefined
      }
    >
      <div
        ref={areaRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden bg-muted/50 dark:bg-black/25"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onContextMenu={(e) => {
          if (onPage(e)) e.preventDefault();
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label="Shared browser. Click to interact."
          className={cn(
            "absolute top-0 left-0 block touch-none select-none bg-background shadow-[0_1px_0_0_var(--color-border),0_8px_24px_-12px_rgb(0_0_0/0.18)] outline-none transition-opacity [-webkit-touch-callout:none]",
            !props.live && "opacity-40",
            !props.pictured && "invisible",
            keysFocused && !touch && "outline-2 -outline-offset-2 outline-ring/50",
          )}
          style={
            place && page
              ? {
                  width: page.width * place.scale,
                  height: page.height * place.scale,
                  transform: `translate3d(${place.left}px, ${place.top}px, 0)`,
                }
              : undefined
          }
        />
        <AldoKeyInput
          ref={keysRef}
          touch={touch}
          output={output}
          label="Type into the shared browser"
          onUse={props.onUse}
          onFocusChange={setKeysFocused}
        />
        {tapMark ? (
          <span
            key={tapMark.id}
            aria-hidden
            ref={(element) => {
              element?.animate(
                [
                  { opacity: 1, transform: still ? "none" : "scale(0.5)" },
                  { opacity: 0, transform: "none" },
                ],
                { duration: 380, easing: "cubic-bezier(0.2, 0, 0, 1)" },
              );
            }}
            className="pointer-events-none absolute z-10 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/20 opacity-0"
            style={{ left: tapMark.x, top: tapMark.y }}
          />
        ) : null}
        {hint && place && page ? (
          <p
            className="absolute inset-x-0 px-6 text-center text-[13px] text-muted-foreground leading-5"
            style={{ top: place.top + page.height * place.scale + 20 }}
          >
            Pinch or double-tap to zoom, or{" "}
            <button
              type="button"
              onClick={props.onPhoneView}
              className="rounded-sm text-foreground underline decoration-foreground/30 underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              show pages at phone size
            </button>
            .
          </p>
        ) : null}
        {showKeyboardButton ? (
          <button
            type="button"
            aria-label="Keyboard"
            onClick={openKeyboard}
            className="absolute right-3 bottom-3 z-10 inline-flex size-11 items-center justify-center rounded-full border border-border/70 bg-popover text-foreground shadow-md outline-none transition-colors active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <KeyboardIcon className="size-5" />
          </button>
        ) : null}
        {props.children}
      </div>
      {typing ? (
        // Its buttons leave the keyboard where it is: they never take focus.
        <div className="flex h-11 shrink-0 items-center gap-1 border-t border-border/60 bg-background px-1.5">
          <Button
            type="button"
            variant="ghost"
            className="h-9 gap-2 px-3 text-[15px]"
            onPointerDown={keep}
            onMouseDown={keep}
            onClick={paste}
          >
            <ClipboardPasteIcon className="size-4" /> Paste
          </Button>
          <div className="flex-1" />
          {/* iOS puts its own Done over the keyboard. */}
          {aldoApplePhone ? null : (
            <Button
              type="button"
              variant="ghost"
              className="h-9 px-3 font-medium text-[15px]"
              onPointerDown={keep}
              onMouseDown={keep}
              onClick={() => keysRef.current?.blur()}
            >
              Done
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
