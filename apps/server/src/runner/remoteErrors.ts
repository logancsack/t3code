/**
 * Server-internal error unions across the runner protocol.
 *
 * Contract errors (VCS, git, terminal, review, text generation) cross the wire
 * as themselves. Error unions that only exist in the server (provider adapter
 * and workspace errors) are encoded with their own schema into
 * `RunnerRemoteError` on the runner and decoded back on the hub, so hub-side
 * callers see the exact error class the in-process service would raise.
 *
 * @module runner/remoteErrors
 */
import { RunnerRemoteError } from "@t3tools/contracts/runner";
import * as Schema from "effect/Schema";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../provider/Errors.ts";

export const ProviderAdapterErrorSchema = Schema.Union([
  ProviderAdapterValidationError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterRequestError,
  ProviderAdapterProcessError,
]);

type Codec = Schema.ConstraintDecoder<unknown> & Schema.ConstraintEncoder<unknown>;

const describe = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { readonly message: unknown }).message);
  }
  return String(error);
};

const tagOf = (error: unknown): string =>
  error && typeof error === "object" && "_tag" in error
    ? String((error as { readonly _tag: unknown })._tag)
    : "UnknownError";

/** Runner side: wraps an error of `schema`'s union for the wire. */
export const toRunnerRemoteError =
  <S extends Codec>(schema: S) =>
  (error: S["Type"]): RunnerRemoteError => {
    let encoded: unknown = null;
    try {
      encoded = Schema.encodeUnknownSync(schema)(error);
    } catch {
      // Keep the readable tag and message; the hub falls back to them.
    }
    return new RunnerRemoteError({ errorTag: tagOf(error), detail: describe(error), encoded });
  };

/** Hub side: restores the original error, or `fallback` when it cannot be decoded. */
export const fromRunnerRemoteError =
  <S extends Codec, F>(schema: S, fallback: (remote: RunnerRemoteError) => F) =>
  (remote: RunnerRemoteError): S["Type"] | F => {
    try {
      return Schema.decodeUnknownSync(schema)(remote.encoded);
    } catch {
      return fallback(remote);
    }
  };
