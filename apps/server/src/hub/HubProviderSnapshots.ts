/**
 * HubProviderSnapshots - provider status the hub can show without a machine.
 *
 * A hub cannot probe provider CLIs; every runner reports the snapshots of the
 * instances it hosts when the hub connects (and on refresh). The latest report
 * per provider instance is kept here and persisted (`ProviderSnapshotStore`,
 * hub Postgres or SQLite in development), so a restarted hub, or one whose
 * machines are all asleep, still shows real status, auth and models.
 *
 * Before any runner has reported an instance, `pendingRemoteSnapshot` stands
 * in: the driver's own initial snapshot (built-in and custom models), marked
 * installed and ready with auth `unknown`, so the composer can select the
 * provider and the first turn can start its machine.
 *
 * The hub's settings stay authoritative for identity and enablement
 * (`overlayHubIdentity`), and provider maintenance fields are dropped: CLIs on
 * thread machines come from the machine image, not from the hub.
 *
 * @module hub/HubProviderSnapshots
 */
import {
  type ClaudeSettings,
  type CodexSettings,
  type CursorSettings,
  type GrokSettings,
  type MuseSettings,
  type OpenCodeSettings,
  type PrimeSettings,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  ProviderSnapshotStore,
  type ProviderSnapshotRow,
} from "../persistence/Services/HubThreadMachineState.ts";
import { makePendingClaudeProvider } from "../provider/Layers/ClaudeProvider.ts";
import { makePendingCodexProvider } from "../provider/Layers/CodexProvider.ts";
import { buildInitialCursorProviderSnapshot } from "../provider/Layers/CursorProvider.ts";
import { buildInitialGrokProviderSnapshot } from "../provider/Layers/GrokProvider.ts";
import { buildInitialMuseProviderSnapshot } from "../provider/Layers/MuseProvider.ts";
import { makePendingOpenCodeProvider } from "../provider/Layers/OpenCodeProvider.ts";
import { buildInitialPrimeProviderSnapshot } from "../provider/Layers/PrimeProvider.ts";
import { BUNDLED_MODEL_MANIFEST } from "../provider/ModelManifest.ts";
import type { ServerProviderDraft } from "../provider/providerSnapshot.ts";
import { buildUnavailableProviderSnapshot } from "../provider/unavailableProviderSnapshot.ts";

export interface HubProviderSnapshotsShape {
  /** The latest snapshot a runner reported for the instance, if any. */
  readonly get: (instanceId: ProviderInstanceId) => Effect.Effect<Option.Option<ServerProvider>>;
  /** Records (and persists) a runner-reported snapshot and publishes it. */
  readonly put: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly changes: Stream.Stream<ServerProvider>;
}

export class HubProviderSnapshots extends Context.Service<
  HubProviderSnapshots,
  HubProviderSnapshotsShape
>()("t3/hub/HubProviderSnapshots") {}

export const make = Effect.gen(function* () {
  const store = yield* ProviderSnapshotStore;
  const snapshots = new Map<ProviderInstanceId, ServerProvider>();
  for (const row of yield* store
    .list()
    .pipe(
      Effect.catch((error) =>
        Effect.logWarning("provider snapshots could not be loaded", { detail: error.message }).pipe(
          Effect.as([] as ReadonlyArray<ProviderSnapshotRow>),
        ),
      ),
    )) {
    snapshots.set(row.instanceId, row.snapshot);
  }
  const changes = yield* PubSub.unbounded<ServerProvider>();

  return HubProviderSnapshots.of({
    get: (instanceId) => Effect.sync(() => Option.fromNullishOr(snapshots.get(instanceId))),
    put: (snapshot) =>
      Effect.gen(function* () {
        snapshots.set(snapshot.instanceId, snapshot);
        yield* store
          .put({
            instanceId: snapshot.instanceId,
            snapshot,
            updatedAt: DateTime.formatIso(yield* DateTime.now),
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("provider snapshot was not persisted", {
                instanceId: snapshot.instanceId,
                detail: error.message,
              }),
            ),
          );
        yield* PubSub.publish(changes, snapshot);
      }),
    changes: Stream.fromPubSub(changes),
  });
});

