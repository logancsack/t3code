import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { HubDatabase, type HubDatabaseShape } from "../persistence/Postgres/HubDatabase.ts";
import {
  decryptHubSecret,
  encryptHubSecret,
  HubSecretKeyError,
  parseHubSecretKey,
} from "../persistence/Postgres/HubSecretCipher.ts";

const secretStoreErrorContext = {
  resource: Schema.String,
  cause: Schema.Defect(),
};

export class SecretStoreSecureError extends Schema.TaggedErrorClass<SecretStoreSecureError>()(
  "SecretStoreSecureError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to secure ${this.resource}.`;
  }
}

export class SecretStoreReadError extends Schema.TaggedErrorClass<SecretStoreReadError>()(
  "SecretStoreReadError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to read ${this.resource}.`;
  }
}

export class SecretStoreTemporaryPathError extends Schema.TaggedErrorClass<SecretStoreTemporaryPathError>()(
  "SecretStoreTemporaryPathError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to create temporary path for ${this.resource}.`;
  }
}

export class SecretStorePersistError extends Schema.TaggedErrorClass<SecretStorePersistError>()(
  "SecretStorePersistError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to persist ${this.resource}.`;
  }
}

export class SecretStoreRandomGenerationError extends Schema.TaggedErrorClass<SecretStoreRandomGenerationError>()(
  "SecretStoreRandomGenerationError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to generate random bytes for ${this.resource}.`;
  }
}

export class SecretStoreConcurrentReadError extends Schema.TaggedErrorClass<SecretStoreConcurrentReadError>()(
  "SecretStoreConcurrentReadError",
  {
    resource: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to read ${this.resource} after concurrent creation.`;
  }
}

export class SecretStoreRemoveError extends Schema.TaggedErrorClass<SecretStoreRemoveError>()(
  "SecretStoreRemoveError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to remove ${this.resource}.`;
  }
}

export class SecretStoreDecodeError extends Schema.TaggedErrorClass<SecretStoreDecodeError>()(
  "SecretStoreDecodeError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to decode ${this.resource}.`;
  }
}

export class SecretStoreEncodeError extends Schema.TaggedErrorClass<SecretStoreEncodeError>()(
  "SecretStoreEncodeError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to encode ${this.resource}.`;
  }
}

export const SecretStoreError = Schema.Union([
  SecretStoreSecureError,
  SecretStoreReadError,
  SecretStoreTemporaryPathError,
  SecretStorePersistError,
  SecretStoreRandomGenerationError,
  SecretStoreConcurrentReadError,
  SecretStoreRemoveError,
  SecretStoreDecodeError,
  SecretStoreEncodeError,
]);
export type SecretStoreError = typeof SecretStoreError.Type;
export const isSecretStoreError = Schema.is(SecretStoreError);

const isPlatformError = (value: unknown): value is PlatformError.PlatformError =>
  Predicate.isTagged(value, "PlatformError");

export const isSecretAlreadyExistsError = (error: SecretStoreError): boolean =>
  "cause" in error && isPlatformError(error.cause) && error.cause.reason._tag === "AlreadyExists";

export class ServerSecretStore extends Context.Service<
  ServerSecretStore,
  {
    readonly get: (name: string) => Effect.Effect<Option.Option<Uint8Array>, SecretStoreError>;
    readonly set: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly create: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly getOrCreateRandom: (
      name: string,
      bytes: number,
    ) => Effect.Effect<Uint8Array, SecretStoreError>;
    readonly remove: (name: string) => Effect.Effect<void, SecretStoreError>;
  }
