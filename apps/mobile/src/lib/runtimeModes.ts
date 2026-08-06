import type { RuntimeMode, ServerProvider } from "@t3tools/contracts";

export const RUNTIME_MODE_OPTIONS = [
  { value: "approval-required", label: "Approve actions" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "auto", label: "Auto" },
  { value: "full-access", label: "Full access" },
] as const satisfies ReadonlyArray<{ readonly value: RuntimeMode; readonly label: string }>;
export const ALL_RUNTIME_MODES = RUNTIME_MODE_OPTIONS.map((option) => option.value);

type RuntimeModeProviderCapability = Pick<ServerProvider, "supportedRuntimeModes">;

export function getProviderSupportedRuntimeModes(
  provider: RuntimeModeProviderCapability | null | undefined,
): ReadonlyArray<RuntimeMode> {
  const configured = provider?.supportedRuntimeModes;
  return configured && configured.length > 0 ? configured : ALL_RUNTIME_MODES;
}

export function coerceProviderRuntimeMode(
  provider: RuntimeModeProviderCapability | null | undefined,
  runtimeMode: RuntimeMode,
): RuntimeMode {
  const supported = getProviderSupportedRuntimeModes(provider);
  return supported.includes(runtimeMode) ? runtimeMode : (supported[0] ?? "full-access");
}

export function runtimeModeLabel(runtimeMode: RuntimeMode): string {
  return (
    RUNTIME_MODE_OPTIONS.find((option) => option.value === runtimeMode)?.label ?? "Full access"
  );
}
