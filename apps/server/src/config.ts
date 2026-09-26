/**
 * ServerConfig - Runtime configuration services.
 *
 * Defines process-level server configuration and networking helpers used by
 * startup and runtime layers.
 *
 * @module ServerConfig
 */
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as LogLevel from "effect/LogLevel";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { sweepStalePendingAttachments } from "./attachmentStore.ts";

export const DEFAULT_PORT = 3773;

export const RuntimeMode = Schema.Literals(["web", "desktop"]);
export type RuntimeMode = typeof RuntimeMode.Type;

export const StartupPresentation = Schema.Literals(["browser", "headless"]);
export type StartupPresentation = typeof StartupPresentation.Type;

/**
 * ServerDerivedPaths - Derived paths from the base directory.
 */
export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;
  readonly keybindingsConfigPath: string;
  readonly settingsPath: string;
  /** Palettes this machine publishes for clients to follow, one file per theme. */
  readonly environmentThemesDir: string;
  readonly providerStatusCacheDir: string;
  readonly worktreesDir: string;
  readonly attachmentsDir: string;
  readonly logsDir: string;
  readonly serverLogPath: string;
  readonly serverTracePath: string;
  readonly providerLogsDir: string;
  readonly providerEventLogPath: string;
  readonly terminalLogsDir: string;
  readonly anonymousIdPath: string;
  readonly environmentIdPath: string;
  readonly serverRuntimeStatePath: string;
  readonly secretsDir: string;
}

export interface DeriveServerPathsOptions {
  readonly baseDirIsExplicit?: boolean;
}

/**
 * ServerConfig - Service tag for server runtime configuration.
 */
export const ServerMode = Schema.Literals(["standalone", "hub", "runner"]);
export type ServerMode = typeof ServerMode.Type;

/** Standalone unless a hub or runner mode was selected. */
export const serverModeOf = (config: {
  readonly serverMode?: ServerMode | undefined;
}): ServerMode => config.serverMode ?? "standalone";

export interface HubServerConfig {
  /**
   * Postgres URL for the hub schema, using a role without BYPASSRLS. Without
   * it a hub persists to its SQLite state database (tests and development).
   */
  readonly databaseUrl?: string | undefined;
  /** Optional role used only to apply hub migrations. */
  readonly databaseAdminUrl?: string | undefined;
  /** The Aldo user whose rows this process owns; required with `databaseUrl`. */
  readonly tenantId?: string | undefined;
  /** Base64 32-byte key that encrypts per-user secrets at rest; required with `databaseUrl`. */
  readonly secretKey?: string | undefined;
  /** Machine directory base URL; absent only with a development `runnerUrl`. */
  readonly machinesUrl?: string | undefined;
  readonly machinesToken?: string | undefined;
  /**
   * Public base URL at which thread machines reach this hub (its `/mcp`
   * endpoint). Without it, runners are given the hub's local MCP endpoint,
   * which only a runner on the same host can reach.
   */
  readonly publicUrl?: string | undefined;
  /**
   * Same-origin URL template of a thread machine's browser page, with
   * `{threadId}`; provider sign-in flows that finish in a browser on the
   * sign-in machine link to it. Defaults to `/_devpc/threads/{threadId}/browser`.
   */
  readonly threadBrowserUrlTemplate?: string | undefined;
  /**
   * Root of thread checkouts on thread machines (`/workspace/t` by default).
   * Hub and machines must agree on it; only tests and local development
   * change it.
   */
  readonly checkoutRoot?: string | undefined;
}

