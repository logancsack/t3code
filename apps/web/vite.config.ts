// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodeZlib from "node:zlib";

import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import compression from "compression";
import { playwright } from "vite-plus/test/browser-playwright";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig, type Connect, type Plugin } from "vite-plus";
import * as Hash from "effect/Hash";
import pkg from "./package.json" with { type: "json" };
import pdfjsPkg from "pdfjs-dist/package.json" with { type: "json" };

import {
  DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES,
  DEV_PROXIED_PATH_PREFIXES,
} from "@t3tools/shared/devProxy";

import { loadRepoEnv } from "../../scripts/lib/public-config";
import { resolveTaggedSourceVersion } from "../../scripts/lib/tagged-source-version";
import { thirdPartyLicensesPlugin } from "../../scripts/lib/third-party-licenses";
import { tailwindPlugins } from "./vite/tailwind";
import { warmBundledDevPlugin } from "./vite/warmBundledDev";
import { formatAppDisplayName, resolveWebAppStageLabel } from "./src/branding.logic";
import { showAldoBootError } from "./src/aldo/bootError";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

// Signal single-origin dev explicitly; loadRepoEnv can restore deleted URL keys from .env.
const isSingleOriginDev = process.env.T3CODE_SINGLE_ORIGIN_DEV === "1";

const port = Number(process.env.PORT ?? 5733);
const explicitHost = process.env.HOST?.trim();
const host = explicitHost || "localhost";
const configuredWsUrl = isSingleOriginDev ? undefined : process.env.VITE_WS_URL?.trim();
const configuredHttpUrl = isSingleOriginDev ? undefined : process.env.VITE_HTTP_URL?.trim();
const configuredRelayUrl = repoEnv.VITE_T3CODE_RELAY_URL?.trim() || "";
const configuredClerkPublishableKey = repoEnv.VITE_CLERK_PUBLISHABLE_KEY?.trim() || "";
const configuredClerkJwtTemplate = repoEnv.VITE_CLERK_JWT_TEMPLATE?.trim() || "";
const configuredClerkCliOAuthClientId = repoEnv.VITE_CLERK_CLI_OAUTH_CLIENT_ID?.trim() || "";
const configuredRelayTracingUrl = repoEnv.VITE_RELAY_OTLP_TRACES_URL?.trim() || "";
const configuredRelayTracingDataset = repoEnv.VITE_RELAY_OTLP_TRACES_DATASET?.trim() || "";
const configuredRelayTracingToken = repoEnv.VITE_RELAY_OTLP_TRACES_TOKEN?.trim() || "";
const configuredHostedAppChannel = process.env.VITE_HOSTED_APP_CHANNEL?.trim() || "";
const configuredReleaseChannel =
  process.env.T3CODE_BUILT_DEV === "1" ? "dev" : process.env.VITE_RELEASE_CHANNEL?.trim() || "";
const configuredDesktopUpdateRepository =
  process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY?.trim() ||
  process.env.GITHUB_REPOSITORY?.trim() ||
  "";
const configuredFeatureSecrets = process.env.T3CODE_FEATURE_SECRETS?.trim() || "";
const configuredHostedAppUrl = (() => {
  const explicitHostedAppUrl = process.env.VITE_HOSTED_APP_URL?.trim();
  if (explicitHostedAppUrl) {
    return explicitHostedAppUrl;
  }
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return undefined;
})();
const sourcemapEnv = process.env.T3CODE_WEB_SOURCEMAP?.trim().toLowerCase();

// `vp run dev --share --built` rebuilds on every change. The license manifest
// is about 2 s of each build, and nothing in that mode reads it.
const builtDev = process.env.T3CODE_BUILT_DEV === "1";

const bundledDevEnv = process.env.T3CODE_BUNDLED_DEV?.trim().toLowerCase();
const bundledDev = bundledDevEnv === "1" || bundledDevEnv === "true";

// Bundled dev and `build --watch` pass Rolldown `exclude` but not Vite's default `ignored`, so
// they watch node_modules. Those files are pnpm-store hardlinks shared by every worktree, so each
// `vp i` or worktree removal elsewhere rebuilds every long-running server and leaks native memory.
const rolldownWatchExclude = [/[\\/]node_modules[\\/]/];

const buildSourcemap: boolean | "hidden" =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.browser.test.{ts,tsx}"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    setupFiles: [
      "../../packages/shared/src/testing/longTempDir.ts",
      "../../packages/shared/src/testing/providerEnv.ts",
      "../../packages/shared/src/testing/gitEnv.ts",
      "./test/unitSetup.ts",
    ],
  },
} satisfies TestProjectInlineConfiguration;

