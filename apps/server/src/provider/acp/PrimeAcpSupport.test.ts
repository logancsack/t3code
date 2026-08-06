import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  buildPrimeAcpSpawnInput,
  filterPrimeLaunchArgs,
  formatPrimeModelSlug,
  makePrimeResumeCursor,
  makePrimeSessionKey,
  parsePrimeModelSlug,
  parsePrimeResumeCursor,
  resolvePrimeAgentDirectory,
  resolvePrimeSessionDirectory,
} from "./PrimeAcpSupport.ts";

describe("PrimeAcpSupport", () => {
  it("maps provider-qualified model slugs to Prime startup flags", () => {
    expect(parsePrimeModelSlug("openai/gpt-5.4")).toEqual({
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(parsePrimeModelSlug("openrouter/anthropic/claude-sonnet-4.6")).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-sonnet-4.6",
    });
    expect(parsePrimeModelSlug("auto")).toBeUndefined();
    expect(formatPrimeModelSlug("openai", "gpt-5.4")).toBe("openai/gpt-5.4");
    expect(() =>
      buildPrimeAcpSpawnInput(undefined, "/workspace/repo", undefined, "unqualified-model"),
    ).toThrow(/provider\/model/u);
  });

  it("reserves ACP, model, cwd, resume, and credential flags", () => {
    expect(
      filterPrimeLaunchArgs(
        "--autonomous --mode rpc --provider anthropic --model claude --api-key secret --resume old --continue --session-dir /tmp/shared",
      ),
    ).toEqual(["--autonomous"]);
    expect(filterPrimeLaunchArgs("--autonomous -- --api-key escaped positional prompt")).toEqual([
      "--autonomous",
    ]);
    expect(filterPrimeLaunchArgs("model list --verbose")).toEqual(["--verbose"]);
    expect(filterPrimeLaunchArgs("@startup-prompt.md --thinking high")).toEqual([
      "--thinking",
      "high",
    ]);

    expect(
      buildPrimeAcpSpawnInput(
        {
          binaryPath: "/opt/prime-agent",
          launchArgs: "--autonomous --api-key=never-persist-this",
        },
        "/workspace/repo",
        { OPENAI_API_KEY: "from-environment" },
        "openai/gpt-5.4",
      ),
    ).toEqual({
      command: "/opt/prime-agent",
      args: [
        "--autonomous",
        "--mode",
        "acp",
        "--cwd",
        "/workspace/repo",
        "--provider",
        "openai",
        "--model",
        "gpt-5.4",
      ],
      cwd: "/workspace/repo",
      env: { OPENAI_API_KEY: "from-environment" },
    });
  });

  it.effect("uses a stable private session directory and only continues a resumed T3 session", () =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        const path = yield* Path.Path;
        const firstKey = yield* makePrimeSessionKey("primeAgent", "../../thread-one");
        const sameKey = yield* makePrimeSessionKey("primeAgent", "../../thread-one");
        const otherKey = yield* makePrimeSessionKey("primeAgent", "../../thread-two");
        const agentDirectory = resolvePrimeAgentDirectory(
          path,
          { HOME: "/home/test", PRIME_AGENT_CODING_AGENT_DIR: "~/.prime/custom" },
          "/fallback",
        );
        const sessionDirectory = resolvePrimeSessionDirectory(path, agentDirectory, firstKey);
        return { path, firstKey, sameKey, otherKey, agentDirectory, sessionDirectory };
      });

      expect(result.firstKey).toBe(result.sameKey);
      expect(result.firstKey).not.toBe(result.otherKey);
      expect(result.firstKey).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.agentDirectory).toBe("/home/test/.prime/custom");
      expect(result.sessionDirectory).toBe(
        `/home/test/.prime/custom/t3-sessions/${result.firstKey}`,
      );
      expect(() =>
        resolvePrimeSessionDirectory(result.path, result.agentDirectory, "../../escape"),
      ).toThrow(/session keys/u);

      const common = {
        binaryPath: "prime-agent",
        launchArgs: "",
      };
      const newSession = buildPrimeAcpSpawnInput(
        common,
        "/workspace/repo",
        undefined,
        "auto",
        "agentic-session",
        {
          directory: result.sessionDirectory,
          continueSession: false,
        },
      );
      const resumedSession = buildPrimeAcpSpawnInput(
        common,
        "/workspace/repo",
        undefined,
        "auto",
        "agentic-session",
        { directory: result.sessionDirectory, continueSession: true },
      );
      expect(newSession.args).toEqual([
        "--mode",
        "acp",
        "--cwd",
        "/workspace/repo",
        "--session-dir",
        result.sessionDirectory,
      ]);
      expect(resumedSession.args).toEqual([
        "--mode",
        "acp",
        "--cwd",
        "/workspace/repo",
        "--continue",
        "--session-dir",
        result.sessionDirectory,
      ]);

      expect(
        buildPrimeAcpSpawnInput(
          {
            ...common,
            launchArgs: "--autonomous --goal persistent-goal --tools bash",
          },
          "/workspace/repo",
          undefined,
          "openai/gpt-5.4",
          "text-generation",
        ).args,
      ).toEqual([
        "--mode",
        "acp",
        "--cwd",
        "/workspace/repo",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-themes",
        "--provider",
        "openai",
        "--model",
        "gpt-5.4",
      ]);

      const cursor = makePrimeResumeCursor(result.firstKey);
      expect(parsePrimeResumeCursor(cursor)).toEqual(cursor);
      expect(
        parsePrimeResumeCursor({ schemaVersion: 1, sessionKey: "../../escape" }),
      ).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