>()("t3/auth/ServerSecretStore") {}

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;

  yield* fileSystem.makeDirectory(serverConfig.secretsDir, { recursive: true });
  yield* fileSystem.chmod(serverConfig.secretsDir, 0o700).pipe(
    Effect.mapError(
      (cause) =>
        new SecretStoreSecureError({
          resource: `secrets directory ${serverConfig.secretsDir}`,
          cause,
        }),
    ),
  );

  const resolveSecretPath = (name: string) => path.join(serverConfig.secretsDir, `${name}.bin`);

  const get: ServerSecretStore["Service"]["get"] = (name) =>
    fileSystem.readFile(resolveSecretPath(name)).pipe(
      Effect.map((bytes) => Option.some(Uint8Array.from(bytes))),
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(Option.none())
          : Effect.fail(
              new SecretStoreReadError({
                resource: `secret ${name}`,
                cause,
              }),
            ),
      ),
      Effect.withSpan("ServerSecretStore.get"),
    );

  const set: ServerSecretStore["Service"]["set"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    return crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new SecretStoreTemporaryPathError({
            resource: `secret ${name}`,
            cause,
          }),
      ),
      Effect.flatMap((uuid) => {
        const tempPath = `${secretPath}.${uuid}.tmp`;
        return Effect.gen(function* () {
          yield* fileSystem.writeFile(tempPath, value);
          yield* fileSystem.chmod(tempPath, 0o600);
          yield* fileSystem.rename(tempPath, secretPath);
          yield* fileSystem.chmod(secretPath, 0o600);
        }).pipe(
          Effect.catch((cause) =>
            fileSystem.remove(tempPath).pipe(
              Effect.ignore,
              Effect.flatMap(() =>
                Effect.fail(
                  new SecretStorePersistError({
                    resource: `secret ${name}`,
                    cause,
                  }),
                ),
              ),
            ),
          ),
        );
      }),
      Effect.withSpan("ServerSecretStore.set"),
    );
  };

  const create: ServerSecretStore["Service"]["create"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    return Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem.open(secretPath, {
          flag: "wx",
          mode: 0o600,
        });
        yield* file.writeAll(value);
        yield* file.sync;
        yield* fileSystem.chmod(secretPath, 0o600);
      }),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SecretStorePersistError({
            resource: `secret ${name}`,
            cause,
          }),
      ),
    );
  };

  const getOrCreateRandom: ServerSecretStore["Service"]["getOrCreateRandom"] = (name, bytes) =>
    get(name).pipe(
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed,
          onNone: () =>
            crypto.randomBytes(bytes).pipe(
              Effect.mapError(
                (cause) =>
                  new SecretStoreRandomGenerationError({
                    resource: `secret ${name}`,
                    cause,
                  }),
              ),
              Effect.flatMap((generated) =>
                create(name, generated).pipe(
                  Effect.as(Uint8Array.from(generated)),
                  Effect.catchIf(isSecretStoreError, (error) =>
                    isSecretAlreadyExistsError(error)
                      ? get(name).pipe(
                          Effect.flatMap(
                            Option.match({
                              onSome: Effect.succeed,
                              onNone: () =>
                                Effect.fail(
                                  new SecretStoreConcurrentReadError({
                                    resource: `secret ${name}`,
                                  }),
                                ),
                            }),
                          ),
                        )
                      : Effect.fail(error),
                  ),
                ),
              ),
            ),
        }),
      ),
      Effect.withSpan("ServerSecretStore.getOrCreateRandom"),
    );

  const remove: ServerSecretStore["Service"]["remove"] = (name) =>
    fileSystem.remove(resolveSecretPath(name)).pipe(
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.void
          : Effect.fail(
              new SecretStoreRemoveError({
                resource: `secret ${name}`,
                cause,
              }),
            ),
      ),
      Effect.withSpan("ServerSecretStore.remove"),
    );

  return ServerSecretStore.of({
    get,
    set,
    create,
    getOrCreateRandom,
    remove,
  });
});

const hubSecretAlreadyExists = (name: string) =>
  PlatformError.systemError({
    _tag: "AlreadyExists",
    module: "ServerSecretStore",
    method: "create",
    pathOrDescriptor: name,
  });

/**
 * Hub mode keeps secrets as tenant rows encrypted with the hub secret key (see
 * `HubSecretCipher`): the hub's state directory is disposable and shared
 * machines must not hold them in plain files.
 */
