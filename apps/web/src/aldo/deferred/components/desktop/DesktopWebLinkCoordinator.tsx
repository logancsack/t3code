import { deferred } from "../../../deferred";

const Coordinator = deferred(() =>
  import("../../../../components/desktop/DesktopWebLinkCoordinator").then(
    (m) => m.DesktopWebLinkCoordinator,
  ),
);

export function DesktopWebLinkCoordinator() {
  return window.desktopBridge ? <Coordinator /> : null;
}
