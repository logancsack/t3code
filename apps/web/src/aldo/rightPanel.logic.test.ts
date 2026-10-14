import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface, ThreadRightPanelState } from "../rightPanelStore";
import { withoutDeviceSurfaces } from "./rightPanel.logic";

const diff: RightPanelSurface = { id: "diff", kind: "diff" };
const files: RightPanelSurface = { id: "files", kind: "files" };
const device: RightPanelSurface = {
  id: "device:host:sim",
  kind: "device",
  target: { hostId: "host", deviceId: "sim", platform: "ios", name: "iPhone" },
};

function panel(surfaces: RightPanelSurface[], activeSurfaceId: string | null) {
  return { t: { isOpen: true, surfaces, activeSurfaceId } satisfies ThreadRightPanelState };
}

describe("withoutDeviceSurfaces", () => {
  it("keeps panels without a Device tab as they are", () => {
    const state = panel([diff, files], "files");
    expect(withoutDeviceSurfaces(state).t).toBe(state.t);
  });

  it("keeps the active tab when a background Device tab goes", () => {
    expect(withoutDeviceSurfaces(panel([diff, device, files], "files")).t).toEqual({
      isOpen: true,
      surfaces: [diff, files],
      activeSurfaceId: "files",
    });
  });

  it("hands an active Device tab over to the next tab, or the last one", () => {
    expect(withoutDeviceSurfaces(panel([diff, device, files], device.id)).t?.activeSurfaceId).toBe(
      "files",
    );
    expect(withoutDeviceSurfaces(panel([diff, files, device], device.id)).t?.activeSurfaceId).toBe(
      "files",
    );
  });

  it("closes a panel that held only Device tabs", () => {
    expect(withoutDeviceSurfaces(panel([device], device.id)).t).toEqual({
      isOpen: false,
      surfaces: [],
      activeSurfaceId: null,
    });
  });
});
