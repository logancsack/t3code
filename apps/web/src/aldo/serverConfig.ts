// The models a thread offers before its machine runs. T3 caches each
// environment's server config (its providers and their models, capabilities),
// and a new thread's machine is registered with a copy of the newest config
// any of the user's cloud agents reported, so its model picker is complete
// the moment the thread opens. Whenever a cloud agent connects or its config
// changes, the newest one is saved to Aldo for other tabs and devices.

import { ServerConfig } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { environmentServerConfigsAtom } from "../state/server";
import { fetchAldoServerConfig, reportAldoServerConfig } from "./threadApi";
import { isAldoCloud, isAldoEnvironmentId } from "./api";
import { settingsAccounts } from "./settingsData";
import { loadAldoMachineSettings } from "./machineSettings";
import { providerKinds } from "./serverConfig.logic";

type EncodedConfig = {
  environment: Record<string, unknown>;
  providers: Array<Record<string, unknown>>;
} & Record<string, unknown>;

const encodeServerConfig = Schema.encodeUnknownSync(ServerConfig);

/** Which Aldo sign-in each provider driver runs on. */
const ACCOUNT_FOR_DRIVER: Record<string, "claude" | "codex" | "grok" | "muse"> = {
  claudeAgent: "claude",
  codex: "codex",
  grok: "grok",
  muse: "muse",
};

let latest: EncodedConfig | null = null;
let reportedProviders: string | null = null;
let fetchedFromAldo: Promise<void> | null = null;

/**
 * How many of the machine's providers it hasn't checked since its server
 * started: for its first seconds each one shows a warning with its sign-in
 * unknown (as not installed, or for Grok, Cursor and Muse as installed), as
 * does one whose check timed out until T3 tries again. That says nothing of
 * the user's agents.
 */
function uncheckedProviders(config: ServerConfig): number {
  return config.providers.filter(
    (provider) =>
      provider.enabled && provider.status === "warning" && provider.auth.status === "unknown",
  ).length;
}

function newestProviderCheck(config: ServerConfig): string {
  return config.providers.reduce((max, provider) => {
    const at = String(provider.checkedAt);
    return at > max ? at : max;
  }, "");
}

/**
 * Whether `a` says more of the user's agents than `b`: more kinds of agent
 * (its T3 started after one shipped), then fewer unchecked, then checked last.
 */
function saysMore(a: ServerConfig, b: ServerConfig): boolean {
  const kinds = providerKinds(a) - providerKinds(b);
  if (kinds !== 0) return kinds > 0;
  const unchecked = uncheckedProviders(a) - uncheckedProviders(b);
  return unchecked !== 0 ? unchecked < 0 : newestProviderCheck(a) > newestProviderCheck(b);
}

/**
 * The config of the connected cloud agent that has checked the most of its
 * providers, and checked them last (Aldo keeps what earlier reports said of
 * providers a machine hasn't checked yet).
 */
function connectedConfig(): ServerConfig | null {
  const configs = appAtomRegistry.get(environmentServerConfigsAtom);
  const presentations = appAtomRegistry.get(environmentPresentations.presentationsAtom);
  let best: ServerConfig | null = null;
  for (const [environmentId, presentation] of presentations) {
    if (presentation.connection.phase !== "connected" || !isAldoEnvironmentId(environmentId)) {
      continue;
    }
    const config = configs.get(environmentId);
    if (config && (!best || saysMore(config, best))) best = config;
  }
  return best;
}

/** The config last captured: every machine's config change calls capture, and most leave it as it was. */
let captured: ServerConfig | null = null;

function capture(): void {
  const config = connectedConfig();
  if (!config || config === captured) return;
  captured = config;
  const encoded = encodeServerConfig(config) as unknown as EncodedConfig;
  latest = encoded;
  // Save when the models (or their availability) change, not on every check.
  const providers = JSON.stringify(
    encoded.providers.map(({ checkedAt: _checkedAt, ...provider }) => provider),
  );
  if (providers === reportedProviders) return;
  reportedProviders = providers;
  void reportAldoServerConfig(encoded).catch(() => {
    reportedProviders = null;
    captured = null;
  });
}

/** Starts following cloud agents' configs. */
export function installAldoServerConfigCapture(): void {
  if (!isAldoCloud) return;
  appAtomRegistry.subscribe(environmentServerConfigsAtom, capture);
  window.setInterval(capture, 60_000);
}

async function template(): Promise<EncodedConfig | null> {
  capture();
  if (latest) return latest;
  fetchedFromAldo ??= fetchAldoServerConfig()
    .then((config) => {
      if (config && !latest) latest = config as EncodedConfig;
    })
    .catch(() => {
      fetchedFromAldo = null;
    });
  await fetchedFromAldo;
  return latest;
}

/** The providers, with their models, of the newest config any cloud agent reported (none before one has). */
export async function newestAldoProviders(): Promise<ReadonlyArray<Record<string, unknown>>> {
  return (await template())?.providers ?? [];
}

/** Calls `listener` whenever an agent's config changes, so newestAldoProviders may say more. Returns how to stop. */
export function onAldoServerConfigChange(listener: () => void): () => void {
  return appAtomRegistry.subscribe(environmentServerConfigsAtom, listener);
}

/**
 * The server config to show for machines that aren't running: the newest one
 * any cloud agent reported, with each provider's sign-in set from the user's
 * Aldo accounts (a machine gets those sign-ins when it starts, whatever the
 * reporting machine had): connected ones signed in, disconnected ones signed
 * out. If the accounts can't be read, providers stay as reported. Its
 * settings carry the user's that Aldo keeps (machineSettings.ts), which every
 * machine gets as it starts. Each machine's copy is this with its own
 * environment id (aldoServerConfigOf). None before any cloud agent has ever
 * reported one.
 */
export async function aldoServerConfigTemplate(): Promise<EncodedConfig | null> {
  const base = await template();
  if (!base) return null;
  const [accounts, kept] = await Promise.all([
    settingsAccounts.load().catch(() => null),
    loadAldoMachineSettings(),
  ]);
  const settings = { ...(base.settings as Record<string, unknown> | undefined), ...kept };
  const providers = base.providers.map((provider) => {
    const account = ACCOUNT_FOR_DRIVER[String(provider.driver)];
    const auth = (provider.auth ?? {}) as Record<string, unknown>;
    // An Aldo that doesn't keep this sign-in (an older one, for Muse Code) leaves it to the machine.
    if (!account || !accounts || !(account in accounts)) return provider;
    if (accounts[account]?.connected === true) {
      if (auth.status === "authenticated") return provider;
      const { message: _message, ...rest } = provider;
      return { ...rest, status: "ready", auth: { ...auth, status: "authenticated" } };
    }
    if (auth.status !== "authenticated") return provider;
    return {
      ...provider,
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Not signed in. Connect it in Settings → Models.",
    };
  });
  return { ...base, providers, settings };
}

/** A machine's copy of the template (aldoServerConfigTemplate). */
export function aldoServerConfigOf(config: EncodedConfig, environmentId: string): EncodedConfig {
  return { ...config, environment: { ...config.environment, environmentId } };
}

/** The server config to show for a machine that isn't running (aldoServerConfigTemplate). */
export async function aldoServerConfigFor(environmentId: string): Promise<EncodedConfig | null> {
  const config = await aldoServerConfigTemplate();
  return config && aldoServerConfigOf(config, environmentId);
}
