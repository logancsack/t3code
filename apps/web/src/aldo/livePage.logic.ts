// How the Browser panel shows the page (AldoLivePage.tsx) and takes a phone's
// keyboard for it. The page fits the panel, and on a touch screen it zooms
// with two fingers; a drag moves a zoomed page first and scrolls the page
// itself with what's left. With the phone's keyboard up, the page keeps its
// size and moves to keep the field being typed in above it (the machine says
// which field has focus: aldoFieldOf). Typing goes through a hidden field
// (AldoKeyInput.tsx) that starts with a pad of characters, so a phone
// keyboard's Backspace always has something to delete and its corrections
// can be told apart from new text (aldoTyped).

export interface AldoSize {
  readonly width: number;
  readonly height: number;
}

/** Where the page is drawn in its stage: its scale (stage pixels per page pixel) and its top-left corner. */
export interface AldoPlace {
  readonly scale: number;
  readonly left: number;
  readonly top: number;
}

/** A text field with focus in the page, as the machine reports it: where it is, in the page's CSS pixels, and what it takes. */
export interface AldoField {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Focus is in another site's frame, which the machine can't look into: maybe a field. */
  readonly frame: boolean;
  readonly type: string;
  readonly inputMode: string;
  readonly autocomplete: string;
  readonly enterKeyHint: string;
  readonly multiline: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The scale that shows the whole page in the stage, and no bigger than `most` (the frames' own size). */
export function aldoFitScale(stage: AldoSize, page: AldoSize, most = Infinity): number {
  if (page.width <= 0 || page.height <= 0 || stage.width <= 0 || stage.height <= 0) return 1;
  return Math.min(stage.width / page.width, stage.height / page.height, most);
}

/** As far as two fingers zoom in: twice the fit, and at least half again the page's own size. */
export function aldoMaxScale(fit: number): number {
  return Math.max(fit * 2, 1.5);
}

/** Typing, the page at its own size at least (a field's text as the site meant it), or closer if zoomed in already. */
export function aldoTypingScale(scale: number, fit: number): number {
  return Math.min(aldoMaxScale(fit), Math.max(scale, 1, fit));
}

/** A double tap: in to the page's own size (twice the fit, if that's more), or back out to the fit when zoomed in. */
export function aldoDoubleTapScale(scale: number, fit: number): number {
  if (scale > fit * 1.05) return fit;
  return Math.min(aldoMaxScale(fit), Math.max(1, fit * 2));
}

/**
 * The page at `scale` with its corner near (left, top): centered across while
 * it's narrower than the stage, at the top while it's shorter, and never
 * leaving a gap at an edge it overflows.
 */
export function aldoPlace(
  stage: AldoSize,
  page: AldoSize,
  scale: number,
  left: number,
  top: number,
): AldoPlace {
  const width = page.width * scale;
  const height = page.height * scale;
  return {
    scale,
    left: width <= stage.width ? (stage.width - width) / 2 : clamp(left, stage.width - width, 0),
    top: height <= stage.height ? 0 : clamp(top, stage.height - height, 0),
  };
}

/** The page zoomed to `scale` (within fit and the most), keeping the point under `at` (stage pixels) where it is. */
export function aldoZoomAt(
  stage: AldoSize,
  page: AldoSize,
  place: AldoPlace,
  fit: number,
  scale: number,
  at: { x: number; y: number },
): AldoPlace {
  const next = clamp(scale, fit, aldoMaxScale(fit));
  const ratio = next / place.scale;
  return aldoPlace(
    stage,
    page,
    next,
    at.x - (at.x - place.left) * ratio,
    at.y - (at.y - place.top) * ratio,
  );
}

/**
 * A finger moved (dx, dy) stage pixels: the page moves with it as far as it
 * overflows the stage, and `scroll` is what's left, for the page itself to
 * scroll, in its own pixels (as a wheel's deltas: down and right positive).
 */
export function aldoDrag(
  stage: AldoSize,
  page: AldoSize,
  place: AldoPlace,
  dx: number,
  dy: number,
): { place: AldoPlace; scroll: { x: number; y: number } } {
  const next = aldoPlace(stage, page, place.scale, place.left + dx, place.top + dy);
  return {
    place: next,
    scroll: {
      x: -(dx - (next.left - place.left)) / place.scale,
      y: -(dy - (next.top - place.top)) / place.scale,
    },
  };
}

/**
 * The page moved, if it has to, so `rect` (page pixels) shows in the stage: a
 * third of the way down, and centered across; one too big for that from its
 * start (its top left, where typing goes).
 */
export function aldoReveal(
  stage: AldoSize,
  page: AldoSize,
  place: AldoPlace,
  rect: { x: number; y: number; width: number; height: number },
): AldoPlace {
  const margin = 12;
  const { scale } = place;
  const left = place.left + rect.x * scale;
  const top = place.top + rect.y * scale;
  const width = rect.width * scale;
  const height = rect.height * scale;
  let nextLeft = place.left;
  if (left < 0 || left + width > stage.width) {
    nextLeft =
      width <= stage.width - 2 * margin
        ? stage.width / 2 - (rect.x + rect.width / 2) * scale
        : margin - rect.x * scale;
  }
  let nextTop = place.top;
  if (top < margin || top + height > stage.height - margin) {
    nextTop =
      height <= (stage.height * 2) / 3 - margin
        ? stage.height / 3 - rect.y * scale
        : margin - rect.y * scale;
  }
  return aldoPlace(stage, page, scale, nextLeft, nextTop);
}

/** The machine's report of the focused field (`{ type: "focus", field }`), or null for none or one it can't read. */
export function aldoFieldOf(value: unknown): AldoField | null {
  if (!value || typeof value !== "object") return null;
  const field = value as Record<string, unknown>;
  const number = (key: string) => (typeof field[key] === "number" ? (field[key] as number) : 0);
  const text = (key: string) => (typeof field[key] === "string" ? (field[key] as string) : "");
  return {
    x: number("x"),
    y: number("y"),
    width: number("width"),
    height: number("height"),
    frame: field.frame === true,
    type: text("type") || "text",
    inputMode: text("inputMode"),
    autocomplete: text("autocomplete"),
    enterKeyHint: text("enterKeyHint"),
    multiline: field.multiline === true,
  };
}

/** How the hidden field is set up for the phone's keyboard: the field's kind of keyboard, or none while there's no field. */
export interface AldoKeyboard {
  readonly type: "text" | "password";
  readonly inputMode: "none" | "text" | "numeric" | "decimal" | "tel" | "email" | "url" | "search";
  readonly autoComplete: string;
  readonly enterKeyHint: string;
}

const INPUT_MODES = new Set([
  "none",
  "text",
  "numeric",
  "decimal",
  "tel",
  "email",
  "url",
  "search",
]);

export function aldoKeyboardFor(field: AldoField | null): AldoKeyboard {
  if (!field) return { type: "text", inputMode: "none", autoComplete: "off", enterKeyHint: "" };
  const code = field.autocomplete.split(/\s+/).includes("one-time-code");
  const byType: Record<string, AldoKeyboard["inputMode"]> = {
    email: "email",
    url: "url",
    tel: "tel",
    number: "decimal",
    search: "search",
  };
  const mode = INPUT_MODES.has(field.inputMode)
    ? (field.inputMode as AldoKeyboard["inputMode"])
    : (byType[field.type] ?? (code ? "numeric" : "text"));
  return {
    // A password field keeps the phone's keyboard from learning or suggesting what's typed.
    type: field.type === "password" && !code ? "password" : "text",
    // Never the field's own mode "none": it's being typed in here.
    inputMode: mode === "none" ? "text" : mode,
    // The phone offers a code from its messages.
    autoComplete: code ? "one-time-code" : "off",
    enterKeyHint: field.enterKeyHint || (field.type === "search" ? "search" : ""),
  };
}

/**
 * What the hidden field starts with, and goes back to: a phone keyboard's
 * Backspace always has something to delete, and the space keeps its
 * corrections to the word being typed.
 */
export const ALDO_TYPING_PAD = `${"_".repeat(23)} `;

/**
 * What changed in the hidden field (which starts with the pad), as keys for
 * the page: backspaces, then text. A correction (a suggestion taken, a word
 * composed) that reaches into the pad replaces only what was typed; deleting
 * into it deletes in the page too.
 */
export function aldoTyped(
  before: string,
  after: string,
  deleting: boolean,
): { backspaces: number; text: string } {
  let same = 0;
  while (same < before.length && same < after.length && before[same] === after[same]) same++;
  const kept = deleting ? same : Math.max(same, Math.min(before.length, ALDO_TYPING_PAD.length));
  return { backspaces: Math.max(0, before.length - kept), text: after.slice(same) };
}
