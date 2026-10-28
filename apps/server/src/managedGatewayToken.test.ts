// @effect-diagnostics nodeBuiltinImport:off - the test spawns a real child process to see what it inherits.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { it as effectIt } from "@effect/vitest";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const NAME = "WORKSPACE_GATEWAY_TOKEN";
const originalToken = process.env[NAME];

afterEach(() => {
  vi.resetModules();
  if (originalToken === undefined) delete process.env[NAME];
  else process.env[NAME] = originalToken;
});

/** What a process the server spawns (an agent, a terminal, a tool) finds of the token. */
const inheritedByChild = () =>
  NodeChildProcess.execFileSync(
    process.execPath,
    ["-e", `process.stdout.write(process.env.${NAME} ?? "")`],
    {
      encoding: "utf8",
    },
  );

describe("managed gateway token", () => {
  it("is taken out of the environment as the server's entrypoint loads, so no child process inherits it", async () => {
    process.env[NAME] = "gateway-token-for-this-start";
    expect(inheritedByChild()).toBe("gateway-token-for-this-start");

    vi.resetModules();
    await import("./bin.ts");

    expect(process.env[NAME]).toBeUndefined();
    expect(inheritedByChild()).toBe("");
    // The server still holds it: it's what the gateway routes compare against.
    const { managedGatewayToken } = await import("./managedGatewayToken.ts");
    expect(managedGatewayToken).toBe("gateway-token-for-this-start");
  });

  effectIt.effect(
    "is what the resolved server config carries, though the environment no longer does",
    () =>
      Effect.gen(function* () {
        process.env[NAME] = "gateway-token-for-this-start";
        vi.resetModules();
        const { resolveServerConfig } = yield* Effect.promise(() => import("./cli/config.ts"));
        const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-gateway-token-"));
        const flags = Object.fromEntries(
          [
            "mode",
            "port",
            "host",
            "baseDir",
            "cwd",
            "devUrl",
            "noBrowser",
            "bootstrapFd",
            "autoBootstrapProjectFromCwd",
            "logWebSocketEvents",
            "tailscaleServeEnabled",
            "tailscaleServePort",
          ].map((flag) => [flag, Option.none()]),
        ) as unknown as Parameters<typeof resolveServerConfig>[0];
        const env = {
          T3CODE_HOME: home,
          T3CODE_MODE: "desktop",
          T3CODE_PORT: "4103",
          T3CODE_MANAGED_DEVPC: "true",
        };
        const config = yield* resolveServerConfig(flags, Option.none()).pipe(
          Effect.provide(
            Layer.mergeAll(
              ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
              NetService.layer,
              NodeServices.layer,
            ),
          ),
          Effect.ensuring(Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true }))),
        );

        expect(config.managedGatewayToken).toBe("gateway-token-for-this-start");
        expect(process.env[NAME]).toBeUndefined();
      }),
  );

  it("is absent when the environment has none or an empty one", async () => {
    process.env[NAME] = "";
    vi.resetModules();
    expect((await import("./managedGatewayToken.ts")).managedGatewayToken).toBeUndefined();
    delete process.env[NAME];
    vi.resetModules();
    expect((await import("./managedGatewayToken.ts")).managedGatewayToken).toBeUndefined();
  });
});
