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

type MockModelProbe = "ready" | "empty" | "error";

async function writeMockPrimeAgent(directory: string, modelProbe: MockModelProbe): Promise<string> {
  const binaryPath = NodePath.join(directory, "prime-agent");
  const modelProbeScript =
    modelProbe === "ready"
      ? "printf '%s\\n' 'provider  model              context  max-out  thinking  images' 'openai    gpt-prime-mock     200K     32K      yes       yes' >&2\n  exit 0"
      : modelProbe === "empty"
        ? "exit 0"
        : "echo 'model discovery failed' >&2\n  exit 2";
  await NodeFSP.writeFile(
    binaryPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "prime-agent 0.7.0"
  exit 0
fi
if [ "$1" = "model" ] && [ "$2" = "list" ]; then
  ${modelProbeScript}
fi
exit 2
`,
    "utf8",
  );
  await NodeFSP.chmod(binaryPath, 0o755);
  return binaryPath;
}

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
      const binaryPath = yield* Effect.promise(() => writeMockPrimeAgent(directory, "ready"));

      const snapshot = yield* checkPrimeProviderStatus(decodePrimeSettings({ binaryPath }), {
        HOME: directory,
      });
      expect(snapshot.status).toBe("ready");
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.models.map((model) => model.slug)).toContain("openai/gpt-prime-mock");
    }),
  );

  it.effect("uses stored credentials when discovery returns no models", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-provider-stored-auth-")),
      );
      const binaryPath = yield* Effect.promise(() => writeMockPrimeAgent(directory, "empty"));
      const agentDirectory = NodePath.join(directory, ".prime", "custom-agent");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(agentDirectory, { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(agentDirectory, "auth.json"),
          '{"openai":{"key":"stored-test-credential"}}',
          "utf8",
        );
      });

      const snapshot = yield* checkPrimeProviderStatus(decodePrimeSettings({ binaryPath }), {
        HOME: directory,
        PRIME_AGENT_CODING_AGENT_DIR: "~/.prime/custom-agent",
      });
      expect(snapshot.status).toBe("warning");
      expect(snapshot.auth).toMatchObject({
        status: "authenticated",
        label: "Prime Agent credentials",
      });
      expect(snapshot.models.map((model) => model.slug)).toEqual(["auto"]);
      expect(snapshot.message).not.toContain("stored-test-credential");
    }),
  );

  it.effect("reports unauthenticated when discovery and stored credentials are empty", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-provider-missing-auth-")),
      );
      const binaryPath = yield* Effect.promise(() => writeMockPrimeAgent(directory, "empty"));
      const agentDirectory = NodePath.join(directory, "agent");

      const missingSnapshot = yield* checkPrimeProviderStatus(decodePrimeSettings({ binaryPath }), {
        HOME: directory,
        PRIME_AGENT_CODING_AGENT_DIR: agentDirectory,
      });
      expect(missingSnapshot.status).toBe("warning");
      expect(missingSnapshot.auth.status).toBe("unauthenticated");
      expect(missingSnapshot.message).toContain("no usable authenticated models");

      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(agentDirectory, { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(agentDirectory, "auth.json"),
          '{"openai":{"key":"   "}}',
          "utf8",
        );
      });
      const blankSnapshot = yield* checkPrimeProviderStatus(decodePrimeSettings({ binaryPath }), {
        HOME: directory,
        PRIME_AGENT_CODING_AGENT_DIR: agentDirectory,
      });
      expect(blankSnapshot.status).toBe("warning");
      expect(blankSnapshot.auth.status).toBe("unauthenticated");
    }),
  );

  it.effect("keeps authentication unknown when stored credentials cannot be parsed", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-provider-invalid-auth-")),
      );
      const binaryPath = yield* Effect.promise(() => writeMockPrimeAgent(directory, "empty"));
      const agentDirectory = NodePath.join(directory, "agent");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(agentDirectory, { recursive: true });
        await NodeFSP.writeFile(NodePath.join(agentDirectory, "auth.json"), "{not-json", "utf8");
      });

      const snapshot = yield* checkPrimeProviderStatus(decodePrimeSettings({ binaryPath }), {
        HOME: directory,
        PRIME_AGENT_CODING_AGENT_DIR: agentDirectory,
      });
      expect(snapshot.status).toBe("warning");
      expect(snapshot.auth.status).toBe("unknown");
      expect(snapshot.message).toContain("no usable authenticated models");
    }),
  );

  it.effect("reports a model-discovery error without claiming the user is unauthenticated", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-provider-model-error-")),
      );
      const binaryPath = yield* Effect.promise(() => writeMockPrimeAgent(directory, "error"));

      const snapshot = yield* checkPrimeProviderStatus(decodePrimeSettings({ binaryPath }), {
        HOME: directory,
      });
      expect(snapshot.status).toBe("error");
      expect(snapshot.auth.status).toBe("unknown");
      expect(snapshot.message).toContain("model discovery failed");
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
