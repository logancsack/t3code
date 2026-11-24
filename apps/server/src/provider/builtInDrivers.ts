import {
  AcpRegistryDriver,
  type AcpRegistryDriverEnv,
} from "@t3tools/provider-acp-registry/server";
import { AntigravityDriver, type AntigravityDriverEnv } from "./Drivers/AntigravityDriver.ts";
import { ClaudeDriver, type ClaudeDriverEnv } from "./Drivers/ClaudeDriver.ts";
import { CodexDriver, type CodexDriverEnv } from "./Drivers/CodexDriver.ts";
import { CursorDriver, type CursorDriverEnv } from "@t3tools/provider-cursor/server";
import { FxDriver, type FxDriverEnv } from "@t3tools/provider-fx/server";
import { GrokDriver, type GrokDriverEnv } from "@t3tools/provider-grok/server";
import { OpenCodeDriver, type OpenCodeDriverEnv } from "@t3tools/provider-opencode/server";
import { MuseDriver, type MuseDriverEnv } from "@t3tools/provider-muse/server";
import { PiDriver, type PiDriverEnv } from "@t3tools/provider-pi/server";
import type {
  AnyProviderDriver,
  ProviderUsageReaderEnv,
} from "@t3tools/provider-core/server/driver";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { KiroDriver, type KiroDriverEnv } from "@t3tools/provider-kiro/server";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";

import { makeGrokCodeReview } from "../review/GrokCodeReview.ts";

/** Grok instances also carry the CLI review swarm `aldo_review` prefers. */
const GrokDriverWithReview: AnyProviderDriver<GrokDriverEnv | Digest.Digest> = {
  ...GrokDriver,
  create: Effect.fn("GrokDriver.createWithCodeReview")(function* (input) {
    const instance = yield* GrokDriver.create(input);
    if (!input.enabled) return instance;
    const environment = yield* mergeProviderInstanceEnvironment(input.environment);
    const codeReview = yield* makeGrokCodeReview({ ...input.config, enabled: true }, environment);
    return { ...instance, codeReview };
  }),
};

export type BuiltInDriversEnv =
  | AcpRegistryDriverEnv
  | AntigravityDriverEnv
  | ClaudeDriverEnv
  | CodexDriverEnv
  | CursorDriverEnv
  | FxDriverEnv
  | GrokDriverEnv
  | Digest.Digest
  | KiroDriverEnv
  | OpenCodeDriverEnv
  | PiDriverEnv
  | MuseDriverEnv;

export const BUILT_IN_DRIVERS: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>> = [
  CodexDriver,
  ClaudeDriver,
  CursorDriver,
  GrokDriverWithReview,
  FxDriver,
  OpenCodeDriver,
  AntigravityDriver,
  KiroDriver,
  PiDriver,
  MuseDriver,
  AcpRegistryDriver,
];

export type BuiltInUsageReadersEnv =
  | ProviderUsageReaderEnv<typeof ClaudeDriver>
  | ProviderUsageReaderEnv<typeof CodexDriver>
  | ProviderUsageReaderEnv<typeof GrokDriver>
  | ProviderUsageReaderEnv<typeof OpenCodeDriver>
  | ProviderUsageReaderEnv<typeof AntigravityDriver>
  | ProviderUsageReaderEnv<typeof CursorDriver>
  | ProviderUsageReaderEnv<typeof PiDriver>
  | ProviderUsageReaderEnv<typeof MuseDriver>;

/** Order matters: aggregation keeps the first duplicate record. */
export const BUILT_IN_USAGE_DRIVERS: ReadonlyArray<
  AnyProviderDriver<BuiltInDriversEnv, BuiltInUsageReadersEnv>
> = [
  ClaudeDriver,
  CodexDriver,
  GrokDriver,
  PiDriver,
  OpenCodeDriver,
  MuseDriver,
  AntigravityDriver,
  CursorDriver,
];
