import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { PrimeSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/schema";
import { expect, vi } from "vite-plus/test";

import type * as AcpSessionRuntime from "../provider/acp/AcpSessionRuntime.ts";
import { makePrimeTextGeneration } from "./PrimeTextGeneration.ts";

const runtimeStub = vi.hoisted(() => ({
  makeCalls: 0,
  output: "",
  stopReason: "end_turn" as EffectAcpSchema.PromptResponse["stopReason"],
}));

vi.mock("../provider/acp/PrimeAcpSupport.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../provider/acp/PrimeAcpSupport.ts")>();
  const EffectModule = await import("effect/Effect");

  return {
    ...actual,
    makePrimeAcpRuntime: () =>
      EffectModule.sync(() => {
        runtimeStub.makeCalls += 1;
        let sessionUpdateHandler: Parameters<
          AcpSessionRuntime.AcpSessionRuntime["Service"]["handleSessionUpdate"]
        >[0] = () => EffectModule.void;

        return {
          handleSessionUpdate: (handler: typeof sessionUpdateHandler) =>
            EffectModule.sync(() => {
              sessionUpdateHandler = handler;
            }),
          start: () => EffectModule.void,
          prompt: () =>
            sessionUpdateHandler({
              sessionId: "prime-text-generation-test",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: runtimeStub.output },
              },
            }).pipe(EffectModule.as({ stopReason: runtimeStub.stopReason })),
        } as unknown as AcpSessionRuntime.AcpSessionRuntime["Service"];
      }),
  };
});

const decodePrimeSettings = Schema.decodeSync(PrimeSettings);
const outputSchema = Schema.Struct({ ok: Schema.Boolean });
const modelSelection = (model: string) => ({
  instanceId: ProviderInstanceId.make("primeAgent"),
  model,
});

it.layer(NodeServices.layer)("PrimeTextGeneration", (it) => {
  it.effect("rejects an unqualified non-auto Prime model before starting ACP", () =>
    Effect.gen(function* () {
      runtimeStub.makeCalls = 0;
      const textGeneration = yield* makePrimeTextGeneration(decodePrimeSettings({}));

      const error = yield* Effect.flip(
        textGeneration.generateStructured({
          cwd: process.cwd(),
          prompt: "Return a result.",
          outputSchema,
          modelSelection: modelSelection("gpt-5.4"),
        }),
      );

      expect(error.detail).toBe("Prime Agent models must use a provider/model slug.");
      expect(runtimeStub.makeCalls).toBe(0);
    }),
  );

  it.effect("distinguishes cancelled requests from successful requests with empty output", () =>
    Effect.gen(function* () {
      const textGeneration = yield* makePrimeTextGeneration(decodePrimeSettings({}));
      runtimeStub.output = "   ";
      runtimeStub.stopReason = "cancelled";

      const cancelled = yield* Effect.flip(
        textGeneration.generateStructured({
          cwd: process.cwd(),
          prompt: "Return a result.",
          outputSchema,
          modelSelection: modelSelection("auto"),
        }),
      );
      expect(cancelled.detail).toBe("Prime ACP request was cancelled.");

      runtimeStub.stopReason = "end_turn";
      const empty = yield* Effect.flip(
        textGeneration.generateStructured({
          cwd: process.cwd(),
          prompt: "Return a result.",
          outputSchema,
          modelSelection: modelSelection("auto"),
        }),
      );
      expect(empty.detail).toBe("Prime Agent returned empty output.");
    }),
  );

  it.effect("maps invalid qualified-model output to a structured-output error", () =>
    Effect.gen(function* () {
      const textGeneration = yield* makePrimeTextGeneration(decodePrimeSettings({}));
      runtimeStub.output = '{"ok":"yes"}';
      runtimeStub.stopReason = "end_turn";

      const error = yield* Effect.flip(
        textGeneration.generateStructured({
          cwd: process.cwd(),
          prompt: "Return a result.",
          outputSchema,
          modelSelection: modelSelection("openai/gpt-5.4"),
        }),
      );

      expect(error.detail).toBe("Prime Agent returned invalid structured output.");
    }),
  );
});
