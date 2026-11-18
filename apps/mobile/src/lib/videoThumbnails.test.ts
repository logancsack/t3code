import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ createPlayer: vi.fn() }));
vi.mock("expo-video", () => ({ createVideoPlayer: mocks.createPlayer }));

it("times out a stalled environment, releases its resources and drains the queued environment", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const controller = new AbortController();
  const replaced = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const frame = { width: 480, height: 270 };
  const first = {
    replaceAsync: vi.fn(() => {
      started.resolve();
      return replaced.promise;
    }),
    generateThumbnailsAsync: vi.fn(async () => [frame]),
    release: vi.fn(),
  };
  const second = {
    replaceAsync: vi.fn(async () => {}),
    generateThumbnailsAsync: vi.fn(async () => [frame]),
    release: vi.fn(),
  };
  mocks.createPlayer.mockReset().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const file = { uri: "https://unreachable.example/clip.mp4", dispose: vi.fn() };
  const nextFile = { uri: "https://reachable.example/clip.mp4", dispose: vi.fn() };
  const nextSource = vi.fn(async () => nextFile);
  try {
    const { loadVideoThumbnail, cachedVideoThumbnail } = await import("./videoThumbnails");
    const request = loadVideoThumbnail("env-a:clip", async () => file, controller.signal);
    await started.promise;
    const nextRequest = loadVideoThumbnail("env-b:clip", nextSource, controller.signal);
    expect(nextSource).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(first.release).not.toHaveBeenCalled();
    expect(nextSource).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    // Assert cleanup before awaiting, so losing the timeout fails without hanging.
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(file.dispose).toHaveBeenCalledTimes(1);
    expect(await request).toBeNull();
    expect(await nextRequest).toBe(frame);
    expect(nextFile.dispose).toHaveBeenCalledTimes(1);
    expect(second.release).toHaveBeenCalledTimes(1);
    replaced.resolve();
    await replaced.promise;
    expect(first.generateThumbnailsAsync).not.toHaveBeenCalled();
    expect(cachedVideoThumbnail("env-a:clip")).toBeNull();
    expect(cachedVideoThumbnail("env-b:clip")).toBe(frame);
  } finally {
    controller.abort();
    replaced.resolve();
    vi.useRealTimers();
  }
});
