// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PrimeSettings } from "@t3tools/contracts";

import {
  buildInitialPrimeProviderSnapshot,
  checkPrimeProviderStatus,
  parsePrimeModelListOutput,
} from "./PrimeProvider.ts";

const decodePrimeSettings = Schema.decodeSync(PrimeSettings);

describe("PrimeProvider", () => {
  it("parses Prime Agent's provider-qualified model table", () => {
    expect(
      parsePrimeModelListOutput(
        [
          "provider    model                       context  max-out  thinking  images",
          "anthropic   claude-sonnet-4-6           200K     64K      yes       yes",
          "openrouter  anthropic/claude-opus-4-6   200K     32K      yes       yes",
        ].join("\n"),
      ).map((model) => model.slug),
    ).toEqual(["anthropic/claude-sonnet-4-6", "openrouter/anthropic/claude-opus-4-6"]);
  });

  it.effect("advertises automatic selection and the full-access warning while probing", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPrimeProviderSnapshot(decodePrimeSettings({}));
      expect(snapshot.models.map((model) => model.slug)).toEqual(["auto"]);
      expect(snapshot.supportedRuntimeModes).toEqual(["full-access"]);
      expect(snapshot.requiresNewThreadForModelChange).toBe(true);
      expect(snapshot.message).toContain("Checking Prime Agent");
    }),
  );

  it.effect("does not advertise unqualified custom model slugs", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPrimeProviderSnapshot(
        decodePrimeSettings({ customModels: ["bad-model", "openai/good-model"] }),
      );
      expect(snapshot.models.map((model) => model.slug)).toEqual(["auto", "openai/good-model"]);
    }),
  );
});

it.layer(NodeServices.layer)("checkPrimeProviderStatus", (it) => {
  it.effect("becomes ready after discovering usable authenticated models", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-provider-status-")),
      );
      const binaryPath = NodePath.join(directory, "prime-agent");
      yield* Effect.promise(async () => {
        await NodeFSP.writeFile(
          binaryPath,
          `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "prime-agent 0.7.0"
  exit 0
fi
if [ "$1" = "model" ] && [ "$2" = "list" ]; then
  printf '%s\n' 'provider  model              context  max-out  thinking  images' 'openai    gpt-prime-mock     200K     32K      yes       yes' >&2
  exit 0
fi
exit 2
`,
          "utf8",
        );
        await NodeFSP.chmod(binaryPath, 0o755);
      });

      const snapshot = yield* checkPrimeProviderStatus(decodePrimeSettings({ binaryPath }), {
        HOME: directory,
      });
      expect(snapshot.status).toBe("ready");
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.models.map((model) => model.slug)).toContain("openai/gpt-prime-mock");
    }),
  );

  it.effect("reports a missing Prime Agent binary without exposing credentials", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPrimeProviderStatus(
        decodePrimeSettings({ binaryPath: "/definitely/not/installed/prime-agent" }),
        { OPENAI_API_KEY: "must-not-appear" },
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).not.toContain("must-not-appear");
    }),
  );
});
