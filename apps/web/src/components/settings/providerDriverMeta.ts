import {
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  GrokSettings,
  MuseSettings,
  OpenCodeSettings,
  PrimeSettings,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import type * as Schema from "effect/Schema";
import {
  ClaudeAI,
  CursorIcon,
  GrokIcon,
  type Icon,
  MuseCodeIcon,
  OpenAI,
  OpenCodeIcon,
  PrimeAgentIcon,
} from "../Icons";

type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

/**
 * Browser-safe provider definition. This is deliberately shaped like the
 * future provider package client export: the core web app gets a schema with
 * field annotations plus provider-level presentation metadata, then renders
 * settings generically.
 */
export interface ProviderClientDefinition {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly icon: Icon;
  readonly settingsSchema: ProviderSettingsSchema;
  /**
   * Optional short label rendered as a `variant="warning"` badge next to
   * the instance title. Used to flag drivers that still ship under an
   * early-access or preview gate — the flag is a property of the driver
   * kind (not a specific instance), so every instance of that driver —
   * built-in default or custom — advertises the same marker.
   */
  readonly badgeLabel?: string;
}

export const PROVIDER_CLIENT_DEFINITIONS: readonly ProviderClientDefinition[] = [
  {
    value: ProviderDriverKind.make("codex"),
    label: "Codex",
    icon: OpenAI,
    settingsSchema: CodexSettings,
  },
  {
    value: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    icon: ClaudeAI,
    settingsSchema: ClaudeSettings,
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    icon: CursorIcon,
    badgeLabel: "Early Access",
    settingsSchema: CursorSettings,
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    icon: GrokIcon,
    badgeLabel: "Early Access",
    settingsSchema: GrokSettings,
  },
  {
    value: ProviderDriverKind.make("muse"),
    label: "Muse Code",
    icon: MuseCodeIcon,
    badgeLabel: "Beta",
    settingsSchema: MuseSettings,
  },
  {
    value: ProviderDriverKind.make("primeAgent"),
    label: "Prime Agent",
    icon: PrimeAgentIcon,
    badgeLabel: "Experimental",
    settingsSchema: PrimeSettings,
  },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    icon: OpenCodeIcon,
    settingsSchema: OpenCodeSettings,
  },
];

export const PROVIDER_CLIENT_DEFINITION_BY_VALUE: Partial<
  Record<ProviderDriverKind, ProviderClientDefinition>
> = Object.fromEntries(
  PROVIDER_CLIENT_DEFINITIONS.map((definition) => [definition.value, definition]),
);

export const DRIVER_OPTIONS = PROVIDER_CLIENT_DEFINITIONS;
export const DRIVER_OPTION_BY_VALUE = PROVIDER_CLIENT_DEFINITION_BY_VALUE;
export type DriverOption = ProviderClientDefinition;

const MUSE_DRIVER_KIND = ProviderDriverKind.make("muse");

type ProviderRuntimeSupportSnapshot = Pick<ServerProvider, "availability" | "driver">;

/**
 * Muse can be withheld by a managed server while remaining compiled into the
 * shared client artifact. Only expose it when the server reports a concrete,
 * available Muse instance. An unavailable shadow may come from stale settings
 * and is not evidence that the driver can execute in this environment.
 */
export function isProviderDriverRuntimeSupported(
  driver: ProviderDriverKind,
  providers: ReadonlyArray<ProviderRuntimeSupportSnapshot>,
): boolean {
  return (
    driver !== MUSE_DRIVER_KIND ||
    providers.some(
      (provider) => provider.driver === MUSE_DRIVER_KIND && provider.availability !== "unavailable",
    )
  );
}

export function runtimeSupportedDriverOptions(
  providers: ReadonlyArray<ProviderRuntimeSupportSnapshot>,
): ReadonlyArray<DriverOption> {
  return DRIVER_OPTIONS.filter((option) =>
    isProviderDriverRuntimeSupported(option.value, providers),
  );
}

/**
 * Look up the driver metadata for an instance's `driver` field. Accepts
 * Returns `undefined` for fork / unknown drivers so callers can decide how
 * to render them — typically by falling back to a generic card.
 */
export function getDriverOption(driver: ProviderDriverKind | undefined): DriverOption | undefined {
  if (driver === undefined) return undefined;
  return PROVIDER_CLIENT_DEFINITION_BY_VALUE[driver];
}
