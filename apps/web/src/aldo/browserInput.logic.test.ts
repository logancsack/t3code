import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_NO_LENS,
  aldoFieldAt,
  aldoFitFor,
  aldoIsPageKey,
  aldoKeyboardFor,
  aldoKeyPress,
  aldoPanLens,
  aldoPinchLens,
  aldoSameKeyboard,
  aldoTyped,
  aldoTypingDiff,
  aldoTypingMessages,
  parseAldoPageFields,
  type AldoPageField,
} from "./browserInput.logic";

const field = (more: Partial<AldoPageField> = {}): AldoPageField => ({
  x: 20,
  y: 100,
  width: 300,
  height: 48,
  id: "a:1",
  kind: "text",
  inputMode: "",
  enterKeyHint: "",
  autoComplete: "",
  autoCapitalize: "",
  plain: false,
  multiline: false,
  ...more,
});

describe("the page's fields", () => {
  it("reads the machine's message, and nothing else's", () => {
    const read = parseAldoPageFields({
      type: "fields",
      focus: { ...field(), value: "hunter2" },
      fields: [field(), null, { x: "1" }, field({ id: "a:2", y: 200 })],
    });
    expect(read.focus).toEqual(field());
    expect(read.fields.map((f) => f.id)).toEqual(["a:1", "a:2"]);
    expect(parseAldoPageFields(null)).toEqual({ focus: null, fields: [] });
    expect(parseAldoPageFields({ focus: "x", fields: "y" })).toEqual({ focus: null, fields: [] });
  });

  it("finds the field under a finger: a little slack, and the inner of two", () => {
    const search = field({ id: "search", x: 0, y: 0, width: 390, height: 300 });
    const code = field({ id: "code", x: 40, y: 120, width: 60, height: 48 });
    const fields = { focus: null, fields: [search, code] };
    expect(aldoFieldAt(fields, 60, 140)?.id).toBe("code");
    expect(aldoFieldAt(fields, 36, 116)?.id).toBe("code");
    expect(aldoFieldAt(fields, 200, 20)?.id).toBe("search");
    expect(aldoFieldAt(fields, 200, 320)).toBeNull();
    // The focused field counts when it's not among the rest (one in a frame the machine couldn't place).
    expect(aldoFieldAt({ focus: code, fields: [] }, 60, 140)?.id).toBe("code");
  });
});

describe("the keyboard for a field", () => {
  it("is the one its page would have asked a phone for", () => {
    expect(
      aldoKeyboardFor(field({ kind: "email", plain: true, autoComplete: "username" })),
    ).toEqual({
      type: "text",
      inputMode: "email",
      enterKeyHint: "go",
      autoComplete: "email",
      autoCapitalize: "none",
      autoCorrect: false,
    });
    expect(
      aldoKeyboardFor(field({ inputMode: "numeric", autoComplete: "one-time-code", plain: true })),
    ).toMatchObject({ inputMode: "numeric", autoComplete: "one-time-code", autoCorrect: false });
    expect(aldoKeyboardFor(field({ kind: "textarea", multiline: true }))).toMatchObject({
      enterKeyHint: "enter",
      autoCapitalize: "sentences",
      autoCorrect: true,
    });
    expect(aldoKeyboardFor(field({ kind: "search" }))).toMatchObject({
      inputMode: "search",
      enterKeyHint: "search",
    });
    expect(aldoKeyboardFor(field({ kind: "number" })).inputMode).toBe("decimal");
    expect(aldoKeyboardFor(field({ autoComplete: "shipping postal-code" })).autoComplete).toBe(
      "postal-code",
    );
    expect(aldoKeyboardFor(field({ autoCapitalize: "words" })).autoCapitalize).toBe("words");
  });

  it("keeps a password out of the phone's dictionary and its saved sign-ins", () => {
    expect(
      aldoKeyboardFor(field({ kind: "password", autoComplete: "current-password", plain: true })),
    ).toEqual({
      type: "password",
      inputMode: "text",
      enterKeyHint: "go",
      autoComplete: "off",
      autoCapitalize: "none",
      autoCorrect: false,
    });
    expect(aldoKeyboardFor(field({ autoComplete: "username" })).autoComplete).toBe("off");
  });

  it("never asks the phone to move its own focus", () => {
    expect(aldoKeyboardFor(field({ enterKeyHint: "next" })).enterKeyHint).toBe("enter");
    expect(aldoKeyboardFor(field({ enterKeyHint: "send" })).enterKeyHint).toBe("send");
  });

  it("is a plain one where the field isn't known", () => {
    expect(aldoKeyboardFor(null)).toMatchObject({ type: "text", autoCorrect: false });
    expect(aldoSameKeyboard(aldoKeyboardFor(null), aldoKeyboardFor(null))).toBe(true);
    expect(
      aldoSameKeyboard(aldoKeyboardFor(field()), aldoKeyboardFor(field({ kind: "password" }))),
    ).toBe(false);
  });
});

