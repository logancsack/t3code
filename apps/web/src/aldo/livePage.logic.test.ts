import { expect, it } from "vite-plus/test";

import {
  ALDO_TYPING_PAD,
  aldoDoubleTapScale,
  aldoDrag,
  aldoFieldOf,
  aldoFitScale,
  aldoKeyboardFor,
  aldoPlace,
  aldoReveal,
  aldoTyped,
  aldoTypingScale,
  aldoZoomAt,
} from "./livePage.logic";

// A desktop page on a phone, and the page in Phone view.
const phone = { width: 390, height: 700 };
const desktopPage = { width: 1280, height: 720 };
const phonePage = { width: 390, height: 844 };

it("fits the whole page, never past the frames' own size", () => {
  expect(aldoFitScale(phone, desktopPage)).toBeCloseTo(390 / 1280);
  expect(aldoFitScale(phone, phonePage)).toBeCloseTo(700 / 844);
  expect(aldoFitScale({ width: 2000, height: 1200 }, desktopPage, 1)).toBe(1);
  expect(aldoFitScale(phone, { width: 0, height: 0 })).toBe(1);
});

it("centers a page narrower than the stage and keeps it at the top", () => {
  const fit = aldoFitScale(phone, phonePage);
  const place = aldoPlace(phone, phonePage, fit, 50, 80);
  expect(place.left).toBeCloseTo((390 - 390 * fit) / 2);
  expect(place.top).toBe(0);
});

it("never leaves a gap at an edge a zoomed page overflows", () => {
  expect(aldoPlace(phone, desktopPage, 1, 40, 30)).toEqual({ scale: 1, left: 0, top: 0 });
  expect(aldoPlace(phone, desktopPage, 1, -5000, -5000)).toEqual({
    scale: 1,
    left: 390 - 1280,
    top: 700 - 720,
  });
});

it("zooms about the fingers, within the fit and the most", () => {
  const fit = aldoFitScale(phone, desktopPage);
  const start = aldoPlace(phone, desktopPage, fit, 0, 0);
  const zoomed = aldoZoomAt(phone, desktopPage, start, fit, fit * 2, { x: 195, y: 100 });
  // The page point that was under the fingers still is.
  const before = (195 - start.left) / start.scale;
  expect((195 - zoomed.left) / zoomed.scale).toBeCloseTo(before);
  expect(aldoZoomAt(phone, desktopPage, zoomed, fit, 0.01, { x: 0, y: 0 }).scale).toBe(fit);
  expect(aldoZoomAt(phone, desktopPage, zoomed, fit, 99, { x: 0, y: 0 }).scale).toBe(1.5);
});

it("moves a zoomed page with the finger first, and scrolls the page with what's left", () => {
  const place = aldoPlace(phone, desktopPage, 1, 0, -10);
  // Up 30: the page moves the 10 it has below, and scrolls 20 more.
  const up = aldoDrag(phone, desktopPage, place, 0, -30);
  expect(up.place.top).toBe(-20);
  expect(up.scroll.y).toBeCloseTo(20);
  // At the fit, all of it scrolls the page, in its own pixels.
  const fit = aldoFitScale(phone, desktopPage);
  const atFit = aldoDrag(phone, desktopPage, aldoPlace(phone, desktopPage, fit, 0, 0), -10, 40);
  expect(atFit.place.top).toBe(0);
  expect(atFit.scroll.x).toBeCloseTo(10 / fit);
  expect(atFit.scroll.y).toBeCloseTo(-40 / fit);
});

it("types at the page's own size at least", () => {
  const fit = aldoFitScale(phone, desktopPage);
  expect(aldoTypingScale(fit, fit)).toBe(1);
  expect(aldoTypingScale(1.4, fit)).toBe(1.4);
  expect(aldoDoubleTapScale(fit, fit)).toBe(1);
  expect(aldoDoubleTapScale(1, fit)).toBe(fit);
});

it("brings a field into view a third of the way down, and leaves one in view alone", () => {
  const stage = { width: 390, height: 360 };
  const place = aldoPlace(stage, desktopPage, 1, 0, 0);
  const field = { x: 500, y: 400, width: 300, height: 36 };
  const shown = aldoReveal(stage, desktopPage, place, field);
  expect(shown.top + field.y).toBeCloseTo(120);
  expect(shown.left + field.x + field.width / 2).toBeCloseTo(195);
  const visible = { x: 20, y: 40, width: 200, height: 36 };
  expect(aldoReveal(stage, desktopPage, place, visible)).toEqual(place);
  // Wider than the stage: its start shows, where the typing goes.
  const wide = { x: 300, y: 100, width: 600, height: 36 };
  expect(aldoReveal(stage, desktopPage, place, wide).left + wide.x).toBe(12);
});

it("reads the machine's focus reports, and nothing else", () => {
  expect(aldoFieldOf(null)).toBeNull();
  expect(aldoFieldOf("input")).toBeNull();
  expect(
    aldoFieldOf({ x: 1, y: 2, width: 3, height: 4, type: "email", autocomplete: "username" }),
  ).toMatchObject({ x: 1, type: "email", frame: false, multiline: false });
  expect(aldoFieldOf({ frame: true, x: 0, y: 0, width: 10, height: 10 })).toMatchObject({
    frame: true,
    type: "text",
  });
});

it("asks the phone for the keyboard the field takes", () => {
  const field = (extra: Record<string, unknown>) =>
    aldoFieldOf({ x: 0, y: 0, width: 100, height: 30, ...extra });
  expect(aldoKeyboardFor(null).inputMode).toBe("none");
  expect(aldoKeyboardFor(field({ type: "email" })).inputMode).toBe("email");
  expect(aldoKeyboardFor(field({ type: "password" })).type).toBe("password");
  expect(aldoKeyboardFor(field({ type: "text", inputMode: "numeric" })).inputMode).toBe("numeric");
  expect(aldoKeyboardFor(field({ type: "text", inputMode: "none" })).inputMode).toBe("text");
  const code = aldoKeyboardFor(field({ type: "text", autocomplete: "one-time-code" }));
  expect(code).toMatchObject({ inputMode: "numeric", autoComplete: "one-time-code" });
  expect(aldoKeyboardFor(field({ type: "search" })).enterKeyHint).toBe("search");
});

it("turns what the phone's keyboard did into keys", () => {
  const pad = ALDO_TYPING_PAD;
  expect(aldoTyped(pad, `${pad}a`, false)).toEqual({ backspaces: 0, text: "a" });
  expect(aldoTyped(`${pad}hi`, `${pad}h`, true)).toEqual({ backspaces: 1, text: "" });
  // Backspace with nothing typed yet: the pad has something to delete.
  expect(aldoTyped(pad, pad.slice(0, -1), true)).toEqual({ backspaces: 1, text: "" });
  // A correction replaces what it changed.
  expect(aldoTyped(`${pad}teh`, `${pad}the `, false)).toEqual({ backspaces: 2, text: "he " });
  // One that reaches into the pad replaces only what was typed.
  expect(aldoTyped(`${pad}ok`, `${pad.slice(0, -1)}Okay`, false)).toEqual({
    backspaces: 2,
    text: "Okay",
  });
});
