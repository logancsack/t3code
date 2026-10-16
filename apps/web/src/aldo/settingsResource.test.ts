import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createSettingsResource } from "./settingsResource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("Settings data across panel mounts", () => {
  it("shares an in-flight read and reuses a fresh answer, including unsupported null", async () => {
    const answer = deferred<null>();
    const read = vi.fn(() => answer.promise);
    const resource = createSettingsResource(read);
    const first = resource.load();
    expect(resource.load()).toBe(first);
    answer.resolve(null);
    await first;
    expect(await resource.load()).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(resource.getSnapshot().data).toBeNull();
  });

  it("keeps stale data on screen while a refresh runs, including when it fails", async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<string>>().mockResolvedValueOnce("saved");
    const resource = createSettingsResource(read);
    await resource.load();
    vi.advanceTimersByTime(30_001);
    const answer = deferred<string>();
    read.mockReturnValueOnce(answer.promise);
    const refresh = resource.load();
    expect(resource.getSnapshot()).toMatchObject({ data: "saved", loading: true });
    answer.reject(new Error("offline"));
    await expect(refresh).rejects.toThrow("offline");
    expect(resource.getSnapshot()).toMatchObject({
      data: "saved",
      error: "offline",
      loading: false,
    });
  });

  it("ignores a read overtaken by a save or a forced refresh", async () => {
    const old = deferred<string>();
    const newer = deferred<string>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    const resource = createSettingsResource<string>(read);
    const first = resource.load();
    const second = resource.refresh();
    newer.resolve("new");
    await second;
    old.resolve("old");
    await first;
    expect(resource.getSnapshot().data).toBe("new");
    const delayed = deferred<string>();
    read.mockReturnValueOnce(delayed.promise);
    const pending = resource.refresh();
    resource.set("saved");
    delayed.resolve("before save");
    await pending;
    expect(resource.getSnapshot().data).toBe("saved");
  });

  it("shows rapid choices immediately, serializes writes, and rolls back to the last confirmation", async () => {
    const read = vi.fn(async () => "original");
    const resource = createSettingsResource(read);
    await resource.load();
    const first = deferred<string>();
    const second = deferred<string>();
    const writeFirst = vi.fn(() => first.promise);
    const writeSecond = vi.fn(() => second.promise);
    const one = resource.mutate(() => "first", writeFirst);
    const two = resource.mutate(() => "second", writeSecond);
    expect(resource.getSnapshot().data).toBe("second");
    expect(await resource.refresh()).toBe("second");
    expect(read).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(writeFirst).toHaveBeenCalledTimes(1);
    expect(writeSecond).not.toHaveBeenCalled();
    first.resolve("first confirmed");
    await one;
    expect(resource.getSnapshot().data).toBe("second");
    const failed = expect(two).rejects.toThrow("offline");
    second.reject(new Error("offline"));
    await failed;
    expect(resource.getSnapshot().data).toBe("first confirmed");
  });
});
