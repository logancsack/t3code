import { deferred } from "../../../deferred";

const Coordinator = deferred(() =>
  import("../../../../components/desktop/DesktopAppActivationCoordinator").then(
    (m) => m.DesktopAppActivationCoordinator,
  ),
);

export function DesktopAppActivationCoordinator() {
  return window.desktopBridge ? <Coordinator /> : null;
}
