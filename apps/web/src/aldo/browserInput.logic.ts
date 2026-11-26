// The Browser panel's input from a phone (AldoBrowserPage.tsx). The page is a
// picture, so the phone's own keyboard has nothing to open for: the machine
// says where the page's fields are and which has focus (`fields`), a tap on
// one focuses a hidden input of the panel's inside the tap (the only moment
// a phone opens its keyboard), and what's typed there is sent on as the
// difference from what it held before. That difference is what makes
// autocorrect, swipe typing and composition work: they rewrite words already
// typed, which arrives here as some backspaces and new text.

export interface AldoPageField {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Which field it is while its page lasts: the same after a scroll, another after Tab. */
  readonly id: string;
  /** An input's type, "textarea", or "rich" for editable text. */
  readonly kind: string;
  readonly inputMode: string;
  readonly enterKeyHint: string;
  readonly autoComplete: string;
  readonly autoCapitalize: string;
  /** Takes text as typed: a username, a code, an address. */
  readonly plain: boolean;
  /** Enter adds a line. */
  readonly multiline: boolean;
}

export interface AldoPageFields {
  readonly focus: AldoPageField | null;
  readonly fields: ReadonlyArray<AldoPageField>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

function parseField(value: unknown): AldoPageField | null {
  if (!value || typeof value !== "object") return null;
  const f = value as Record<string, unknown>;
  for (const side of ["x", "y", "width", "height"]) {
    if (typeof f[side] !== "number" || !Number.isFinite(f[side])) return null;
  }
  return {
    x: f.x as number,
    y: f.y as number,
    width: f.width as number,
    height: f.height as number,
    id: text(f.id),
    kind: text(f.kind),
    inputMode: text(f.inputMode),
    enterKeyHint: text(f.enterKeyHint),
    autoComplete: text(f.autoComplete),
    autoCapitalize: text(f.autoCapitalize),
    plain: f.plain === true,
    multiline: f.multiline === true,
  };
}

/** The machine's `fields` message. */
export function parseAldoPageFields(message: unknown): AldoPageFields {
  const m = (message ?? {}) as { focus?: unknown; fields?: unknown };
  return {
    focus: parseField(m.focus),
    fields: Array.isArray(m.fields)
      ? m.fields.map(parseField).filter((f): f is AldoPageField => f !== null)
      : [],
  };
}

/** The field a tap at this point of the page lands on: the smallest one there, a finger's slack around it. */
export function aldoFieldAt(
  fields: AldoPageFields,
  x: number,
  y: number,
  slack = 6,
): AldoPageField | null {
  let found: AldoPageField | null = null;
  for (const field of fields.focus ? [...fields.fields, fields.focus] : fields.fields) {
    if (
      x < field.x - slack ||
      y < field.y - slack ||
      x > field.x + field.width + slack ||
      y > field.y + field.height + slack
    ) {
      continue;
    }
    if (!found || field.width * field.height < found.width * found.height) found = field;
  }
  return found;
}

/** The keyboard a phone shows for a field: what its own page would have asked for. */
export interface AldoKeyboard {
  readonly type: "text" | "password";
  readonly inputMode: string;
  readonly enterKeyHint: string;
  readonly autoComplete: string;
  readonly autoCapitalize: string;
  readonly autoCorrect: boolean;
}

const INPUT_MODES = ["none", "text", "decimal", "numeric", "tel", "search", "email", "url"];
const KIND_MODES: Record<string, string> = {
  email: "email",
  url: "url",
  tel: "tel",
  search: "search",
  number: "decimal",
  date: "numeric",
  time: "numeric",
  "datetime-local": "numeric",
  month: "numeric",
  week: "numeric",
};
// "next" and "previous" would move the phone's own focus, not the page's.
const ENTER_HINTS = ["enter", "done", "go", "search", "send"];
// What the phone may offer from its own store: a texted code, the user's name and address. Never
// a saved sign-in: it would be this site's, not the page's.
const AUTOFILL = [
  "one-time-code",
  "email",
  "tel",
  "name",
  "given-name",
  "family-name",
  "organization",
  "street-address",
  "address-line1",
  "address-line2",
  "postal-code",
];
const CAPITALS = ["none", "sentences", "words", "characters"];

/** `field` null: a page whose fields the machine doesn't report, or focus it couldn't describe. */
export function aldoKeyboardFor(field: AldoPageField | null): AldoKeyboard {
  if (!field) {
    return {
      type: "text",
      inputMode: "text",
      enterKeyHint: "enter",
      autoComplete: "off",
      autoCapitalize: "none",
      autoCorrect: false,
    };
  }
  const password = field.kind === "password";
  const inputMode = INPUT_MODES.includes(field.inputMode)
    ? field.inputMode
    : (KIND_MODES[field.kind] ?? "text");
  const filled = field.autoComplete.split(/\s+/).at(-1) ?? "";
  const capitals = field.autoCapitalize === "off" ? "none" : field.autoCapitalize;
  return {
    type: password ? "password" : "text",
    inputMode: password ? "text" : inputMode,
    enterKeyHint: ENTER_HINTS.includes(field.enterKeyHint)
      ? field.enterKeyHint
      : field.multiline || field.enterKeyHint
        ? "enter"
        : inputMode === "search"
          ? "search"
          : "go",
    autoComplete: password
      ? "off"
      : AUTOFILL.includes(filled)
        ? filled
        : (["email", "tel"].find((kind) => kind === field.kind) ?? "off"),
    autoCapitalize:
      password || field.plain ? "none" : CAPITALS.includes(capitals) ? capitals : "sentences",
    autoCorrect: !password && !field.plain,
  };
}

export function aldoSameKeyboard(a: AldoKeyboard, b: AldoKeyboard): boolean {
  return (
    a.type === b.type &&
    a.inputMode === b.inputMode &&
    a.enterKeyHint === b.enterKeyHint &&
    a.autoComplete === b.autoComplete &&
    a.autoCapitalize === b.autoCapitalize &&
    a.autoCorrect === b.autoCorrect
  );
}

function characters(value: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    let count = 0;
    for (const _ of new Intl.Segmenter().segment(value)) count++;
    return count;
  }
  return Array.from(value).length;
}

