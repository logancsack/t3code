import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  type AuthConnectorSession,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { HubThreadMachineStateSqliteLive } from "../persistence/Layers/HubThreadMachineState.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProviderSignInControls } from "../serverModeHooks.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as HubProviderSignIn from "./HubProviderSignIn.ts";
import * as HubProviderSnapshots from "./HubProviderSnapshots.ts";
import { MachineDirectory, makeFakeMachineDirectory } from "./MachineDirectory.ts";
import { make as makePool, RunnerConnectionPool } from "./RunnerConnectionPool.ts";
import { fakeRunner, fakeRunnerHello, serveRunner } from "./testUtils/runnerServer.ts";

const claude = ProviderDriverKind.make("claudeAgent");
const claudeInstance = ProviderInstanceId.make("claudeAgent");

const remoteSession = (patch: Partial<AuthConnectorSession>): AuthConnectorSession => ({
  id: "runner-session-1",
  connector: "claude",
  method: "account",
  status: "waiting",
  flow: "code",
  stage: "authorize",
  message: "Open the link, then paste the code.",
  verificationUrl: "https://claude.ai/oauth/authorize?code=true",
  userCode: null,
  fields: [{ key: "callback", label: "Code", type: "text" }],
  expiresAt: null,
  ...patch,
});

const authenticated: ServerProvider = {
  instanceId: claudeInstance,
  driver: claude,
  enabled: true,
  installed: true,
  version: "2.1.220",
  status: "ready",
  auth: { status: "authenticated", email: "user@example.com" },
  checkedAt: "2026-09-26T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

const StoresLive = Layer.mergeAll(
  HubThreadMachineStateSqliteLive,
  ServerSettingsService.layerTest(),
).pipe(Layer.provideMerge(SqlitePersistenceMemory), Layer.provideMerge(NodeServices.layer));

/**
 * A sign-in machine whose runner reports `waiting` until the credential is
 * submitted (or at once, with `succeedWithoutInput`), then `succeeded`.
 */
const setup = (
  waiting: AuthConnectorSession,
  options: {
    readonly storeTimeout?: Duration.Input;
    readonly succeedWithoutInput?: boolean;
    readonly signInIntentFailure?: { readonly status: number; readonly code: string };
  } = {},
) =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    // The platform's calls so far, read when the login command starts.
    const platform: { calls: Effect.Effect<ReadonlyArray<string>> } = {
      calls: Effect.succeed([]),
    };
    const intentsAtStart: Array<ReadonlyArray<string>> = [];
    let submitted = options.succeedWithoutInput === true;
    const succeeded = { ...waiting, status: "succeeded" as const, stage: "complete" as const };
    const runner = yield* serveRunner(
      fakeRunner({
        "runner.hello": (input) =>
          Effect.succeed(
            fakeRunnerHello({ threadId: input.threadId, instances: [claudeInstance] }),
          ),
        "runner.provider.configure": ({ instances }) =>
          Effect.sync(() => {
            calls.push(`configure ${Object.keys(instances).join(",")}`);
            return { instances: [claudeInstance] };
          }),
        "runner.provider.getCapabilities": () =>
          Effect.succeed({ snapshot: authenticated, sessionModelSwitch: "in-session" as const }),
        "runner.auth.start": (input) =>
          Effect.gen(function* () {
            calls.push(`start ${input.connector}`);
            intentsAtStart.push(
              (yield* platform.calls).filter((call) => call.startsWith("beginProviderSignIn")),
            );
            return waiting;
          }),
        "runner.auth.get": () => Effect.sync(() => (submitted ? succeeded : waiting)),
        "runner.auth.submit": ({ sessionId, values }) =>
          Effect.sync(() => {
            calls.push(`submit ${sessionId} ${Object.keys(values).join(",")}`);
            submitted = true;
            return remoteSession({ status: "starting", stage: "verifying", fields: [] });
          }),
        "runner.auth.cancel": ({ sessionId }) =>
          Effect.sync(() => {
            calls.push(`cancel ${sessionId}`);
            return remoteSession({ status: "cancelled", stage: "error" });
          }),
      }),
    );
    const fake = yield* makeFakeMachineDirectory({
      onWake: () => ({ state: "running", runnerUrl: runner.url }),
      ...(options.signInIntentFailure ? { signInIntentFailure: options.signInIntentFailure } : {}),
    });
    platform.calls = fake.platformCalls;
    const snapshots = yield* HubProviderSnapshots.make;
    const context = yield* Layer.build(
      Layer.effect(
        ProviderSignInControls,
        HubProviderSignIn.make({
          pollInterval: "10 millis",
          storePollInterval: "10 millis",
          storeTimeout: options.storeTimeout ?? Duration.seconds(5),
        }),
      ).pipe(
        Layer.provideMerge(
          Layer.effect(
            RunnerConnectionPool,
            makePool({ wakePollInterval: "5 millis", idleCheckInterval: "1 hour" }),
          ),
        ),
        Layer.provideMerge(Layer.succeed(MachineDirectory, fake.directory)),
        Layer.provide(Layer.succeed(HubProviderSnapshots.HubProviderSnapshots, snapshots)),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-hub-sign-in-" })),
      ),
    );
    const signIn = (yield* ProviderSignInControls.pipe(Effect.provide(context)))!;
    const waitFor = (id: string, predicate: (session: AuthConnectorSession) => boolean) =>
      Effect.repeat(signIn.get(id), { until: predicate }).pipe(Effect.timeout("5 seconds"));
    return { signIn, fake, calls, snapshots, waitFor, intentsAtStart };
  });

