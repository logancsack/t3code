import { afterEach, expect, it, vi } from "vite-plus/test";
import { ALDO_READ_ANSWERS_WITHIN_MS, api } from "./api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const encode = (text: string) => new TextEncoder().encode(text);

/** Fails the way a request does once its signal is aborted. */
function onAbort(init: RequestInit | undefined, fail: (error: unknown) => void): void {
  init?.signal?.addEventListener("abort", () =>
    fail(new DOMException("This operation was aborted", "AbortError")),
  );
}

it("a read on a connection that died fails once Aldo is overdue, as one that couldn't reach it", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => onAbort(init, reject)),
    ),
  );
  const read = api("/api/home", { answersWithin: ALDO_READ_ANSWERS_WITHIN_MS });
  const failed = expect(read).rejects.toThrow(new TypeError("Aldo didn't answer in time."));
  await vi.advanceTimersByTimeAsync(ALDO_READ_ANSWERS_WITHIN_MS);
  await failed;
});

it("an answer that has begun takes as long as it takes, on a slow network too", async () => {
  vi.useFakeTimers();
  let finish = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encode('{"conversations":'));
          onAbort(init, (error) => controller.error(error));
          finish = () => {
            controller.enqueue(encode("[]}"));
            controller.close();
          };
        },
      });
      return new Response(body);
    }),
  );
  const read = api("/api/home", { answersWithin: ALDO_READ_ANSWERS_WITHIN_MS });
  await vi.advanceTimersByTimeAsync(3 * ALDO_READ_ANSWERS_WITHIN_MS);
  finish();
  await expect(read).resolves.toEqual({ conversations: [] });
});

it("an answer cut off midway fails rather than reading as an empty one", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encode('{"conversations":['));
          controller.error(new TypeError("network error"));
        },
      });
      return new Response(body);
    }),
  );
  await expect(api("/api/home")).rejects.toThrow(TypeError);
});

it("an answer with no body still reads as an empty one", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  await expect(api("/api/environments/t/touch", { method: "POST" })).resolves.toEqual({});
});