describe("typing as a difference", () => {
  it("is what was added at the end", () => {
    expect(aldoTypingDiff("", "h")).toEqual({ backspaces: 0, text: "h" });
    expect(aldoTypingDiff("hel", "hello ")).toEqual({ backspaces: 0, text: "lo " });
    expect(aldoTypingDiff("same", "same")).toEqual({ backspaces: 0, text: "" });
  });

  it("is backspaces for what went", () => {
    expect(aldoTypingDiff("hello", "hell")).toEqual({ backspaces: 1, text: "" });
    expect(aldoTypingDiff("hello world", "hello ")).toEqual({ backspaces: 5, text: "" });
  });

  it("rewrites a corrected word", () => {
    expect(aldoTypingDiff("teh ", "the ")).toEqual({ backspaces: 3, text: "he " });
    expect(aldoTypingDiff("its  ", "its. ")).toEqual({ backspaces: 2, text: ". " });
    // Composition: letters typed, then the word they stood for.
    expect(aldoTypingDiff("ni", "你")).toEqual({ backspaces: 2, text: "你" });
  });

  it("retypes what follows a change in the middle", () => {
    expect(aldoTypingDiff("hello world", "helloX world")).toEqual({
      backspaces: 6,
      text: "X world",
    });
  });

  it("counts an emoji as one character, and never splits one", () => {
    expect(aldoTypingDiff("ok 👍", "ok ")).toEqual({ backspaces: 1, text: "" });
    // 👍 and 👎 share their first half.
    expect(aldoTypingDiff("👍", "👎")).toEqual({ backspaces: 1, text: "👎" });
  });
});

describe("an input that is never empty (Android says nothing of a Backspace that finds one empty)", () => {
  it("types after the space it keeps", () => {
    expect(aldoTyped(" ", " a", " ", false)).toEqual({ backspaces: 0, text: "a", value: " a" });
    expect(aldoTyped(" teh ", " the ", " ", false)).toEqual({
      backspaces: 3,
      text: "he ",
      value: " the ",
    });
    expect(aldoTyped(" ab", " a", " ", true)).toEqual({ backspaces: 1, text: "", value: " a" });
  });

  it("hears the Backspace that takes the space, and puts the space back", () => {
    expect(aldoTyped(" ", "", " ", true)).toEqual({ backspaces: 1, text: "", value: " " });
    // A word deleted whole, the space with it: one more for the page than was here.
    expect(aldoTyped(" ab", "", " ", true)).toEqual({ backspaces: 3, text: "", value: " " });
  });

  it("doesn't take text put in the input's place whole for a Backspace", () => {
    expect(aldoTyped(" ", "ada@example.com", " ", false)).toEqual({
      backspaces: 0,
      text: "ada@example.com",
      value: " ada@example.com",
    });
    expect(aldoTyped(" ad", "ada@example.com", " ", false)).toEqual({
      backspaces: 0,
      text: "a@example.com",
      value: " ada@example.com",
    });
  });

  it("is the plain difference where nothing is kept (every other keyboard)", () => {
    expect(aldoTyped("", "a", "", false)).toEqual({ backspaces: 0, text: "a", value: "a" });
    expect(aldoTyped("ab", "", "", true)).toEqual({ backspaces: 2, text: "", value: "" });
  });
});

describe("what's typed, for the machine", () => {
  it("presses a key at a time, each down and up", () => {
    expect(aldoTypingMessages({ backspaces: 0, text: "a1 " })).toEqual([
      { type: "key", event: "down", key: "a", code: "KeyA", keyCode: 65, text: "a", modifiers: 0 },
      { type: "key", event: "up", key: "a", code: "KeyA", keyCode: 65, text: "a", modifiers: 0 },
      {
        type: "key",
        event: "down",
        key: "1",
        code: "Digit1",
        keyCode: 49,
        text: "1",
        modifiers: 0,
      },
      { type: "key", event: "up", key: "1", code: "Digit1", keyCode: 49, text: "1", modifiers: 0 },
      { type: "key", event: "down", key: " ", code: "Space", keyCode: 32, text: " ", modifiers: 0 },
      { type: "key", event: "up", key: " ", code: "Space", keyCode: 32, text: " ", modifiers: 0 },
    ]);
    expect(aldoTypingMessages({ backspaces: 0, text: "@" })[0]).toMatchObject({
      key: "@",
      code: "",
      keyCode: 0,
      text: "@",
    });
  });

  it("backspaces first, then types", () => {
    const messages = aldoTypingMessages({ backspaces: 2, text: "he" });
    expect(messages.map((m) => `${String(m.key)}:${String(m.event)}`)).toEqual([
      "Backspace:down",
      "Backspace:up",
      "Backspace:down",
      "Backspace:up",
      "h:down",
      "h:up",
      "e:down",
      "e:up",
    ]);
    expect(messages[0]).toMatchObject({ code: "Backspace", keyCode: 8, text: "" });
  });

  it("sends as text what isn't typed a key at a time", () => {
    expect(aldoTypingMessages({ backspaces: 0, text: "👍" })).toEqual([
      { type: "text", text: "👍" },
    ]);
    expect(aldoTypingMessages({ backspaces: 0, text: "two\nlines" })).toEqual([
      { type: "text", text: "two\nlines" },
    ]);
    expect(aldoTypingMessages({ backspaces: 0, text: "x".repeat(65) })).toHaveLength(1);
    expect(aldoTypingMessages({ backspaces: 0, text: "" })).toEqual([]);
  });

  it("presses Enter as the page expects it", () => {
    expect(aldoKeyPress("Enter", 8)).toEqual([
      {
        type: "key",
        event: "down",
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        text: "\r",
        modifiers: 8,
      },
      {
        type: "key",
        event: "up",
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        text: "\r",
        modifiers: 8,
      },
    ]);
    expect(aldoKeyPress("ArrowLeft")[0]).toMatchObject({ keyCode: 37, text: "" });
    expect(aldoIsPageKey("Tab")).toBe(true);
    expect(aldoIsPageKey("a")).toBe(false);
  });
});

