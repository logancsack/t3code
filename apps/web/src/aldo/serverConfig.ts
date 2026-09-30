// The models a thread offers before its machine runs. T3 caches each
// environment's server config (its providers and their models, capabilities),
// and a new thread's machine is registered with a copy of the newest config
// any of the user's cloud agents reported, so its model picker is complete
// the moment the thread opens. Whenever a cloud agent connects or its config
// changes, the newest one is saved to Aldo for other tabs and devices.

import { ServerConfig, type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "../state/presentation";
import { environmentServerConfigsAtom } from "../state/server";
import {
  fetchAldoAccounts,
  fetchAldoServerConfig,
  isAldoCloud,
  isAldoEnvironmentId,
  reportAldoServerConfig,
} from "./cloud";

type EncodedConfig = {
  environment: Record<string, unknown>;
  providers: Array<Record<string, unknown>>;
} & Record<string, unknown>;

const encodeServerConfig = Schema.encodeUnknownSync(ServerConfig);

/** Which Aldo sign-in each provider driver runs on. */
const ACCOUNT_FOR_DRIVER: Record<string, "claude" | "codex" | "grok"> = {
  claudeAgent: "claude",
  codex: "codex",
  grok: "grok",
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

/** Whether `a` says more of the user's agents than `b`: fewer providers unchecked, then checked last. */
function saysMore(a: ServerConfig, b: ServerConfig): boolean {
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
  let best: ServerConfig | null = null;
  for (const [environmentId, config] of configs) {
    if (!isAldoEnvironmentId(environmentId)) continue;
    const presentation = appAtomRegistry.get(
      environmentPresentations.presentationAtom(environmentId as EnvironmentId),
    );
    if (presentation?.connection.phase !== "connected") continue;
    if (!best || saysMore(config, best)) best = config;
  }
  return best;
}

function capture(): void {
  const config = connectedConfig();
  if (!config) return;
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

/**
 * The server config to show for machines that aren't running, by environment
 * id: the newest one any cloud agent reported, renamed for each machine, with
 * each provider's sign-in set from the user's Aldo accounts (a machine gets
 * those sign-ins when it starts, whatever the reporting machine had):
 * connected ones signed in, disconnected ones signed out. If the accounts
 * can't be read, providers stay as reported. None before any cloud agent has
 * ever reported one.
 */
export async function aldoServerConfigsFor(
  environmentIds: ReadonlyArray<string>,
): Promise<Map<string, EncodedConfig>> {
  const configs = new Map<string, EncodedConfig>();
  if (environmentIds.length === 0) return configs;
  const base = await template();
  if (!base) return configs;
  const accounts = await fetchAldoAccounts().catch(() => null);
  const providers = base.providers.map((provider) => {
    const account = ACCOUNT_FOR_DRIVER[String(provider.driver)];
    const auth = (provider.auth ?? {}) as Record<string, unknown>;
    if (!account || !accounts) return provider;
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
      message: "Not signed in. Connect it in Settings → Providers.",
    };
  });
  for (const environmentId of environmentIds) {
    configs.set(environmentId, {
      ...base,
      environment: { ...base.environment, environmentId },
      providers,
    });
  }
  return configs;
}

/** The server config to show for a machine that isn't running (aldoServerConfigsFor). */
export async function aldoServerConfigFor(environmentId: string): Promise<EncodedConfig | null> {
  return (await aldoServerConfigsFor([environmentId])).get(environmentId) ?? null;
}