// Hash checkout paths to ports 20000-23999; Vitest's fixed port collides under inherited strictPort.
// Stay below ephemeral ranges: Windows reserves Hyper-V/WSL blocks there and EACCES is not skipped.
const browserTestApiPort = 20_000 + ((Hash.string(import.meta.dirname) >>> 0) % 4_000);

const browserTestProject = {
  extends: true,
  // Pre-bundle lazy browser and worker dependencies to avoid mid-run reloads.
  optimizeDeps: {
    include: [
      "vite-plus/test/browser",
      "@base-ui/react/autocomplete",
      "saxes",
      "@betteroffice/docx/editor",
      "@betteroffice/docx/layout",
      "@betteroffice/docx/layout/render",
      "@betteroffice/docx/yrs",
      "@betteroffice/fonts",
      "@betteroffice/pptx",
      "@betteroffice/xlsx",
      "@betteroffice/xlsx/headless",
      "fast-xml-parser",
      "entities",
      "dompurify",
      "heic-to/csp",
      "jszip",
      "pdfjs-dist",
      "sql.js",
      "tiff",
    ],
  },
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.{ts,tsx}"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    setupFiles: ["./test/browserSetup.ts"],
    api: { port: browserTestApiPort, strictPort: false },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
      commands: {
        // Playwright's mouse outlives each test, so whatever mounts under its last
        // position starts hovered. test/browserSetup.ts parks it off the page before each test.
        resetPointer: async ({ page }) => {
          await page.mouse.move(-1, -1);
        },
      },
    },
  },
} satisfies TestProjectInlineConfiguration;

// Render scenarios count React commits; they run only through scripts/render-metrics.ts,
// which reads the per-scenario reports this command writes.
const renderScenariosProject = {
  ...browserTestProject,
  test: {
    ...browserTestProject.test,
    name: "renders",
    include: ["test/*.renders.tsx"],
    // App scenarios mount the whole app per test, which outlasts 15s on a loaded machine.
    hookTimeout: 60_000,
    testTimeout: 60_000,
    setupFiles: ["./test/renderCounter.ts", ...browserTestProject.test.setupFiles],
    browser: {
      ...browserTestProject.test.browser,
      // Vitest names each instance in place, so a shared array would clash with the browser project.
      instances: [{ browser: "chromium" }],
      commands: {
        ...browserTestProject.test.browser.commands,
        writeRenderReport: async (_context, scenario: string, json: string) => {
          const directory = process.env.T3CODE_RENDER_REPORT_DIR;
          if (!directory) throw new Error("T3CODE_RENDER_REPORT_DIR is not set");
          await NodeFSP.writeFile(`${directory}/${scenario}.json`, json);
        },
      },
    },
  },
} satisfies TestProjectInlineConfiguration;

function resolveDevProxyTarget(
  backendPort: string | undefined,
  wsUrl: string | undefined,
): string | undefined {
  const port = Number(backendPort?.trim());
  if (Number.isInteger(port) && port > 0) {
    return `http://localhost:${port}/`;
  }

  // dev:desktop connects directly to the backend; derive its target from the explicit WebSocket URL.
  if (!wsUrl) {
    return undefined;
  }

  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

const devProxyTarget = resolveDevProxyTarget(process.env.T3CODE_PORT, configuredWsUrl);

// Brotli quality 5 encodes in hundreds of ms; default quality 11 would replace transfer stalls with encode stalls.
function devCompressionPlugin(): Plugin {
  return {
    name: "t3code:dev-compression",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        compression({
          brotli: { params: { [NodeZlib.constants.BROTLI_PARAM_QUALITY]: 5 } },
        }) as unknown as Connect.NextHandleFunction,
      );
    },
  };
}

// A static import cycle between chunks can run a chunk before the values it imports exist,
// which blanks the app at boot. Fail the build instead of shipping it.
function chunkCycleGuardPlugin(): Plugin {
  return {
    name: "t3code:chunk-cycle-guard",
    apply: "build",
    generateBundle(_options, bundle) {
      const done = new Set<string>();
      const visit = (fileName: string, path: string[]) => {
        if (done.has(fileName)) return;
        const start = path.indexOf(fileName);
        if (start !== -1) {
          this.error(`Chunk import cycle: ${[...path.slice(start), fileName].join(" -> ")}`);
        }
        const chunk = bundle[fileName];
        if (chunk?.type !== "chunk") return;
        for (const imported of chunk.imports) visit(imported, [...path, fileName]);
        done.add(fileName);
      };
      for (const fileName of Object.keys(bundle)) visit(fileName, []);
    },
  };
}

