import { describe, expect, it } from "vite-plus/test";

import { buildLensMaps, LENS_CONTROL, lensFilterMarkup } from "./prismGlass";

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const o = (y * width + x) * 4;
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!] as const;
}

describe("Prism lens maps", () => {
  const maps = buildLensMaps(200, 80, 40, LENS_CONTROL);

  it("leaves the middle untouched and pulls the rim toward the centre", () => {
    const centre = pixel(maps.map, maps.width, 100, 40);
    expect(centre[0]).toBe(128);
    expect(centre[1]).toBe(128);
    // At the right edge the eye sees inner content: the sample moves left.
    const right = pixel(maps.map, maps.width, maps.width - 1, 40);
    expect(right[0]).toBeLessThan(120);
    expect(right[1]).toBe(128);
    // And at the bottom edge it moves up.
    const bottom = pixel(maps.map, maps.width, 100, maps.height - 1);
    expect(bottom[0]).toBe(128);
    expect(bottom[1]).toBeLessThan(120);
    expect(maps.scale).toBe(LENS_CONTROL.shift);
  });

  it("lights the rim from the upper left, with a fainter answer at the lower right", () => {
    const top = pixel(maps.rim, maps.width, 100, 1)[3];
    const bottom = pixel(maps.rim, maps.width, 100, maps.height - 2)[3];
    const centre = pixel(maps.rim, maps.width, 100, 40)[3];
    expect(top).toBeGreaterThan(bottom);
    expect(bottom).toBeGreaterThan(0);
    expect(centre).toBe(0);
  });

  it("caps the map's resolution for big panels and keeps the lens thin on small controls", () => {
    const sheet = buildLensMaps(400, 900, 28, LENS_CONTROL);
    expect(sheet.width * sheet.height).toBeLessThanOrEqual(160_000);
    const button = buildLensMaps(28, 28, 14, LENS_CONTROL);
    expect(button.width).toBe(28);
    // A 28px circle still has an untouched centre.
    expect(pixel(button.map, 28, 14, 14)[0]).toBe(128);
  });

  it("splits the channels only when chroma is on", () => {
    expect(lensFilterMarkup("f", 10, 10, "data:,", 18, 0).match(/feDisplacementMap/g)).toHaveLength(
      1,
    );
    expect(lensFilterMarkup("f", 10, 10, "data:,", 18, 1).match(/feDisplacementMap/g)).toHaveLength(
      3,
    );
  });
});
