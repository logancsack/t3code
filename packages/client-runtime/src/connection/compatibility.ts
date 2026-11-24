import { msg } from "gt-i18n";
import { translatableDetail } from "../errors/translatable.ts";
import {
  CLIENT_CAPABILITIES_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  SETTINGS_SECRET_REFERENCES_CAPABILITY,
  type ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";

import * as Context from "effect/Context";

import { ConnectionBlockedError, type PreparedConnection } from "./model.ts";

/**
 * True on a host whose machines may still run the original wire protocol. The client then talks
 * to them through `legacyV1/` instead of refusing them.
 */
export class LegacyOrchestrationSupport extends Context.Reference<boolean>(
  "@t3tools/client-runtime/connection/LegacyOrchestrationSupport",
  { defaultValue: () => false },
) {}

/**
 * Servers shipped before negotiation use the original wire protocol. Through the adapter they
 * lack what only the current one has: queued and steering messages, read state, tags, forks,
 * subagents and workflows, decline feedback, force stop and earlier-history paging.
 */
export const isLegacyOrchestrationDescriptor = (
  descriptor: Pick<ExecutionEnvironmentDescriptor, "orchestrationProtocolVersion">,
) => (descriptor.orchestrationProtocolVersion ?? 1) === 1;

export const isLegacyOrchestration = (prepared: PreparedConnection): boolean =>
  prepared.descriptor !== undefined && isLegacyOrchestrationDescriptor(prepared.descriptor);

export function orchestrationProtocolCompatibilityError(
  descriptor: ExecutionEnvironmentDescriptor,
  legacySupport = false,
): ConnectionBlockedError | null {
  const serverProtocolVersion = descriptor.orchestrationProtocolVersion ?? 1;
  if (
    serverProtocolVersion === ORCHESTRATION_PROTOCOL_VERSION ||
    (legacySupport && isLegacyOrchestrationDescriptor(descriptor))
  ) {
    return null;
  }
  return serverProtocolVersion > ORCHESTRATION_PROTOCOL_VERSION
    ? new ConnectionBlockedError({
        reason: "unsupported",
        ...translatableDetail(
          msg(
            "This client is not supported by this server. Update your app or use a compatible release to connect to {host}.",
            { host: descriptor.label },
          ),
        ),
      })
    : new ConnectionBlockedError({
        reason: "unsupported",
        ...translatableDetail(
          msg("This client requires a newer server. Update T3 Code on {host} to connect.", {
            host: descriptor.label,
          }),
        ),
        ...(canSelfUpdate(descriptor) ? { serverUpdateRequired: true } : {}),
      });
}

function canSelfUpdate(descriptor: ExecutionEnvironmentDescriptor): boolean {
  const { serverSelfUpdate, desktopAppUpdate } = descriptor.capabilities;
  return (
    serverSelfUpdate !== undefined &&
    (serverSelfUpdate !== "desktop-managed" || desktopAppUpdate === true)
  );
}

export function appendOrchestrationProtocol(socketUrl: string): string {
  const url = new URL(socketUrl);
  url.searchParams.set(ORCHESTRATION_PROTOCOL_QUERY_PARAM, String(ORCHESTRATION_PROTOCOL_VERSION));
  url.searchParams.set(CLIENT_CAPABILITIES_QUERY_PARAM, SETTINGS_SECRET_REFERENCES_CAPABILITY);
  return url.toString();
}
