import { assert, expect, it, vi } from "vite-plus/test";
import type { RegionSnapShotChild } from "./RegionSnapShot.ts";
vi.mock("electron", () => ({ nativeImage: {} }));
import { startRegionSnapShotProcess } from "./RegionSnapShot.ts";

function fakeChild() {
  const messageListeners: Array<(message: unknown) => void> = [];
  const exitListeners: Array<() => void> = [];
  const send = vi.fn();
  const kill = vi.fn();
  const child: RegionSnapShotChild = {
    send,
    onMessage: (listener) => messageListeners.push(listener),
    onExit: (listener) => exitListeners.push(listener),
    kill,
  };
  return {
    child,
    send,
    kill,
    emit: (message: unknown) => {
      for (const listener of messageListeners) listener(message);
    },
    exit: () => {
      for (const listener of exitListeners) listener();
    },
  };
}

const region = { x: 0, y: 0, width: 2, height: 1 };

it("cancels a pending capture on close and kills the child", async () => {
  const fake = fakeChild();
  const child = startRegionSnapShotProcess("worker.cjs", () => fake.child);
  const capture = child.capture(region);
  child.close();

  await expect(capture).rejects.toThrow(/cancelled/);
  assert.lengthOf(fake.kill.mock.calls, 1);
  assert.isFalse(child.alive);
  fake.emit("ready");
  await Promise.resolve(); // Drain the continuation released by the late readiness message.
  assert.lengthOf(fake.send.mock.calls, 0);
});
