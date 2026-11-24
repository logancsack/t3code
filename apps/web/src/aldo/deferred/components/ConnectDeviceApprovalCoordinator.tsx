import { useEnvironments } from "../../../state/environments";
import { deferred } from "../../deferred";

const Coordinator = deferred(() =>
  import("../../../components/ConnectDeviceApprovalCoordinator").then(
    (m) => m.ConnectDeviceApprovalCoordinator,
  ),
);

/** Loads once an environment asks for its Connect devices to be approved. */
export function ConnectDeviceApprovalCoordinator() {
  const { environments } = useEnvironments();
  const asked = environments.some(
    (environment) =>
      environment.connection.phase === "connected" &&
      environment.serverConfig?.settings.requireConnectDeviceApproval === true,
  );
  return asked ? <Coordinator /> : null;
}
