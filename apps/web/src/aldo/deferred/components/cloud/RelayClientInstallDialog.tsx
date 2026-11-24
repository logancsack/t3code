import { useSyncExternalStore } from "react";

import {
  readRelayClientInstallDialogState,
  subscribeRelayClientInstallDialog,
} from "../../../../cloud/relayClientInstallDialog";
import { deferred } from "../../../deferred";

const Dialog = deferred(() =>
  import("../../../../components/cloud/RelayClientInstallDialog").then(
    (m) => m.RelayClientInstallDialog,
  ),
);

const idle = () => readRelayClientInstallDialogState().status === "idle";

export function RelayClientInstallDialog() {
  return useSyncExternalStore(subscribeRelayClientInstallDialog, idle, idle) ? null : <Dialog />;
}
