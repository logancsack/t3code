import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ServerProvider } from "./server.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);

describe("ServerProvider", () => {
  it("defaults capability arrays when decoding provider snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.versionAdvisory).toBeUndefined();
    expect(parsed.updateState).toBeUndefined();
  });

  it("defaults one-click update support when decoding older advisory snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        updateCommand: "npm install -g @openai/codex@latest",
        checkedAt: "2026-04-10T00:00:00.000Z",
        message: "Update available.",
      },
    });

    expect(parsed.versionAdvisory?.canUpdate).toBe(false);
  });

  it("decodes continuation group metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex_personal",
      driver: "codex",
      continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.continuation?.groupKey).toBe("codex:home:/Users/julius/.codex");
  });

  it("decodes an optional provider runtime-mode capability", () => {
    const parsed = decodeServerProvider({
      instanceId: "primeAgent",
      driver: "primeAgent",
      supportedRuntimeModes: ["full-access"],
      enabled: true,
      installed: true,
      version: "0.7.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-08-06T00:00:00.000Z",
      models: [],
    });

    expect(parsed.supportedRuntimeModes).toEqual(["full-access"]);
  });

  it("rejects unknown provider runtime modes", () => {
    expect(() =>
      decodeServerProvider({
        instanceId: "primeAgent",
        driver: "primeAgent",
        supportedRuntimeModes: ["unsafe-magic"],
        enabled: true,
        installed: true,
        version: "0.7.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-08-06T00:00:00.000Z",
        models: [],
      }),
    ).toThrow();
  });
});
