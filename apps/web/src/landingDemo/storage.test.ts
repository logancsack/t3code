import { expect, it, afterEach } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { Persistence } from "@t3tools/client-runtime/platform";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ServerConfig } from "@t3tools/contracts";
vi.mock("./mode", async (original) => ({
  ...(await original<typeof import("./mode")>()),
  isWorkReplay: () => true,
}));
import { demoEnvironmentId, demoThreadId } from "./mode";
import { setWorkReplayThread, workReplaySource } from "./runtime";
import { workReplayStorageLayer } from "./storage";

const encodeConfig = Schema.encodeEffect(ServerConfig);
const decodeConfig = Schema.decodeEffect(ServerConfig);

afterEach(() => vi.unstubAllGlobals());

it.effect(
  "reads only local replay snapshots, including subsequent frames, without account storage",
  () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("Replay must not open the account database");
      },
    });
    return Effect.gen(function* () {
      const targets = yield* Persistence.ConnectionTargetStore;
      const cache = yield* Persistence.EnvironmentCacheStore;
      expect(yield* targets.list).toEqual([]);
      const before = Option.getOrThrow(yield* cache.loadThread(demoEnvironmentId, demoThreadId));
      const initial = workReplaySource().detail.thread;
      setWorkReplayThread(
        {
          title: "Scripted close",
          messages: initial.messages,
          activities: [],
          latestTurn: null,
          session: initial.session,
        },
        "Cedar Workshop",
      );
      const after = Option.getOrThrow(yield* cache.loadThread(demoEnvironmentId, demoThreadId));
      expect(after.projection.thread.title).toBe("Scripted close");
      expect(after.snapshotSequence).toBeGreaterThan(before.snapshotSequence);
      const config = Option.getOrThrow(yield* cache.loadServerConfig(demoEnvironmentId));
      const decoded = yield* decodeConfig(yield* encodeConfig(config));
      expect(decoded.environment.environmentId).toBe(demoEnvironmentId);
      expect(decoded.providers[0]?.models[0]?.slug).toBe("gpt-6.1-sol");
      const shell = Option.getOrThrow(yield* cache.loadShell(demoEnvironmentId));
      expect(shell.projects[0]?.title).toBe("Cedar Workshop");
      expect(shell.threads[0]?.title).toBe("Scripted close");
    }).pipe(Effect.provide(workReplayStorageLayer));
  },
);