describe("hub provider sign-in", () => {
  it.live("runs the login on the sign-in machine and completes once the sign-in is stored", () =>
    Effect.gen(function* () {
      const { signIn, fake, calls, snapshots, waitFor, intentsAtStart } = yield* setup(
        remoteSession({}),
      );
      const started = yield* signIn.start({ connector: "claude", method: "account" });
      expect(started).toMatchObject({ status: "starting", stage: "preparing", flow: "code" });

      const waiting = yield* waitFor(started.id, (session) => session.status === "waiting");
      expect(waiting).toMatchObject({
        id: started.id,
        flow: "code",
        verificationUrl: "https://claude.ai/oauth/authorize?code=true",
        workspaceBrowserUrl: null,
      });
      yield* signIn.submit({ sessionId: started.id, values: { callback: "code#state" } });

      // The login succeeded on the machine; the upload has not landed yet.
      const verifying = yield* waitFor(
        started.id,
        (session) => session.message === "Saving your sign-in…",
      );
      expect(verifying).toMatchObject({ status: "starting", stage: "verifying" });
      yield* fake.setProviderHome("claude", 1);
      const done = yield* waitFor(started.id, (session) => session.status !== "starting");
      expect(done).toMatchObject({ status: "succeeded", stage: "complete", message: "Signed in." });

      // The sign-in intent was open before the login command ran.
      expect(intentsAtStart).toEqual([["beginProviderSignIn claude"]]);
      expect(calls).toContain("configure claudeAgent");
      expect(calls).toContain("start claude");
      expect(calls).toContain("submit runner-session-1 callback");
      const [status] = yield* snapshots.all;
      expect(status?.auth.status).toBe("authenticated");
      const directoryCalls = (yield* fake.calls).map((call) => call.method);
      expect(directoryCalls[0]).toBe("ensure");
      expect(directoryCalls.at(-1)).toBe("idle");
    }).pipe(Effect.scoped, Effect.provide(StoresLive)),
  );

  it.live("links browser flows to the machine's browser and fails when nothing is stored", () =>
    Effect.gen(function* () {
      const { signIn, waitFor } = yield* setup(
        remoteSession({ connector: "cursor", flow: "browser", fields: [] }),
        { storeTimeout: "100 millis", succeedWithoutInput: true },
      );
      const started = yield* signIn.start({ connector: "cursor", method: "account" });
      expect(started).toMatchObject({ flow: "browser", workspaceBrowserUrl: null });
      const browser = yield* waitFor(started.id, (session) => session.workspaceBrowserUrl != null);
      expect(browser.workspaceBrowserUrl).toBe("/_devpc/threads/aldo-provider-sign-in/browser");
      const failed = yield* waitFor(started.id, (session) => session.status === "failed");
      expect(failed.message).toContain("was not saved");
    }).pipe(Effect.scoped, Effect.provide(StoresLive)),
  );

  it.live("cancels on the machine, signs out, lists stored sign-ins, and refuses others", () =>
    Effect.gen(function* () {
      const { signIn, fake, calls, waitFor } = yield* setup(remoteSession({}));
      const started = yield* signIn.start({ connector: "claude", method: "account" });
      yield* waitFor(started.id, (session) => session.status === "waiting");
      const cancelled = yield* signIn.cancel(started.id);
      expect(cancelled.status).toBe("cancelled");
      expect(calls).toContain("cancel runner-session-1");

      yield* fake.setProviderHome("claude", 4);
      yield* fake.setProviderHome("prime", 2);
      expect(yield* signIn.list).toEqual({
        signIns: [
          { connector: "claude", version: 4, updatedAt: null },
          { connector: "prime-agent", version: 2, updatedAt: null },
        ],
      });
      expect(yield* signIn.signOut({ connector: "claude" })).toEqual({
        connector: "claude",
        signedOut: true,
      });
      expect(yield* fake.platformCalls).toContain("deleteProviderHome claude");

      const github = yield* signIn
        .start({ connector: "github", method: "token" })
        .pipe(Effect.flip);
      expect(github._tag).toBe("AuthConnectorError");
    }).pipe(Effect.scoped, Effect.provide(StoresLive)),
  );

  it.live("shows a sign-in the platform refused to start and never runs the login", () =>
    Effect.gen(function* () {
      const { signIn, calls, fake, waitFor } = yield* setup(remoteSession({}), {
        signInIntentFailure: { status: 409, code: "NOT_HUB_HOSTED" },
      });
      const started = yield* signIn.start({ connector: "claude", method: "account" });
      const failed = yield* waitFor(started.id, (session) => session.status === "failed");
      expect(failed.message).toContain("NOT_HUB_HOSTED");
      expect(calls.some((call) => call.startsWith("start "))).toBe(false);
      expect((yield* fake.calls).map((call) => call.method).at(-1)).toBe("idle");
    }).pipe(Effect.scoped, Effect.provide(StoresLive)),
  );
});
