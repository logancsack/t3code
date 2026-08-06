import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AuthConnectorKind = Schema.Literals([
  "codex",
  "claude",
  "cursor",
  "grok",
  "muse",
  "opencode",
  "github",
  "gitlab",
  "azure-devops",
  "bitbucket",
]);
export type AuthConnectorKind = typeof AuthConnectorKind.Type;

export const AuthConnectorMethod = Schema.Literals([
  "account",
  "console",
  "api-key",
  "token",
  "openai-account",
  "github-copilot",
  "xai-account",
  "anthropic-api-key",
  "opencode-api-key",
  "openrouter-api-key",
]);
export type AuthConnectorMethod = typeof AuthConnectorMethod.Type;

export const AuthConnectorSessionStatus = Schema.Literals([
  "starting",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);
export type AuthConnectorSessionStatus = typeof AuthConnectorSessionStatus.Type;

export const AuthConnectorFlow = Schema.Literals(["device", "browser", "code", "secret"]);
export type AuthConnectorFlow = typeof AuthConnectorFlow.Type;

export const AuthConnectorStage = Schema.Literals([
  "preparing",
  "credential",
  "authorize",
  "return",
  "verifying",
  "complete",
  "error",
]);
export type AuthConnectorStage = typeof AuthConnectorStage.Type;

export const AuthConnectorField = Schema.Struct({
  key: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  type: Schema.Literals(["text", "email", "password", "url", "textarea"]),
  placeholder: Schema.optional(Schema.String),
  help: Schema.optional(Schema.String),
});
export type AuthConnectorField = typeof AuthConnectorField.Type;

export const AuthConnectorSession = Schema.Struct({
  id: TrimmedNonEmptyString,
  connector: AuthConnectorKind,
  method: AuthConnectorMethod,
  status: AuthConnectorSessionStatus,
  flow: AuthConnectorFlow,
  stage: AuthConnectorStage,
  message: TrimmedNonEmptyString,
  verificationUrl: Schema.NullOr(Schema.String),
  userCode: Schema.NullOr(Schema.String),
  fields: Schema.Array(AuthConnectorField),
  expiresAt: Schema.NullOr(Schema.String),
});
export type AuthConnectorSession = typeof AuthConnectorSession.Type;

export const AuthConnectorStartInput = Schema.Struct({
  connector: AuthConnectorKind,
  method: AuthConnectorMethod,
  hostname: Schema.optional(TrimmedNonEmptyString),
});
export type AuthConnectorStartInput = typeof AuthConnectorStartInput.Type;

export const AuthConnectorSessionInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
});
export type AuthConnectorSessionInput = typeof AuthConnectorSessionInput.Type;

export const AuthConnectorSubmitInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  values: Schema.Record(TrimmedNonEmptyString, Schema.String.check(Schema.isMaxLength(16_384))),
});
export type AuthConnectorSubmitInput = typeof AuthConnectorSubmitInput.Type;

export class AuthConnectorError extends Schema.TaggedErrorClass<AuthConnectorError>()(
  "AuthConnectorError",
  {
    operation: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
