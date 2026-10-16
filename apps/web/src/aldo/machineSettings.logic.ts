// T3's settings that live on each machine (its settings.json) and that Aldo
// keeps as the user's (Aldo's src/lib/machine-settings.ts): the new-thread
// model and permissions, response streaming, continuing threads after
// restarts, and the text generation model. Each machine had its own, so a
// change reached only the ones connected at the time. At "All environments",
// Settings shows the user's values and saves a change to Aldo as well
// (machineSettings.ts), which writes it into every machine: the running ones
// at once, the rest as they start or wake. Picking one environment changes
// that machine alone, until the user's next change. Per-project
// overrides stay each machine's own: T3 keys them by its project id, which
// differs on each of a repository's machines. Pure, so it's tested on its own.

import {
  ModelSelection,
  ResponseStreamingMode,
  RuntimeMode,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type AldoMachineSettingKey =
  | "defaultModelSelection"
  | "defaultRuntimeMode"
  | "responseStreamingMode"
  | "continueThreadsAfterServerUpdate"
  | "textGenerationModelSelection";

export type AldoMachineSettings = Partial<Pick<ServerSettings, AldoMachineSettingKey>>;

/** Each key as T3 reads it: a value it can't read makes it ignore its whole settings file. */
const DECODE: {
  readonly [K in AldoMachineSettingKey]: (value: unknown) => Option.Option<ServerSettings[K]>;
} = {
  defaultModelSelection: Schema.decodeUnknownOption(Schema.NullOr(ModelSelection)),
  defaultRuntimeMode: Schema.decodeUnknownOption(RuntimeMode),
  responseStreamingMode: Schema.decodeUnknownOption(ResponseStreamingMode),
  continueThreadsAfterServerUpdate: Schema.decodeUnknownOption(Schema.Boolean),
  textGenerationModelSelection: Schema.decodeUnknownOption(ModelSelection),
};

export const ALDO_MACHINE_SETTING_KEYS = Object.keys(DECODE) as readonly AldoMachineSettingKey[];

function isKept(key: string): key is AldoMachineSettingKey {
  return Object.hasOwn(DECODE, key);
}

/**
 * The settings Aldo keeps among `raw` (Aldo's answer, or a settings patch),
 * each that T3 could read. A key Aldo doesn't keep is left out, and so is a
 * partial model selection (a patch's), which isn't the user's whole choice.
 */
export function aldoMachineSettingsOf(raw: unknown): AldoMachineSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isKept(key) || value === undefined) continue;
    const decode: (value: unknown) => Option.Option<unknown> = DECODE[key];
    const decoded = decode(value);
    if (Option.isSome(decoded)) settings[key] = decoded.value;
  }
  return settings as AldoMachineSettings;
}

/** `settings` with the user's kept ones over them; `settings` itself when there are none. */
export function withAldoMachineSettings<S extends ServerSettings>(
  settings: S,
  kept: AldoMachineSettings | null,
  modelRouting = false,
): S {
  return kept
    ? { ...settings, ...(modelRouting ? { defaultModelSelection: null } : {}), ...kept }
    : settings;
}

/** Whether Aldo keeps every one of `keys` (none: it keeps nothing of them). */
export function aldoKeepsAll(keys: readonly string[]): boolean {
  return keys.length > 0 && keys.every(isKept);
}

/** What Settings shows and saves at a scope where the user's values are the ones that count. */
export interface AldoSettingsScope {
  /** The user's settings Aldo keeps (none yet: an empty object). */
  readonly settings: AldoMachineSettings;
  /**
   * Providers for the model pickers when no machine is connected: a sleeping
   * machine's, as this browser last had them. None before any machine reported.
   */
  readonly providers: ReadonlyArray<ServerProvider> | null;
}

interface SettingsEnvironment {
  readonly environmentId: string;
  readonly serverConfig: {
    readonly settings: ServerSettings;
    readonly providers: ReadonlyArray<ServerProvider>;
  } | null;
}

/**
 * The scope's environments with the user's values (`kept`, null from an Aldo
 * that doesn't keep them) over the connected ones' settings, and what Settings
 * saves to Aldo, at "All environments" only: picking one environment (or a
 * project's overrides) is about that machine's own. Otherwise, as they were.
 */
export function aldoSettingsSelection<
  E extends SettingsEnvironment,
  S extends {
    readonly environments: readonly E[];
    readonly connectedEnvironments: readonly E[];
    readonly environment: E | null;
  },
>(
  scopeKind: string,
  selected: S,
  kept: AldoMachineSettings | null,
  modelRouting = false,
): S & { aldo: AldoSettingsScope | null } {
  if (kept === null || scopeKind !== "all") return { ...selected, aldo: null };
  const connectedEnvironments = selected.connectedEnvironments.map((environment) =>
    environment.serverConfig
      ? {
          ...environment,
          serverConfig: {
            ...environment.serverConfig,
            settings: withAldoMachineSettings(
              environment.serverConfig.settings,
              kept,
              modelRouting,
            ),
          },
        }
      : environment,
  );
  const environment =
    connectedEnvironments.find(
      (candidate) => candidate.environmentId === selected.environment?.environmentId,
    ) ?? null;
  // The one that lists the most kinds of provider: one whose T3 started before a provider shipped
  // lists fewer (a kind's extra instances don't make up for one missing).
  const kinds = (environment: E | null) =>
    environment?.serverConfig
      ? new Set(environment.serverConfig.providers.map((provider) => provider.driver)).size
      : -1;
  const standIn = selected.environments.reduce<E | null>(
    (best, candidate) =>
      candidate.serverConfig && kinds(candidate) > kinds(best) ? candidate : best,
    null,
  );
  return {
    ...selected,
    connectedEnvironments,
    environment,
    aldo: {
      settings: kept,
      providers:
        connectedEnvironments.length === 0 ? (standIn?.serverConfig?.providers ?? null) : null,
    },
  };
}

/** Whether Settings saves `keys` to Aldo at this scope, so they can change with no machine connected. */
export function aldoSavesSettings(
  aldo: AldoSettingsScope | null | undefined,
  keys: readonly string[],
): boolean {
  return aldo != null && aldoKeepsAll(keys);
}
