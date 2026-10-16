import { expect, it } from "vite-plus/test";

import { parseBase64DataUrl } from "./imageMime.ts";

it("parses a large image near the stack limit without matching its payload with a regex", () => {
  const payload = "A".repeat(14_000_000);
  const dataUrl = `data:image/png;base64,${payload}`;
  const atDepth = (depth: number): ReturnType<typeof parseBase64DataUrl> =>
    depth === 0 ? parseBase64DataUrl(dataUrl) : atDepth(depth - 1);
  const findMaxDepth = (depth: number): number => {
    try {
      return findMaxDepth(depth + 1);
    } catch {
      return depth;
    }
  };
  expect(atDepth(Math.floor(findMaxDepth(0) * 0.85))).toEqual({
    mimeType: "image/png",
    base64: payload,
  });
});