describe("the page size a panel asks for", () => {
  it("is the panel's own on a phone, twice as sharp where the screen is", () => {
    expect(aldoFitFor(390, 664, 3)).toEqual({ width: 390, height: 664, scale: 2 });
    expect(aldoFitFor(412, 300, 1)).toEqual({ width: 412, height: 300, scale: 1 });
  });

  it("keeps the panel's shape on one wider than a machine lays out, so none of the page is cut off", () => {
    expect(aldoFitFor(1440, 784, 1)).toEqual({ width: 1280, height: 697, scale: 1.125 });
    expect(aldoFitFor(1920, 1000, 2)).toEqual({ width: 1280, height: 667, scale: 2 });
  });

  it("and on one taller", () => {
    expect(aldoFitFor(1000, 2000, 1)).toEqual({ width: 800, height: 1600, scale: 1.25 });
  });
});

describe("the lens under two fingers", () => {
  const box = { width: 390, height: 600, viewWidth: 390, viewHeight: 600 };

  it("keeps what was between the fingers between them", () => {
    const lens = aldoPinchLens(
      ALDO_NO_LENS,
      { x: 200, y: 300, distance: 100 },
      { x: 200, y: 300, distance: 200 },
      box,
    );
    expect(lens).toEqual({ scale: 2, x: -200, y: -300 });
    // The same point of the picture, under the same point of the screen.
    expect((200 - lens.x) / lens.scale).toBe(200);
  });

  it("moves with the fingers, and never past the picture's edges", () => {
    const zoomed = { scale: 2, x: -200, y: -300 };
    const dragged = aldoPinchLens(
      zoomed,
      { x: 200, y: 300, distance: 100 },
      { x: 260, y: 300, distance: 100 },
      box,
    );
    expect(dragged).toEqual({ scale: 2, x: -140, y: -300 });
    const far = aldoPinchLens(
      zoomed,
      { x: 200, y: 300, distance: 100 },
      { x: 2000, y: -2000, distance: 100 },
      box,
    );
    expect(far).toEqual({ scale: 2, x: 0, y: -600 });
  });

  it("goes with one finger, as far as its edges", () => {
    const zoomed = { scale: 2, x: -200, y: -300 };
    expect(aldoPanLens(zoomed, 50, -20, box)).toEqual({ scale: 2, x: -150, y: -320 });
    // At its top already: a finger pulling down moves nothing, and the page is what scrolls.
    expect(aldoPanLens({ scale: 2, x: -200, y: 0 }, 0, 80, box)).toEqual({
      scale: 2,
      x: -200,
      y: 0,
    });
    expect(aldoPanLens(zoomed, -5000, -5000, box)).toEqual({ scale: 2, x: -390, y: -600 });
  });

  it("stays in a view that got smaller under it (the keyboard came up)", () => {
    // At the foot of a 600 tall page; the page and its room are then 250 tall, and all of it would be above them.
    const atFoot = { scale: 2, x: -390, y: -600 };
    const short = { width: 390, height: 250, viewWidth: 390, viewHeight: 250 };
    expect(aldoPanLens(atFoot, 0, 0, short)).toEqual({ scale: 2, x: -390, y: -250 });
    // One that's inside its view already is left where it is.
    expect(aldoPanLens({ scale: 2, x: -100, y: -100 }, 0, 0, short)).toEqual({
      scale: 2,
      x: -100,
      y: -100,
    });
  });

  it("stops at five times, and lets go at its own size", () => {
    expect(
      aldoPinchLens(ALDO_NO_LENS, { x: 0, y: 0, distance: 10 }, { x: 0, y: 0, distance: 1000 }, box)
        .scale,
    ).toBe(5);
    expect(
      aldoPinchLens(
        { scale: 2, x: -200, y: -300 },
        { x: 200, y: 300, distance: 200 },
        { x: 200, y: 300, distance: 90 },
        box,
      ),
    ).toBe(ALDO_NO_LENS);
  });
});
