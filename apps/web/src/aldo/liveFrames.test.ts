import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const connection = vi.fn();
const api = vi.fn();
vi.mock("./workspaceApi", () => ({ aldoBrowserConnection: (id: string) => connection(id) }));
vi.mock("./api", () => ({
  api: (path: string) => api(path),
  threadIdForEnvironment: (id: string) => `t-${id}`,
}));

const { aldoLiveFrames } = await import("./liveFrames");

const target = { environmentId: "env", threadId: "thread" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        return Promise.resolve();
      }
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  connection.mockReset();
  api.mockReset();
});

it("takes the browser's stills at the view's width and pace, with the machine's link asked for once", async () => {
  connection.mockResolvedValue({
    url: "wss://m/browser",
    desktopUrl: "wss://m/desktop",
    stillUrl: "https://m/still?token=t",
  });
  const frames: string[] = [];
  const stop = aldoLiveFrames("browser", target).watch({ width: 192, everyMs: 3000 }, (frame) =>
    frames.push(frame.url),
  );
  await vi.advanceTimersByTimeAsync(6500);
  stop();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(frames).toHaveLength(3);
  expect(frames[0]).toMatch(/^https:\/\/m\/still\?token=t&surface=browser&w=192&at=\d+$/);
  expect(connection).toHaveBeenCalledTimes(1);
});

it("takes none while the machine is asleep, or from an Aldo without stills", async () => {
  connection.mockRejectedValueOnce(Object.assign(new Error("asleep"), { status: 409 }));
  const frames: string[] = [];
  const stop = aldoLiveFrames("windows", { environmentId: "asleep", threadId: "t" }).watch(
    { width: 192, everyMs: 3000 },
    (frame) => frames.push(frame.url),
  );
  await vi.advanceTimersByTimeAsync(10_000);
  stop();
  connection.mockResolvedValue({ url: "wss://m/browser", desktopUrl: "wss://m/desktop" });
  const older = aldoLiveFrames("windows", { environmentId: "older", threadId: "t" }).watch(
    { width: 192, everyMs: 3000 },
    (frame) => frames.push(frame.url),
  );
  await vi.advanceTimersByTimeAsync(10_000);
  older();
  expect(frames).toEqual([]);
});

it("shows the GPU computer's newest frame, read every few seconds whatever the view's pace, and nothing without a render", async () => {
  api.mockResolvedValueOnce({
    render: { frame: 38, frames: 120, leftMs: 60_000, image: "data:image/jpeg;base64,AA" },
  });
  api.mockResolvedValueOnce({ render: null });
  api.mockRejectedValue(Object.assign(new Error("No GPU computer"), { status: 409 }));
  const frames: string[] = [];
  const stop = aldoLiveFrames("gpu", target).watch({ width: 720, everyMs: 500 }, (frame) =>
    frames.push(frame.url),
  );
  await vi.advanceTimersByTimeAsync(10_500);
  stop();
  expect(api).toHaveBeenCalledTimes(3);
  expect(api).toHaveBeenCalledWith("/api/environments/t-env/gpu");
  expect(frames).toEqual(["data:image/jpeg;base64,AA"]);
});
