import { expect, it, vi } from "vite-plus/test";

import { createProjectFaviconImageLoader } from "./projectFaviconCache.ts";

it("bounds remote favicon reads and cancels oversized streams before rasterizing", async () => {
  let pulled = 0;
  const cancel = vi.fn();
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
        // A broken reader fails with a finite fixture rather than exhausting CI memory.
        if (pulled === 8) controller.close();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const downscale = vi.fn(async () => "data:image/png;base64,aWNvbg==");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response("icon", { headers: { "content-type": "image/png" } }))
    .mockResolvedValueOnce(new Response(stream, { headers: { "content-type": "image/png" } }))
    .mockResolvedValueOnce(
      new Response("icon", {
        headers: { "content-type": "image/png", "content-length": String(2 ** 40) },
      }),
    );
  const load = createProjectFaviconImageLoader({ fetch, downscale });
  const url = "https://remote.test/api/assets/token/icon.png";
  const signal = new AbortController().signal;

  await expect(load(url, signal)).resolves.toBe("data:image/png;base64,aWNvbg==");
  await expect(load(url, signal)).rejects.toThrow("too large");
  expect(pulled).toBe(5);
  expect(cancel).toHaveBeenCalledOnce();
  await expect(load(url, signal)).rejects.toThrow("too large");
  expect(downscale).not.toHaveBeenCalled();
});