export class ServerConfig extends Context.Service<
  ServerConfig,
  ServerDerivedPaths & {
    readonly logLevel: LogLevel.LogLevel;
    readonly traceMinLevel: LogLevel.LogLevel;
    readonly traceTimingEnabled: boolean;
    readonly traceBatchWindowMs: number;
    readonly traceMaxBytes: number;
    readonly traceMaxFiles: number;
    readonly otlpTracesUrl: string | undefined;
    readonly otlpMetricsUrl: string | undefined;
    readonly otlpExportIntervalMs: number;
    readonly otlpServiceName: string;
    readonly mode: RuntimeMode;
    readonly port: number;
    readonly host: string | undefined;
    readonly cwd: string;
    readonly baseDir: string;
    readonly staticDir: string | undefined;
    readonly devUrl: URL | undefined;
    readonly devAllowedOrigins: ReadonlyArray<string>;
    readonly noBrowser: boolean;
    readonly managedDevPc: boolean;
    /**
     * Whether the Muse Code driver and its authentication connector are
     * available in this server process. Standalone T3 Code enables the driver
     * by default; managed deployments can explicitly withhold it while still
     * running the same release artifact.
     */
    readonly museCodeEnabled: boolean;
    /**
     * Explicit operator gate for Prime Agent subscription OAuth. These
     * third-party OAuth routes stay unavailable by default; API-key and cloud
     * credential routes are unaffected.
     */
    readonly primeAgentSubscriptionOAuthEnabled: boolean;
    /**
     * Shared only with Aldo's loopback workspace gateway. It authenticates
     * managed automation routes that are never exposed by standalone T3 Code.
     */
    readonly managedGatewayToken?: string | undefined;
    /**
     * `standalone` owns everything (the default). `hub` owns orchestration and
     * persistence but no checkout; thread work runs on per-thread runners.
     * `runner` serves one thread's checkout to a hub. See
     * docs/internals/thread-machines.md.
     */
    readonly serverMode?: ServerMode | undefined;
    /** Hub-mode settings; present only when `serverMode` is `hub`. */
    readonly hub?: HubServerConfig | undefined;
    /**
     * Development override for hub mode: a single runner WebSocket URL used
     * for every thread instead of resolving runners through the machine
     * directory.
     */
    readonly runnerUrl?: string | undefined;
    /** Bearer presented to runners (hub) or required from hubs (runner). */
    readonly runnerToken?: string | undefined;
    /** Runner mode: the only thread this runner serves. */
    readonly runnerThreadId?: string | undefined;
    /** Runner mode: the absolute checkout path of that thread. */
    readonly runnerCheckout?: string | undefined;
    readonly startupPresentation: StartupPresentation;
    readonly desktopBootstrapToken: string | undefined;
    readonly desktopTelemetryFd?: number | undefined;
    readonly desktopTelemetryControlFd?: number | undefined;
    readonly resourceMonitorPath?: string | undefined;
    readonly autoBootstrapProjectFromCwd: boolean;
    readonly logWebSocketEvents: boolean;
    readonly tailscaleServeEnabled: boolean;
    readonly tailscaleServePort: number;
  }
>()("t3/config/ServerConfig") {
  /** @deprecated Import and use `layerTest` from this module. */
  static readonly layerTest = (
    cwd: string,
    baseDirOrPrefix: string | { readonly prefix: string },
  ) => layerTest(cwd, baseDirOrPrefix);
}

export const make = (config: ServerConfig["Service"]) => ServerConfig.of(config);

export const layer = (config: ServerConfig["Service"]) => Layer.succeed(ServerConfig, make(config));

