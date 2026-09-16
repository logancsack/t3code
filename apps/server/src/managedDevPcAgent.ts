import { ThreadId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerConfig from "./config.ts";
import { managedGatewayTokenMatches } from "./managedDevPcActivity.ts";
import { projectThreadDetailSnapshot } from "./orchestration/ActivityPayloadProjection.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);

/** Workspace-local coordinator reads use the same capability as managed dispatch. */
export const managedDevPcAgentRouteLayer = HttpRouter.add(
  "GET",
  "/api/_devpc/agent/snapshot",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig.ServerConfig;
    const headers = { "cache-control": "no-store, private" };
    if (
      !config.managedDevPc ||
      !managedGatewayTokenMatches(
        request.headers["x-devpc-gateway-token"],
        config.managedGatewayToken,
      )
    ) {
      return HttpServerResponse.jsonUnsafe({ error: "Not found" }, { status: 404, headers });
    }
    const snapshots = yield* ProjectionSnapshotQuery;
    const threadId = new URL(request.url, "http://localhost").searchParams.get("threadId");
    if (threadId !== null) {
      const decoded = decodeThreadId(threadId);
      if (Option.isNone(decoded)) {
        return HttpServerResponse.jsonUnsafe({ error: "Invalid thread" }, { status: 400, headers });
      }
      return yield* snapshots.getThreadDetailSnapshot(decoded.value, { turnLimit: 3 }).pipe(
        Effect.match({
          onFailure: () =>
            HttpServerResponse.jsonUnsafe({ error: "Unavailable" }, { status: 503, headers }),
          onSuccess: (snapshot) =>
            Option.isSome(snapshot)
              ? HttpServerResponse.jsonUnsafe(projectThreadDetailSnapshot(snapshot.value), {
                  headers,
                })
              : HttpServerResponse.jsonUnsafe({ error: "Not found" }, { status: 404, headers }),
        }),
      );
    }
    return yield* snapshots.getShellSnapshot().pipe(
      Effect.match({
        onFailure: () =>
          HttpServerResponse.jsonUnsafe({ error: "Unavailable" }, { status: 503, headers }),
        onSuccess: (snapshot) => HttpServerResponse.jsonUnsafe(snapshot, { headers }),
      }),
    );
  }),
);

/**
 * The provider catalog as the workspace coordinator needs it: enabled instances, their
 * models, and each model's selectable options (reasoning effort, service tier, ...).
 * Slash commands, skills and update state are omitted; they are UI concerns.
 */
export function projectManagedProviders(providers: ReadonlyArray<ServerProvider>) {
  return providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      instanceId: provider.instanceId,
      driver: provider.driver,
      displayName: provider.displayName ?? provider.instanceId,
      installed: provider.installed,
      status: provider.status,
      auth: provider.auth.status,
      availability: provider.availability ?? "available",
      ...(provider.unavailableReason ? { unavailableReason: provider.unavailableReason } : {}),
      ...(provider.supportedRuntimeModes
        ? { supportedRuntimeModes: [...provider.supportedRuntimeModes] }
        : {}),
      models: provider.models.map((model) => ({
        slug: model.slug,
        name: model.name,
        ...(model.shortName ? { shortName: model.shortName } : {}),
        ...(model.aliases && model.aliases.length > 0 ? { aliases: [...model.aliases] } : {}),
        ...(model.isDefault ? { isDefault: true } : {}),
        ...(model.isLegacy ? { isLegacy: true } : {}),
        options: (model.capabilities?.optionDescriptors ?? []).map((option) =>
          option.type === "select"
            ? {
                id: option.id,
                label: option.label,
                type: option.type,
                ...(option.currentValue !== undefined ? { currentValue: option.currentValue } : {}),
                choices: option.options.map((choice) => ({
                  id: choice.id,
                  label: choice.label,
                  ...(choice.description ? { description: choice.description } : {}),
                  ...(choice.isDefault ? { isDefault: true } : {}),
                })),
              }
            : {
                id: option.id,
                label: option.label,
                type: option.type,
                ...(option.currentValue !== undefined ? { currentValue: option.currentValue } : {}),
              },
        ),
      })),
    }));
}

/** The provider catalog for the workspace coordinator, behind the same capability. */
export const managedDevPcAgentProvidersRouteLayer = HttpRouter.add(
  "GET",
  "/api/_devpc/agent/providers",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig.ServerConfig;
    const headers = { "cache-control": "no-store, private" };
    if (
      !config.managedDevPc ||
      !managedGatewayTokenMatches(
        request.headers["x-devpc-gateway-token"],
        config.managedGatewayToken,
      )
    ) {
      return HttpServerResponse.jsonUnsafe({ error: "Not found" }, { status: 404, headers });
    }
    const registry = yield* ProviderRegistry;
    const providers = yield* registry.getProviders;
    return HttpServerResponse.jsonUnsafe(
      { providers: projectManagedProviders(providers) },
      { headers },
    );
  }),
);
