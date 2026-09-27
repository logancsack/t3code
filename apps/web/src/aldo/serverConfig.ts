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

function newestProviderCheck(config: ServerConfig): string {
  return config.providers.reduce((max, provider) => {
    const at = String(provider.checkedAt);
    return at > max ? at : max;
  }, "");
}

/** The config of the connected cloud agent that checked its providers last. */
function connectedConfig(): ServerConfig | null {
  const configs = appAtomRegistry.get(environmentServerConfigsAtom);
  let best: ServerConfig | null = null;
  for (const [environmentId, config] of configs) {
    if (!isAldoEnvironmentId(environmentId)) continue;
    const presentation = appAtomRegistry.get(
      environmentPresentations.presentationAtom(environmentId as EnvironmentId),
    );
    if (presentation?.connection.phase !== "connected") continue;
    if (!best || newestProviderCheck(config) > newestProviderCheck(best)) best = config;
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
 * The server config to show for a machine that isn't running: the newest one
 * any cloud agent reported, renamed for this machine, with providers the user has signed in
 * to through Aldo marked signed in (the machine gets those sign-ins when it
 * starts, whatever the reporting machine had). Null before any cloud agent
 * has ever reported one.
 */
export async function aldoServerConfigFor(environmentId: string): Promise<EncodedConfig | null> {
  const [base, accounts] = await Promise.all([template(), fetchAldoAccounts().catch(() => null)]);
  if (!base) return null;
  return {
    ...base,
    environment: { ...base.environment, environmentId },
    providers: base.providers.map((provider) => {
      const account = ACCOUNT_FOR_DRIVER[String(provider.driver)];
      const auth = (provider.auth ?? {}) as Record<string, unknown>;
      if (!account || !accounts?.[account]?.connected || auth.status === "authenticated") {
        return provider;
      }
      const { message: _message, ...rest } = provider;
      return { ...rest, status: "ready", auth: { ...auth, status: "authenticated" } };
    }),
  };
}
