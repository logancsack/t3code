import { describe, expect, it } from "vite-plus/test";
import {
  BUILT_IN_THEMES,
  T3_CODE_LIGHT_THEME_COLORS,
  T3_CODE_DARK_THEME_COLORS,
} from "@t3tools/shared/themePalettes";
import { frameComposite, frameContrast, framePaint, frameRgb } from "./frame.logic";

describe("Open Frame contrast", () => {
  it("keeps the dimmest frame above 3:1 on every built-in surface and midtone custom colors", () => {
    const palettes = [
      T3_CODE_LIGHT_THEME_COLORS,
      T3_CODE_DARK_THEME_COLORS,
      ...BUILT_IN_THEMES.flatMap((t) => [t.colors, ...Object.values(t.variants ?? {})]),
    ];
    const surfaces = palettes.flatMap((p) => [
      p.canvas,
      p.surface,
      p.sidebar,
      p.sidebarRowHover,
      p.surfaceOverlay,
    ]);
    surfaces.push(...Array.from({ length: 256 }, (_, n) => `rgb(${n} ${n} ${n})`));
    for (const value of surfaces) {
      const background = frameRgb(value)!;
      const paint = framePaint(background);
      const ink = frameRgb(paint.color)!;
      const dimmest = frameComposite([...ink.slice(0, 3), paint.floor * paint.low], background);
      expect(frameContrast(dimmest, background), value).toBeGreaterThanOrEqual(3.1);
    }
  });
  it("accounts for translucent surfaces before choosing the ink", () => {
    const white = frameRgb("#fff")!;
    const black = frameRgb("rgb(0 0 0 / 50%)")!;
    expect(frameComposite(black, white)).toEqual([0.5, 0.5, 0.5]);
  });
});