// Bundled dev never evicts emitted files from memory (vitejs/vite#23781), so hashed names keep
// a copy of every changed chunk from every rebuild. Fixed names overwrite the previous copy.
function bundledDevStableNamesPlugin(): Plugin {
  return {
    name: "t3code:bundled-dev-stable-names",
    apply: "serve",
    outputOptions: (options) => ({
      ...options,
      chunkFileNames: "assets/[name].js",
      assetFileNames: "assets/[name][extname]",
    }),
  };
}

// Stamps index.html's title with the name branding.ts resolves once the app
// loads, so a tab opens on the right channel instead of flashing another's.
// Desktop swaps in its injected branding from an inline script in index.html.
function bootstrapTitlePlugin(): Plugin {
  let development = false;
  return {
    name: "t3code:bootstrap-title",
    configResolved(config) {
      // The same flag Vite exposes to the app as import.meta.env.DEV.
      development = !config.isProduction;
    },
    transformIndexHtml(html) {
      const stageLabel = resolveWebAppStageLabel({
        hostedAppChannel: configuredHostedAppChannel,
        development,
      });
      const title = formatAppDisplayName({ baseName: "T3 Code", stageLabel });
      return html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
    },
  };
}

// Allow Tailnet hosts for sharing; Tailscale-controlled DNS prevents attacker rebinding.
// Aldo cloud builds ship under the Aldo brand: Aldo icons (public-aldo/), the
// Aldo document title and splash, and Aldo in user-facing prose. Protocol
// identifiers (t3code:* storage keys, t3.json, theme ids) stay untouched.
const aldoCloud = process.env.VITE_ALDO_CLOUD?.trim() === "1";

const ALDO_PROSE_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["`t3 connect`", "the connect command"],
  ["From t3.json", "From project config"],
  [
    " (t3.json at the repository root). See https://t3.codes for documentation.",
    " at the repository root.",
  ],
  ["a T3 Connect", "an Aldo Connect"],
  ["T3 Connect", "Aldo Connect"],
  ["t3 connect", "aldo connect"],
  ["T3 Code", "Aldo"],
  ["T3 Chat", "Aldo"],
  ["T3 server", "Aldo server"],
  ["T3 environment", "Aldo environment"],
  ["T3 project file", "Aldo project file"],
  ["T3 process", "Aldo process"],
  ["T3 system footprint", "Aldo system footprint"],
  ["known T3 operations", "known Aldo operations"],
  ["Managed DevPC", "Aldo"],
  // Settings pages by the names Aldo gives them (settingsSearch.ts).
  ["Open Settings -> Source Control", "Open Settings → Git hosts"],
  ["Source Control Providers", "Git hosts"],
  ["`T3`", "`Aldo`"],
];

function aldoBrandingPlugin(): Plugin {
  return {
    name: "aldo:branding",
    apply: "build",
    transformIndexHtml(html) {
      return html
        .replace(
          /<title>[^<]*<\/title>/,
          [
            "<title>Aldo</title>",
            '<meta name="description" content="Agents that get things done, each with its own computer." />',
          ].join("\n    "),
        )
        .replace(
          /<link rel="icon"[^>]*>/,
          [
            '<link rel="icon" href="/favicon.ico" sizes="48x48" />',
            '<link rel="icon" href="/icon.svg" type="image/svg+xml" />',
          ].join("\n    "),
        )
        .replace('aria-label="T3 Code splash screen"', 'aria-label="Aldo"')
        .replace('src="/apple-touch-icon.png" alt="T3 Code"', 'src="/icon.svg" alt="Aldo"');
    },
    renderChunk(code) {
      const branded = ALDO_PROSE_REPLACEMENTS.reduce(
        (source, [legacy, aldo]) => source.replaceAll(legacy, aldo),
        code,
      );
      return branded === code ? null : { code: branded, map: null };
    },
  };
}

