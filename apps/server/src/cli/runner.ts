import * as Effect from "effect/Effect";
import { Command, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig } from "../config.ts";
import { runRunner } from "../runner/RunnerServer.ts";
import { resolveServerConfig, sharedServerCommandFlags } from "./config.ts";

/** Prototype: serve the runner protocol for this machine's checkout. */
export const runnerCommand = Command.make("runner", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run a T3 runner: provider drivers and checkpoints for a remote hub."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveServerConfig(flags, logLevel, {
        startupPresentation: "headless",
        forceAutoBootstrapProjectFromCwd: false,
      });
      return yield* runRunner.pipe(Effect.provideService(ServerConfig, config));
    }),
  ),
);
