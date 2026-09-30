import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const AuthConnectorKind = Schema.Literals([
  "codex",
  "claude",
  "cursor",
  "grok",
  "muse",
  "prime-agent",
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
  "prime-inference",
  "openai-api-key",
  "anthropic-account",
  "anthropic-api-key",
  "azure-openai",
  "amazon-bedrock",
  "google-vertex",
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
  /**
   * Hub mode: sign-in runs on a thread machine. For flows that finish in a
   * browser on that machine (`flow: "browser"`), the same-origin page showing
   * the machine's browser. Absent on standalone servers.
   */
  workspaceBrowserUrl: Schema.optional(Schema.NullOr(Schema.String)),
});
export type AuthConnectorSession = typeof AuthConnectorSession.Type;

export const AuthConnectorStartInput = Schema.Struct({
  connector: AuthConnectorKind,
  method: AuthConnectorMethod,
  hostname: Schema.optional(TrimmedNonEmptyString),
  providerInstanceId: Schema.optional(ProviderInstanceId),
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

/**
 * Hub mode: provider sign-ins stored for thread machines (the files each
 * provider CLI keeps its login in). A stored sign-in is not proof of a valid
 * login; the provider's status on a machine is.
 */
export const ProviderSignIn = Schema.Struct({
  connector: AuthConnectorKind,
  version: Schema.Number,
  updatedAt: Schema.NullOr(Schema.String),
});
export type ProviderSignIn = typeof ProviderSignIn.Type;

export const ProviderSignInList = Schema.Struct({
  signIns: Schema.Array(ProviderSignIn),
});
export type ProviderSignInList = typeof ProviderSignInList.Type;

export const ProviderSignOutInput = Schema.Struct({ connector: AuthConnectorKind });
export type ProviderSignOutInput = typeof ProviderSignOutInput.Type;

/** Running machines drop the provider's files within about 15 s. */
export const ProviderSignOutResult = Schema.Struct({
  connector: AuthConnectorKind,
  signedOut: Schema.Boolean,
});
export type ProviderSignOutResult = typeof ProviderSignOutResult.Type;