function aldoBootstrapPlugin(): Plugin {
  const entry = '<script type="module" src="/src/bootstrap.ts"></script>';
  return {
    name: "aldo:bootstrap",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler(html, { filename }) {
        // replay.html already names Aldo's entry.
        if (!filename.endsWith("/index.html")) return html;
        if (!html.includes(entry))
          throw new Error("aldo:bootstrap: index.html has no entry script.");
        // A static entry makes $initial include the UI graph. Install its error
        // handler outside that graph, so a missing or broken module still shows Reload.
        return html.replace(
          entry,
          `<script>
            window.addEventListener("error", function(event) {
              if (!document.getElementById("boot-shell")) return;
              if (event instanceof ErrorEvent || event.target instanceof HTMLScriptElement) {
                (${showAldoBootError.toString()})(event.error || new Error("Startup module failed to load"));
              }
            }, true);
          </script>
          <script type="module" src="/src/aldo/bootstrap.ts"></script>`,
        );
      },
    },
  };
}

// Aldo's interface font (src/aldo/fonts.css) starts downloading with the page,
// beside its scripts, rather than once the app first draws text. Only its Latin
// file, every weight in one; other scripts and italics load as text needs them.
function aldoFontPreloadPlugin(): Plugin {
  let base = "/";
  return {
    name: "aldo:font-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const font = Object.values(context.bundle ?? {}).find(
          (output) =>
            output.type === "asset" &&
            /(^|\/)geist-latin-wght-normal-[^/]+\.woff2$/.test(output.fileName),
        );
        if (!font)
          throw new Error("aldo:font-preload: the build has no Geist Latin file to preload.");
        const charset = '<meta charset="UTF-8" />';
        if (!html.includes(charset))
          throw new Error("aldo:font-preload: index.html has no charset.");
        return html.replace(
          charset,
          `${charset}\n    <link rel="preload" href="${base}${font.fileName}" as="font" type="font/woff2" crossorigin />`,
        );
      },
    },
  };
}

