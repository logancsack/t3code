import type { ThreadRightPanelState } from "../rightPanelStore";

/**
 * Drops Device tabs from persisted panels: Aldo's machines run no simulators,
 * but the surface was offered before Aldo hid it. Like closing a tab, an
 * active Device tab hands over to the next one, and the panel closes once
 * nothing is left.
 */
export function withoutDeviceSurfaces(
  byThreadKey: Record<string, ThreadRightPanelState>,
): Record<string, ThreadRightPanelState> {
  return Object.fromEntries(
    Object.entries(byThreadKey).map(([threadKey, state]) => {
      if (!state.surfaces.some((surface) => surface.kind === "device")) {
        return [threadKey, state];
      }
      const surfaces = state.surfaces.filter((surface) => surface.kind !== "device");
      const active = state.surfaces.find((surface) => surface.id === state.activeSurfaceId);
      let activeSurfaceId = state.activeSurfaceId;
      if (active?.kind === "device") {
        const before = state.surfaces
          .slice(0, state.surfaces.indexOf(active))
          .filter((surface) => surface.kind !== "device").length;
        activeSurfaceId = surfaces[Math.min(before, surfaces.length - 1)]?.id ?? null;
      }
      return [
        threadKey,
        { ...state, isOpen: state.isOpen && surfaces.length > 0, surfaces, activeSurfaceId },
      ];
    }),
  );
}
