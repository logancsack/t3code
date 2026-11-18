import { expect, it, vi } from "vite-plus/test";
import {
  CUSTOM_THEMES_STORAGE_KEY,
  THEME_FILE_VERSION,
  getCustomThemes,
  installCustomTheme,
  invalidateCustomThemes,
  parseThemeFile,
} from "./themePalette";

it("refuses to overwrite a theme library that could not be read", () => {
  const setItem = vi.fn();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem,
    },
  });

  try {
    invalidateCustomThemes();
    expect(getCustomThemes()).toEqual([]);
    expect(() =>
      installCustomTheme(
        parseThemeFile({
          version: THEME_FILE_VERSION,
          id: "aurora",
          name: "Aurora",
          appearance: "light",
          colors: { accent: "#5b6cff" },
        }),
      ),
    ).toThrow(`Failed to read the theme library from ${CUSTOM_THEMES_STORAGE_KEY}.`);
    expect(setItem).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    invalidateCustomThemes();
  }
});
