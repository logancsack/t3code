import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime/state/source-control";

import { connectionAtomRuntime } from "../connection/runtime";

export const sourceControlEnvironment = {
  ...createSourceControlEnvironmentAtoms(connectionAtomRuntime),
  // Aldo's sign-in sessions for a machine's CLIs (AuthConnectorDialog).
  startAuthConnector: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:server:start-auth-connector",
    tag: WS_METHODS.serverStartAuthConnector,
    concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
  }),
  getAuthConnector: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:server:get-auth-connector",
    tag: WS_METHODS.serverGetAuthConnector,
    concurrency: { mode: "parallel" },
  }),
  submitAuthConnector: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:server:submit-auth-connector",
    tag: WS_METHODS.serverSubmitAuthConnector,
    concurrency: { mode: "parallel" },
  }),
  cancelAuthConnector: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:server:cancel-auth-connector",
    tag: WS_METHODS.serverCancelAuthConnector,
    concurrency: { mode: "parallel" },
  }),
};
