import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpRouter } from "effect/unstable/http";

import { symlinksSupported } from "@t3tools/shared/testing/symlinks";

import { makeMockUpdateRouteLayer } from "./mock-update-server.ts";

const withMockUpdateServer = <A, E, R>(rootRealPath: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(
      HttpRouter.serve(makeMockUpdateRouteLayer(rootRealPath), {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
    ),
  );

it.layer(NodeServices.layer)("mock-update-server", (it) => {
  it.effect("rejects encoded traversal and symlink escapes outside the configured root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "mock-update-server-root-",
      });
      const outside = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "mock-update-server-outside-",
      });
      const rootRealPath = yield* fileSystem.realPath(root);

      yield* fileSystem.writeFileString(path.join(outside, "secret.txt"), "nope\n");

      if (symlinksSupported) {
        yield* fileSystem.symlink(path.join(outside, "secret.txt"), path.join(root, "linked.txt"));
      }

      yield* withMockUpdateServer(
        rootRealPath,
        Effect.gen(function* () {
          const client = yield* HttpClient.HttpClient;
          const response = yield* client.get("/%2e%2e/secret.txt");

          assert.equal(response.status, 404);
          assert.equal(yield* response.text, "Not Found");
          if (symlinksSupported) {
            const linked = yield* client.get("/linked.txt");
            assert.equal(linked.status, 404);
            assert.equal(yield* linked.text, "Not Found");
          }
        }),
      );
    }),
  );
});
