import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createSourceControlEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  return {
    discovery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:server:source-control-discovery",
      tag: WS_METHODS.serverDiscoverSourceControl,
    }),
    startAuthConnector: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:start-auth-connector",
      tag: WS_METHODS.serverStartAuthConnector,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
    }),
    getAuthConnector: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:get-auth-connector",
      tag: WS_METHODS.serverGetAuthConnector,
      scheduler: commandScheduler,
      concurrency: {
        mode: "parallel",
      },
    }),
    submitAuthConnector: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:submit-auth-connector",
      tag: WS_METHODS.serverSubmitAuthConnector,
      scheduler: commandScheduler,
      concurrency: {
        mode: "parallel",
      },
    }),
    cancelAuthConnector: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:cancel-auth-connector",
      tag: WS_METHODS.serverCancelAuthConnector,
      scheduler: commandScheduler,
      concurrency: {
        mode: "parallel",
      },
    }),
    repository: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:source-control:repository",
      tag: WS_METHODS.sourceControlLookupRepository,
    }),
    repositories: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:source-control:repositories",
      tag: WS_METHODS.sourceControlListRepositories,
    }),
    cloneRepository: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:clone-repository",
      tag: WS_METHODS.sourceControlCloneRepository,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
    }),
    publishRepository: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:publish-repository",
      tag: WS_METHODS.sourceControlPublishRepository,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
