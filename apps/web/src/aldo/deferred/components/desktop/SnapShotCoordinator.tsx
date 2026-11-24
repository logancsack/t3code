import { deferred } from "../../../deferred";

// Mounted off the desktop too: it keeps the last project used, which new threads start in.
export const SnapShotCoordinator = deferred(() =>
  import("../../../../components/desktop/SnapShotCoordinator").then((m) => m.SnapShotCoordinator),
);