/**
 * What turns the text a field held into what it holds now, typed at its end:
 * so many backspaces, then this text. "teh " corrected to "the " is three
 * backspaces and "he ".
 */
export function aldoTypingDiff(
  before: string,
  after: string,
): { backspaces: number; text: string } {
  let same = 0;
  const most = Math.min(before.length, after.length);
  while (same < most && before[same] === after[same]) same++;
  // Not through the middle of a character that takes two units (an emoji).
  const unit = same > 0 ? before.charCodeAt(same - 1) : 0;
  if (unit >= 0xd800 && unit <= 0xdbff) same--;
  return { backspaces: characters(before.slice(same)), text: after.slice(same) };
}

/**
 * What the input the phone's keyboard types into holds ahead of the text. On
 * Android a Backspace that finds the input empty says nothing at all (no key,
 * no input event), so there the input is never empty: it keeps a space, and
 * the Backspace that takes the space is heard.
 */
export const ALDO_TYPING_SEED =
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent) ? " " : "";

/**
 * What was typed into an input that keeps `seed` ahead of its text, and what
 * the input holds next (the seed back in place). A Backspace that took the
 * seed is one for the page. A seed that went with everything else, in text put
 * in the input's place whole (a password manager's fill), is not.
 */
export function aldoTyped(
  held: string,
  now: string,
  seed: string,
  deleting: boolean,
): { backspaces: number; text: string; value: string } {
  const kept = now.startsWith(seed);
  const before = !kept && !deleting && held.startsWith(seed) ? held.slice(seed.length) : held;
  return { ...aldoTypingDiff(before, now), value: kept ? now : seed + now };
}

type Message = Record<string, unknown>;

const KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
};

/** Whether a key is one the page takes as a key, not as text: Enter, Tab, the arrows. */
export function aldoIsPageKey(key: string): boolean {
  return key in KEY_CODES;
}

