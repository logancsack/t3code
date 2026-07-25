// @effect-diagnostics nodeBuiltinImport:off - This is the atomic Node filesystem boundary for provider secrets.
// @effect-diagnostics preferSchemaOverJson:off - The persisted file is decoded with the schema immediately after JSON parsing.
// @effect-diagnostics globalDate:off - A timestamp only makes the adjacent temporary filename unique.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Schema from "effect/Schema";

const StoredBitbucketCredentials = Schema.Struct({
  email: Schema.String,
  apiToken: Schema.String,
});

export type StoredBitbucketCredentials = typeof StoredBitbucketCredentials.Type;
const decodeStoredBitbucketCredentials = Schema.decodeUnknownSync(StoredBitbucketCredentials);

function credentialPath(): string {
  return NodePath.join(NodeOS.homedir(), ".config", "t3code", "bitbucket.json");
}

export async function readStoredBitbucketCredentials(): Promise<StoredBitbucketCredentials | null> {
  try {
    const content = await NodeFS.promises.readFile(credentialPath(), "utf8");
    return decodeStoredBitbucketCredentials(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function writeStoredBitbucketCredentials(
  credentials: StoredBitbucketCredentials,
): Promise<void> {
  const target = credentialPath();
  const directory = NodePath.dirname(target);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await NodeFS.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  await NodeFS.promises.writeFile(temporary, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  await NodeFS.promises.rename(temporary, target);
  await NodeFS.promises.chmod(target, 0o600);
}