const configuredAllowedHosts = (process.env.T3CODE_DEV_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const allowedHosts = [".ts.net", ...configuredAllowedHosts];

export default defineConfig(({ command }) => {
  // `vp dev` and `--built` dev pair this client with a server run from source, which reports the
  // manifest version. Only a production build is paired with a packed server.
  const configuredAppVersion =
    process.env.APP_VERSION?.trim() ||
    (command === "build" && !builtDev
      ? resolveTaggedSourceVersion(`${import.meta.dirname}/../..`, pkg.version)
      : pkg.version);
  return {
    run: {
      tasks: {
        // A local tsbuildinfo is leftover build state, not a typecheck input.
        typecheck: {
          command: "effect-tsgo tsrs --noEmit",
          cache: { input: [{ auto: true }, "!*.tsbuildinfo"] },
        },
      },
    },
    assetsInclude: ["**/*.wasm"],
    publicDir: aldoCloud ? "public-aldo" : "public",
    plugins: [
      bootstrapTitlePlugin(),
      ...(aldoCloud ? [aldoBrandingPlugin(), aldoBootstrapPlugin(), aldoFontPreloadPlugin()] : []),
      devCompressionPlugin(),
      chunkCycleGuardPlugin(),
      builtDev
        ? undefined
        : thirdPartyLicensesPlugin({
            bundleName: "web",
            configFile: new URL("../../third-party-licenses.config.json", import.meta.url),
            packageManifests: [
              { bundle: "web", path: new URL("./package.json", import.meta.url) },
              { bundle: "server", path: new URL("../server/package.json", import.meta.url) },
              { bundle: "desktop", path: new URL("../desktop/package.json", import.meta.url) },
            ],
          }),
      tanstackRouter({ autoCodeSplitting: true }),
      react({ compiler: true }),
      tailwindPlugins(bundledDev),
      warmBundledDevPlugin(),
      bundledDev ? bundledDevStableNamesPlugin() : undefined,
    ],
    optimizeDeps: {
      include: [
        "@clerk/clerk-js",
        "@clerk/react/internal",
        "@pierre/diffs",
        "@pierre/diffs/edit",
        "@pierre/diffs/react",
        "@pierre/diffs/worker/worker.js",
        "effect/Array",
        "effect/Order",
        "react-dom/client",
      ],
    },
    define: {
      "import.meta.env.VITE_WS_URL": JSON.stringify(configuredWsUrl ?? ""),
      // Override .env URLs with empty values in single-origin dev so clients use window.location.origin.
      "import.meta.env.VITE_HTTP_URL": JSON.stringify(configuredHttpUrl ?? ""),
      "import.meta.env.VITE_T3CODE_RELAY_URL": JSON.stringify(configuredRelayUrl),
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(configuredClerkPublishableKey),
      "import.meta.env.VITE_CLERK_JWT_TEMPLATE": JSON.stringify(configuredClerkJwtTemplate),
      "import.meta.env.VITE_CLERK_CLI_OAUTH_CLIENT_ID": JSON.stringify(
        configuredClerkCliOAuthClientId,
      ),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_URL": JSON.stringify(configuredRelayTracingUrl),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_DATASET": JSON.stringify(
        configuredRelayTracingDataset,
      ),
      "import.meta.env.VITE_RELAY_OTLP_TRACES_TOKEN": JSON.stringify(configuredRelayTracingToken),
      "import.meta.env.VITE_HOSTED_APP_URL": JSON.stringify(configuredHostedAppUrl ?? ""),
      "import.meta.env.VITE_HOSTED_APP_CHANNEL": JSON.stringify(configuredHostedAppChannel),
      "import.meta.env.T3CODE_DESKTOP_UPDATE_REPOSITORY": JSON.stringify(
        configuredDesktopUpdateRepository,
      ),
      "import.meta.env.T3CODE_FEATURE_SECRETS": JSON.stringify(configuredFeatureSecrets),
      "import.meta.env.VITE_RELEASE_CHANNEL": JSON.stringify(configuredReleaseChannel),
      "import.meta.env.APP_VERSION": JSON.stringify(configuredAppVersion),
      "import.meta.env.VITE_ALDO_CLOUD": JSON.stringify(aldoCloud ? "1" : ""),
    },
    resolve: {
      tsconfigPaths: true,
      dedupe: ["react", "react-dom"],
    },
    experimental: {
      bundledDev,
    },
    server: {
      host,
      port,
      strictPort: true,
      allowedHosts,
      // Warm the module graph before first request to avoid serial import transforms over tailnet.
      // Bundled dev ignores this; warmBundledDevPlugin handles it there.
      warmup: {
        clientFiles: ["./src/main.tsx"],
      },
      watch: { exclude: rolldownWatchExclude },
      ...(devProxyTarget
        ? {
            // Share prefixes with the backend catch-all so the proxy and 404 lists cannot drift.
            proxy: Object.fromEntries(
              DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
                prefix,
                {
                  target: devProxyTarget,
                  changeOrigin: !DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES.has(prefix),
                  ...(prefix === "/ws" || prefix === "/api" ? { ws: true } : {}),
                },
              ]),
            ),
          }
        : {}),
      // Electron needs an explicit HMR host; elsewhere derive it from page origin for Tailscale/LAN.
      ...(explicitHost
        ? {
            hmr: {
              protocol: "ws",
              host: explicitHost,
              clientPort: port,
            },
          }
        : {}),
    },
    // Tailwind needs devSourcemap to avoid Rolldown SOURCEMAP_BROKEN on sourcemapped builds.
    css: {
      devSourcemap: buildSourcemap !== false,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      manifest: true,
      sourcemap: buildSourcemap,
      ...(builtDev ? { watch: { exclude: rolldownWatchExclude } } : {}),
      rolldownOptions: {
        ...(aldoCloud ? { input: { index: "index.html", replay: "replay.html" } } : {}),
        output: {
          ...(aldoCloud
            ? {
                codeSplitting: {
                  // Aldo's entry imports the whole first screen (aldoBootstrapPlugin). It goes in
                  // one chunk, and its libraries in another whose name and hash stay the same
                  // across releases that change only app code, so returning devices keep it
                  // cached. Vite's preload helper goes with the libraries: every chunk with an
                  // import() imports it.
                  groups: [
                    {
                      name: "vendor",
                      test: /[\\/]node_modules[\\/]|^\0vite\/preload-helper/,
                      tags: ["$initial" as const],
                      priority: 1,
                    },
                    { name: "index", tags: ["$initial" as const] },
                  ],
                },
              }
            : {}),
          // PDF.js resolves decoder modules and ICC data relative to wasmUrl.
          assetFileNames: (asset) =>
            asset.originalFileNames.some((path) => /[/\\]pdfjs-dist[/\\]wasm[/\\]/.test(path))
              ? `assets/pdfjs-${pdfjsPkg.version}/[name][extname]`
              : "assets/[name]-[hash][extname]",
        },
      },
    },
    worker: { format: "es" },
    test: {
      projects: [
        defineProject(unitTestProject),
        defineProject(browserTestProject),
        defineProject(renderScenariosProject),
      ],
    },
  };
});