/** A key pressed and let go, as the machine's `key` messages. */
export function aldoKeyPress(key: string, modifiers = 0): Message[] {
  const letter = /^[a-z]$/i.test(key);
  const code =
    key in KEY_CODES
      ? key
      : letter
        ? `Key${key.toUpperCase()}`
        : /^[0-9]$/.test(key)
          ? `Digit${key}`
          : key === " "
            ? "Space"
            : "";
  const keyCode = KEY_CODES[key] ?? (code ? (letter ? key.toUpperCase() : key).charCodeAt(0) : 0);
  const typed = key === "Enter" ? "\r" : key.length === 1 ? key : "";
  const press = { type: "key", key, code, keyCode, modifiers };
  return [
    { ...press, event: "down", text: typed },
    { ...press, event: "up", text: typed },
  ];
}

/**
 * A typing difference as messages for the machine. A character at a time as
 * keys, which pages that listen for keys need (a code's boxes, a search as
 * you type); what isn't typed a key at a time (an emoji, a pasted paragraph)
 * as text.
 */
export function aldoTypingMessages(diff: { backspaces: number; text: string }): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < diff.backspaces; i++) messages.push(...aldoKeyPress("Backspace"));
  if (!diff.text) return messages;
  const keys = Array.from(diff.text);
  if (keys.length > 64 || keys.some((key) => key.length > 1 || key < " ")) {
    messages.push({ type: "text", text: diff.text });
  } else {
    for (const key of keys) messages.push(...aldoKeyPress(key));
  }
  return messages;
}

/** The biggest page a machine lays out for a panel. */
const WIDEST_FIT = 1280;
const TALLEST_FIT = 1600;

/**
 * The page size to ask a machine for, for a panel this big on a screen this dense: the panel's
 * own, or on one bigger than a machine lays out, a smaller one of its shape. The picture is then
 * shown bigger, and none of it is cut off.
 */
export function aldoFitFor(
  width: number,
  height: number,
  density: number,
): { width: number; height: number; scale: number } {
  const shrink = Math.min(1, WIDEST_FIT / width, TALLEST_FIT / height);
  return {
    width: Math.round(width * shrink),
    height: Math.round(height * shrink),
    scale: Math.min(2, Math.max(1, density / shrink)),
  };
}

/** The page's picture, zoomed under two fingers: its scale, and where its corner sits. */
export interface AldoLens {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const ALDO_NO_LENS: AldoLens = { scale: 1, x: 0, y: 0 };
const MOST_ZOOM = 5;

/** Two fingers: the point between them and how far apart they are, from the picture's own corner. */
export interface AldoPinch {
  readonly x: number;
  readonly y: number;
  readonly distance: number;
}

type LensBox = { width: number; height: number; viewWidth: number; viewHeight: number };

/** The picture never leaves an edge of its view bare. */
function lensWithin(scale: number, x: number, y: number, box: LensBox): AldoLens {
  const within = (value: number, least: number) => Math.min(0, Math.max(least, value));
  return {
    scale,
    x: within(x, Math.min(0, box.viewWidth - box.width * scale)),
    y: within(y, Math.min(0, box.viewHeight - box.height * scale)),
  };
}

/**
 * The lens as two fingers move: what was between them stays between them,
 * and one pinched back to its own size is let go.
 */
export function aldoPinchLens(
  start: AldoLens,
  from: AldoPinch,
  to: AldoPinch,
  box: LensBox,
): AldoLens {
  const scale = Math.min(
    MOST_ZOOM,
    Math.max(1, (start.scale * to.distance) / Math.max(1, from.distance)),
  );
  if (scale < 1.03) return ALDO_NO_LENS;
  return lensWithin(
    scale,
    to.x - ((from.x - start.x) / start.scale) * scale,
    to.y - ((from.y - start.y) / start.scale) * scale,
    box,
  );
}

/** The lens under one finger that moved this far: the picture goes with it, as far as its edges. */
export function aldoPanLens(start: AldoLens, dx: number, dy: number, box: LensBox): AldoLens {
  return lensWithin(start.scale, start.x + dx, start.y + dy, box);
}