export const deriveServerPaths = Effect.fn(function* (
  baseDir: ServerConfig["Service"]["baseDir"],
  devUrl: ServerConfig["Service"]["devUrl"],
  options: DeriveServerPathsOptions = {},
): Effect.fn.Return<ServerDerivedPaths, never, Path.Path> {
  const { join } = yield* Path.Path;
  const stateDir = join(
    baseDir,
    devUrl !== undefined && !options.baseDirIsExplicit ? "dev" : "userdata",
  );
  const dbPath = join(stateDir, "state.sqlite");
  const attachmentsDir = join(stateDir, "attachments");
  const logsDir = join(stateDir, "logs");
  const providerLogsDir = join(logsDir, "provider");
  const providerStatusCacheDir = join(baseDir, "caches");
  return {
    stateDir,
    dbPath,
    keybindingsConfigPath: join(stateDir, "keybindings.json"),
    settingsPath: join(stateDir, "settings.json"),
    environmentThemesDir: join(stateDir, "themes"),
    providerStatusCacheDir,
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir,
    logsDir,
    serverLogPath: join(logsDir, "server.log"),
    serverTracePath: join(logsDir, "server.trace.ndjson"),
    providerLogsDir,
    providerEventLogPath: join(providerLogsDir, "events.log"),
    terminalLogsDir: join(logsDir, "terminals"),
    anonymousIdPath: join(stateDir, "anonymous-id"),
    environmentIdPath: join(stateDir, "environment-id"),
    serverRuntimeStatePath: join(stateDir, "server-runtime.json"),
    secretsDir: join(stateDir, "secrets"),
  };
});

export const ensureServerDirectories = Effect.fn(function* (derivedPaths: ServerDerivedPaths) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* Effect.all(
    [
      fs.makeDirectory(derivedPaths.stateDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.logsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.providerLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.terminalLogsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.attachmentsDir, { recursive: true }),
      fs.makeDirectory(derivedPaths.worktreesDir, { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.keybindingsConfigPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.settingsPath), { recursive: true }),
      fs.makeDirectory(derivedPaths.providerStatusCacheDir, { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.anonymousIdPath), { recursive: true }),
      fs.makeDirectory(path.dirname(derivedPaths.serverRuntimeStatePath), { recursive: true }),
    ],
    { concurrency: "unbounded" },
  );

  const swept = sweepStalePendingAttachments({
    attachmentsDir: derivedPaths.attachmentsDir,
    nowMs: yield* Clock.currentTimeMillis,
  });
  if (swept.deleted > 0) {
    yield* Effect.logInfo("Removed expired attachment uploads.", { deleted: swept.deleted });
  }
});

const makeTest = Effect.fn("ServerConfig.makeTest")(function* (
  cwd: string,
  baseDirOrPrefix: string | { readonly prefix: string },
) {
  const devUrl = undefined;
  const fs = yield* FileSystem.FileSystem;
  const baseDir =
    typeof baseDirOrPrefix === "string"
      ? baseDirOrPrefix
      : yield* fs.makeTempDirectoryScoped({ prefix: baseDirOrPrefix.prefix });
  const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
  yield* ensureServerDirectories(derivedPaths);

  return ServerConfig.of({
    logLevel: "Error",
    traceMinLevel: "Info",
    traceTimingEnabled: true,
    traceBatchWindowMs: 200,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 10,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 10_000,
    otlpServiceName: "t3-server",
    cwd,
    baseDir,
    ...derivedPaths,
    mode: "web",
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
    port: 0,
    host: undefined,
    desktopBootstrapToken: undefined,
    desktopTelemetryFd: undefined,
    desktopTelemetryControlFd: undefined,
    resourceMonitorPath: undefined,
    staticDir: undefined,
    devUrl,
    devAllowedOrigins: [],
    noBrowser: false,
    managedDevPc: false,
    museCodeEnabled: true,
    primeAgentSubscriptionOAuthEnabled: false,
    startupPresentation: "browser",
  });
});

export const layerTest = (cwd: string, baseDirOrPrefix: string | { readonly prefix: string }) =>
  Layer.effect(ServerConfig, makeTest(cwd, baseDirOrPrefix));

export const resolveStaticDir = Effect.fn(function* () {
  const { join, resolve } = yield* Path.Path;
  const { exists } = yield* FileSystem.FileSystem;
  const bundledClient = resolve(join(import.meta.dirname, "client"));
  const bundledStat = yield* exists(join(bundledClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (bundledStat) {
    return bundledClient;
  }

  const monorepoClient = resolve(join(import.meta.dirname, "../../web/dist"));
  const monorepoStat = yield* exists(join(monorepoClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (monorepoStat) {
    return monorepoClient;
  }
  return undefined;
});
