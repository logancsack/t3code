import { deferred } from "../../deferred";

export const ReopenClosedViewShortcut = deferred(
  async () =>
    (await import("../../../components/ReopenClosedViewShortcut")).ReopenClosedViewShortcut,
  { warm: true },
);
