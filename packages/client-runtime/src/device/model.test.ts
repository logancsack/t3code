import { expect, it, vi } from "vite-plus/test";
import { createDeviceModelSlot, type DeviceModelSource } from "./model.ts";

it("aborts superseded or closed requests, disposes late models and preserves the current scene", async () => {
  const pending: { signal: AbortSignal; resolve: (model: { dispose: () => void }) => void }[] = [];
  const install = vi.fn();
  const slot = createDeviceModelSlot({
    load: (_source: DeviceModelSource, signal) =>
      new Promise<{ dispose: () => void }>((resolve) => {
        pending.push({ signal, resolve });
      }),
    install,
  });
  slot.set({ id: "iphone-18-pro", url: "/pro.glb" });
  slot.set({ id: "iphone-18-pro-max", url: "/max.glb" });
  expect(pending[0]!.signal.aborted).toBe(true);
  const latest = { dispose: vi.fn(() => expect(install).toHaveBeenLastCalledWith(null)) };
  const stale = { dispose: vi.fn() };
  pending[1]!.resolve(latest);
  await Promise.resolve();
  pending[0]!.resolve(stale);
  await Promise.resolve();
  expect(install).toHaveBeenCalledExactlyOnceWith(latest);
  expect(stale.dispose).toHaveBeenCalledOnce();
  slot.set({ id: "iphone-duo", url: "/duo.glb" });
  expect(latest.dispose).toHaveBeenCalledOnce();
  slot.dispose();
  expect(pending[2]!.signal.aborted).toBe(true);
  const late = { dispose: vi.fn() };
  pending[2]!.resolve(late);
  await Promise.resolve();
  expect(late.dispose).toHaveBeenCalledOnce();
  expect(install.mock.calls.map(([model]) => model)).toEqual([latest, null]);
  slot.dispose();
  expect(latest.dispose).toHaveBeenCalledOnce();
});