const makeHub = (hubDatabase: HubDatabaseShape) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const serverConfig = yield* ServerConfig.ServerConfig;
    const encodedKey = serverConfig.hub?.secretKey;
    if (encodedKey === undefined) {
      return yield* Effect.die(new HubSecretKeyError());
    }
    // An invalid key is a configuration defect: fail startup (without echoing it).
    const key = yield* Effect.sync(() => parseHubSecretKey(encodedKey));
    const { sql, tenantId } = hubDatabase;

    const get: ServerSecretStore["Service"]["get"] = (name) =>
      sql<{ readonly format: number; readonly nonce: Uint8Array; readonly ciphertext: Uint8Array }>`
        SELECT format, nonce, ciphertext
        FROM hub_secrets
        WHERE user_id = ${tenantId}
          AND name = ${name}
      `.pipe(
        Effect.mapError((cause) => new SecretStoreReadError({ resource: `secret ${name}`, cause })),
        Effect.flatMap(([row]) =>
          row === undefined
            ? Effect.succeed(Option.none<Uint8Array>())
            : Effect.try({
                try: () => Option.some(decryptHubSecret({ key, tenantId, name, stored: row })),
                catch: (cause) => new SecretStoreDecodeError({ resource: `secret ${name}`, cause }),
              }),
        ),
        Effect.withSpan("ServerSecretStore.get"),
      );

    const encrypt = (name: string, value: Uint8Array) =>
      Effect.try({
        try: () => encryptHubSecret({ key, tenantId, name, plaintext: value }),
        catch: (cause) => new SecretStoreEncodeError({ resource: `secret ${name}`, cause }),
      });

    const set: ServerSecretStore["Service"]["set"] = (name, value) =>
      encrypt(name, value).pipe(
        Effect.flatMap((stored) =>
          sql`
            INSERT INTO hub_secrets (user_id, name, format, nonce, ciphertext, updated_at)
            VALUES (${tenantId}, ${name}, ${stored.format}, ${stored.nonce}, ${stored.ciphertext}, now())
            ON CONFLICT (user_id, name)
            DO UPDATE SET
              format = excluded.format,
              nonce = excluded.nonce,
              ciphertext = excluded.ciphertext,
              updated_at = excluded.updated_at
          `.pipe(
            Effect.mapError(
              (cause) => new SecretStorePersistError({ resource: `secret ${name}`, cause }),
            ),
          ),
        ),
        Effect.asVoid,
        Effect.withSpan("ServerSecretStore.set"),
      );

    const create: ServerSecretStore["Service"]["create"] = (name, value) =>
      encrypt(name, value).pipe(
        Effect.flatMap((stored) =>
          sql<{ readonly name: string }>`
            INSERT INTO hub_secrets (user_id, name, format, nonce, ciphertext)
            VALUES (${tenantId}, ${name}, ${stored.format}, ${stored.nonce}, ${stored.ciphertext})
            ON CONFLICT (user_id, name) DO NOTHING
            RETURNING name
          `.pipe(
            Effect.mapError(
              (cause) => new SecretStorePersistError({ resource: `secret ${name}`, cause }),
            ),
          ),
        ),
        Effect.flatMap((rows) =>
          rows.length > 0
            ? Effect.void
            : Effect.fail(
                new SecretStorePersistError({
                  resource: `secret ${name}`,
                  cause: hubSecretAlreadyExists(name),
                }),
              ),
        ),
        Effect.withSpan("ServerSecretStore.create"),
      );

    const getOrCreateRandom: ServerSecretStore["Service"]["getOrCreateRandom"] = (name, bytes) =>
      get(name).pipe(
        Effect.flatMap(
          Option.match({
            onSome: Effect.succeed,
            onNone: () =>
              crypto.randomBytes(bytes).pipe(
                Effect.mapError(
                  (cause) =>
                    new SecretStoreRandomGenerationError({ resource: `secret ${name}`, cause }),
                ),
                Effect.flatMap((generated) =>
                  create(name, generated).pipe(
                    Effect.as(Uint8Array.from(generated)),
                    Effect.catchIf(isSecretAlreadyExistsError, () =>
                      get(name).pipe(
                        Effect.flatMap(
                          Option.match({
                            onSome: Effect.succeed,
                            onNone: () =>
                              Effect.fail(
                                new SecretStoreConcurrentReadError({ resource: `secret ${name}` }),
                              ),
                          }),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          }),
        ),
        Effect.withSpan("ServerSecretStore.getOrCreateRandom"),
      );

    const remove: ServerSecretStore["Service"]["remove"] = (name) =>
      sql`
        DELETE FROM hub_secrets
        WHERE user_id = ${tenantId}
          AND name = ${name}
      `.pipe(
        Effect.mapError(
          (cause) => new SecretStoreRemoveError({ resource: `secret ${name}`, cause }),
        ),
        Effect.asVoid,
        Effect.withSpan("ServerSecretStore.remove"),
      );

    return ServerSecretStore.of({ get, set, create, getOrCreateRandom, remove });
  });

export const layer = Layer.effect(
  ServerSecretStore,
  Effect.gen(function* () {
    const hubDatabase = yield* HubDatabase;
    return hubDatabase === undefined ? yield* make : yield* makeHub(hubDatabase);
  }),
);
