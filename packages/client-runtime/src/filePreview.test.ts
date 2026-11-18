import { expect, it } from "vite-plus/test";
import { FILE_TEXT_PREVIEW_MAX_BYTES } from "@t3tools/shared/filePreview";
import { readFilePreviewResponse } from "./filePreview.ts";

it("bounds remote preview reads and cancels a response that ignores its range", async () => {
  const signal = new AbortController().signal;
  await expect(readFilePreviewResponse(new Response("small text"), signal)).resolves.toEqual({
    text: "small text",
    truncated: false,
  });
  let pulls = 0;
  let cancelled = false;
  // Finite fallback keeps a broken implementation from allocating forever.
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        if (pulls > 4) controller.close();
        else controller.enqueue(new Uint8Array(FILE_TEXT_PREVIEW_MAX_BYTES).fill(97));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const result = await readFilePreviewResponse(new Response(body), signal);
  expect(result).toEqual({ text: "a".repeat(FILE_TEXT_PREVIEW_MAX_BYTES), truncated: true });
  expect(pulls).toBe(2);
  expect(cancelled).toBe(true);
});
