import { describe, expect, it } from "vite-plus/test";

import { takePickedFiles } from "./composerFilePicker";

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

describe("taking files from the composer picker", () => {
  it("returns what was picked", () => {
    const input = { files: [png("shot.png")], value: "C:\\fakepath\\shot.png" };
    expect(takePickedFiles(input).map((file) => file.name)).toEqual(["shot.png"]);
  });

  it("returns every file when several are picked at once", () => {
    const input = { files: [png("a.png"), png("b.png")], value: "x" };
    expect(takePickedFiles(input)).toHaveLength(2);
  });

  it("clears the input so the same file can be picked twice", () => {
    // A browser fires no change event when the value is unchanged, so leaving it
    // set makes re-attaching the same screenshot look like a broken button.
    const input = { files: [png("shot.png")], value: "C:\\fakepath\\shot.png" };
    takePickedFiles(input);
    expect(input.value).toBe("");
  });

  it("clears the input even when the pick was cancelled", () => {
    const input = { files: [], value: "stale" };
    expect(takePickedFiles(input)).toEqual([]);
    expect(input.value).toBe("");
  });

  it("treats a null file list as nothing picked", () => {
    const input = { files: null, value: "stale" };
    expect(takePickedFiles(input)).toEqual([]);
    expect(input.value).toBe("");
  });
});