export const layer = Layer.effect(HubProviderSnapshots, make);

const PENDING_MESSAGE = "Checked when a thread machine starts.";

/** Manifest models for drivers whose initial snapshot lists none (models come from a probe). */
const withManifestModels = (
  draft: ServerProviderDraft,
  driverKind: ProviderDriverKind,
): ServerProviderDraft => {
  if (draft.models.some((model) => !model.isCustom)) return draft;
  const current = BUNDLED_MODEL_MANIFEST.currentModels[driverKind] ?? [];
  const known = new Set(draft.models.map((model) => model.slug));
  const models: Array<ServerProviderModel> = current
    .filter((slug) => !known.has(slug))
    .map((slug, index) => ({
      slug,
      name: slug,
      isCustom: false,
      ...(index === 0 ? { isDefault: true } : {}),
      capabilities: null,
    }));
  return { ...draft, models: [...models, ...draft.models] };
};

const pendingDraft = (
  driverKind: ProviderDriverKind,
  config: unknown,
  enabled: boolean,
): Effect.Effect<ServerProviderDraft | null> => {
  const settings = { ...(config as object), enabled };
  switch (driverKind) {
    case "claudeAgent":
      return makePendingClaudeProvider(settings as ClaudeSettings);
    case "codex":
      return makePendingCodexProvider(settings as CodexSettings);
    case "opencode":
      return makePendingOpenCodeProvider(settings as OpenCodeSettings);
    case "cursor":
      return buildInitialCursorProviderSnapshot(settings as CursorSettings);
    case "grok":
      return buildInitialGrokProviderSnapshot(settings as GrokSettings);
    case "primeAgent":
      return buildInitialPrimeProviderSnapshot(settings as PrimeSettings);
    case "muse":
      return buildInitialMuseProviderSnapshot(settings as MuseSettings);
    default:
      return Effect.succeed(null);
  }
};

export interface RemoteInstanceIdentity {
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor: string | undefined;
  readonly enabled: boolean;
  readonly continuationGroupKey: string;
}

/**
 * Applies the hub's identity and enablement to a snapshot, and drops update
 * advisories: a hub cannot update the CLIs on thread machines.
 */
export const overlayHubIdentity = (
  snapshot: ServerProvider,
  identity: RemoteInstanceIdentity,
): ServerProvider => {
  const { versionAdvisory: _versionAdvisory, updateState: _updateState, ...rest } = snapshot;
  return {
    ...rest,
    instanceId: identity.instanceId,
    driver: identity.driverKind,
    ...(identity.displayName ? { displayName: identity.displayName } : {}),
    ...(identity.accentColor ? { accentColor: identity.accentColor } : {}),
    continuation: snapshot.continuation ?? { groupKey: identity.continuationGroupKey },
    enabled: identity.enabled,
    status: identity.enabled
      ? snapshot.status === "disabled"
        ? "warning"
        : snapshot.status
      : "disabled",
  };
};

/**
 * The snapshot shown before any runner reported the instance: the driver's
 * initial snapshot, installed and ready with auth `unknown`.
 */
export const pendingRemoteSnapshot = (
  identity: RemoteInstanceIdentity,
  config: unknown,
): Effect.Effect<ServerProvider> =>
  Effect.gen(function* () {
    const draft = yield* pendingDraft(identity.driverKind, config, identity.enabled);
    if (draft === null) {
      return yield* buildUnavailableProviderSnapshot({
        driverKind: identity.driverKind,
        instanceId: identity.instanceId,
        displayName: identity.displayName,
        accentColor: identity.accentColor,
        reason: "This build has no driver for this provider.",
      });
    }
    const { versionAdvisory: _versionAdvisory, ...pending } = withManifestModels(
      draft,
      identity.driverKind,
    );
    return overlayHubIdentity(
      {
        ...pending,
        instanceId: identity.instanceId,
        driver: identity.driverKind,
        installed: true,
        status: "ready",
        auth: { status: "unknown" },
        message: PENDING_MESSAGE,
        availability: "available",
      },
      identity,
    );
  });
