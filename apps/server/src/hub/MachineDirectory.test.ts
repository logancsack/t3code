// @effect-diagnostics nodeBuiltinImport:off -- A plain HTTP server stands in for the platform.
import * as NodeHttp from "node:http";

import { it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect } from "vite-plus/test";

import { makeHttpMachineDirectory } from "./MachineDirectory.ts";

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

/** A directory that answers from `respond` and records every request. */
const serveDirectory = (
  respond: (request: Recorded) => { readonly status: number; readonly body?: unknown },
) =>
  Effect.acquireRelease(
    Effect.callback<{ readonly url: string; readonly requests: Array<Recorded> }>((resume) => {
      const requests: Array<Recorded> = [];
      const server = NodeHttp.createServer((request, response) => {
        let raw = "";
        request.on("data", (chunk) => (raw += chunk));
        request.on("end", () => {
          const recorded: Recorded = {
            method: request.method ?? "",
            url: request.url ?? "",
            authorization: request.headers.authorization,
            body: raw.length > 0 ? JSON.parse(raw) : undefined,
          };
          requests.push(recorded);
          const reply = respond(recorded);
          response.writeHead(reply.status, { "content-type": "application/json" });
          response.end(reply.body === undefined ? "" : JSON.stringify(reply.body));
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        resume(Effect.succeed({ url: `http://127.0.0.1:${address.port}/api`, requests, server }));
      });
    }).pipe(Effect.map((value) => value as typeof value & { server: NodeHttp.Server })),
    (value) => Effect.sync(() => value.server.close()),
  );

const threadId = ThreadId.make("thread/with space");

describe("HTTP machine directory", () => {
  it.live("speaks the documented contract", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* serveDirectory((request) =>
          request.method === "GET"
            ? { status: 200, body: { state: "paused", bootId: "boot-1", detail: null } }
            : request.url.endsWith("/machine")
              ? {
                  status: 200,
                  body: {
                    state: "running",
                    runner: { url: "wss://tunnel/runner", token: "short-lived", expiresAt: null },
                    bootId: "boot-2",
                  },
                }
              : { status: 204 },
        );
        const directory = yield* makeHttpMachineDirectory({
          baseUrl: `${server.url}/`,
          token: "directory-token",
        });

        const status = yield* directory.status(threadId);
        expect(status).toEqual({ state: "paused", bootId: "boot-1", detail: null });

        const ensured = yield* directory.ensure(threadId, {
          projectId: ProjectId.make("project-1"),
          repository: { url: "https://github.com/acme/app.git", ref: "main" },
          branch: "t3/work",
          checkout: "/workspace/t/thread%2Fwith%20space",
          wake: true,
        });
        expect(ensured.runner?.url).toBe("wss://tunnel/runner");
        yield* directory.idle(threadId);
        yield* directory.release(threadId);

        expect(
          server.requests.map((request) => [request.method, request.url, request.authorization]),
        ).toEqual([
          ["GET", "/api/threads/thread%2Fwith%20space/machine", "Bearer directory-token"],
          ["POST", "/api/threads/thread%2Fwith%20space/machine", "Bearer directory-token"],
          ["POST", "/api/threads/thread%2Fwith%20space/machine/idle", "Bearer directory-token"],
          ["POST", "/api/threads/thread%2Fwith%20space/machine/release", "Bearer directory-token"],
        ]);
        expect(server.requests[1]?.body).toEqual({
          projectId: "project-1",
          repository: { url: "https://github.com/acme/app.git", ref: "main" },
          branch: "t3/work",
          checkout: "/workspace/t/thread%2Fwith%20space",
          wake: true,
        });
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    ),
  );

  it.live("fails with typed errors for error statuses and malformed replies", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* serveDirectory((request) =>
          request.method === "GET"
            ? { status: 503, body: { error: "capacity" } }
            : { status: 200, body: { state: "sleeping" } },
        );
        const directory = yield* makeHttpMachineDirectory({ baseUrl: server.url, token: "t" });
        const unavailable = yield* directory.status(threadId).pipe(Effect.flip);
        expect(unavailable).toMatchObject({
          _tag: "MachineDirectoryError",
          operation: "status",
          status: 503,
        });
        expect(unavailable.detail).toContain("capacity");
        const malformed = yield* directory
          .ensure(threadId, {
            projectId: null,
            repository: null,
            branch: null,
            checkout: "/workspace/t/x",
            wake: true,
          })
          .pipe(Effect.flip);
        expect(malformed).toMatchObject({ _tag: "MachineDirectoryError", operation: "ensure" });
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    ),
  );

  it.live("lists repository refs and provider homes and signs a provider out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* serveDirectory((request) => {
          if (request.url.startsWith("/api/repositories/refs")) {
            return request.url.includes("locked")
              ? { status: 403, body: { error: "REPOSITORY_ACCESS_REQUIRED" } }
              : {
                  status: 200,
                  body: {
                    defaultBranch: "main",
                    refs: [{ name: "main", sha: "abc" }],
                    truncated: false,
                  },
                };
          }
          if (request.method === "DELETE") {
            return { status: 200, body: { provider: "claude", deleted: true } };
          }
          return {
            status: 200,
            body: { providers: [{ provider: "claude", version: 3, updatedAt: "t" }] },
          };
        });
        const directory = yield* makeHttpMachineDirectory({ baseUrl: server.url, token: "t" });

        const refs = yield* directory.repositoryRefs("https://github.com/acme/app");
        expect(refs.defaultBranch).toBe("main");
        const locked = yield* directory
          .repositoryRefs("https://github.com/acme/locked")
          .pipe(Effect.flip);
        expect(locked).toMatchObject({ status: 403, code: "REPOSITORY_ACCESS_REQUIRED" });
        expect((yield* directory.providerHomes).providers[0]?.version).toBe(3);
        expect(yield* directory.deleteProviderHome("claude")).toEqual({
          provider: "claude",
          deleted: true,
        });

        expect(server.requests.map((request) => [request.method, request.url])).toEqual([
          ["GET", "/api/repositories/refs?url=https%3A%2F%2Fgithub.com%2Facme%2Fapp"],
          ["GET", "/api/repositories/refs?url=https%3A%2F%2Fgithub.com%2Facme%2Flocked"],
          ["GET", "/api/provider-homes"],
          ["DELETE", "/api/provider-homes/claude"],
        ]);
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    ),
  );
});
