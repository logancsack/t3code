import * as Effect from "effect/Effect";
import { Command, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig } from "../config.ts";
import { runRunner } from "../runner/RunnerServer.ts";
import { resolveServerConfig, sharedServerCommandFlags } from "./config.ts";

/**
 * `t3 runner`: serves the runner protocol for one thread's checkout on a
 * thread machine (`T3CODE_RUNNER_THREAD_ID`, `T3CODE_RUNNER_CHECKOUT`,
 * `T3CODE_RUNNER_TOKEN`). See docs/internals/thread-machines.md.
 */
export const runnerCommand = Command.make("runner", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription(
    "Run a T3 runner: one thread's providers, git, terminals and files for a hub.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveServerConfig(flags, logLevel, {
        startupPresentation: "headless",
        forceAutoBootstrapProjectFromCwd: false,
        serverMode: "runner",
      });
      // Services that anchor on the server cwd (review path checks, provider
      // fallbacks) anchor on the thread's checkout.
      const runnerConfig = config.runnerCheckout
        ? { ...config, cwd: config.runnerCheckout }
        : config;
      return yield* runRunner.pipe(Effect.provideService(ServerConfig, runnerConfig));
    }),
  ),
);
