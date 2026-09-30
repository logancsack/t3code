/**
 * HubSecretCipher - encryption of `ServerSecretStore` values at rest in the hub.
 *
 * AES-256-GCM with a random 96-bit nonce per write. The additional
 * authenticated data binds each ciphertext to its tenant and secret name, so a
 * row copied to another tenant or renamed fails to decrypt. The key is
 * `T3CODE_HUB_SECRET_KEY` (base64, 32 bytes) and never reaches the database.
 *
 * @module HubSecretCipher
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

/** Stored in `hub_secrets.format`; bump when the scheme or key changes. */
export const HUB_SECRET_FORMAT_AES_256_GCM_V1 = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class HubSecretKeyError extends Error {
  constructor() {
    super("T3CODE_HUB_SECRET_KEY must be a base64-encoded 32-byte key.");
    this.name = "HubSecretKeyError";
  }
}

/** Decodes the configured key; throws `HubSecretKeyError` without echoing it. */
export const parseHubSecretKey = (encoded: string): Buffer => {
  const trimmed = encoded.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    throw new HubSecretKeyError();
  }
  const key = Buffer.from(trimmed.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  if (key.length !== 32) {
    throw new HubSecretKeyError();
  }
  return key;
};

const additionalData = (tenantId: string, name: string) =>
  Buffer.from(`t3-hub-secret\u0000v1\u0000${tenantId}\u0000${name}`, "utf8");

export interface HubSecretCiphertext {
  readonly format: number;
  readonly nonce: Uint8Array;
  /** Ciphertext followed by the 16-byte GCM tag. */
  readonly ciphertext: Uint8Array;
}

export const encryptHubSecret = (input: {
  readonly key: Buffer;
  readonly tenantId: string;
  readonly name: string;
  readonly plaintext: Uint8Array;
}): HubSecretCiphertext => {
  const nonce = NodeCrypto.randomBytes(NONCE_BYTES);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", input.key, nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(additionalData(input.tenantId, input.name));
  const ciphertext = Buffer.concat([
    cipher.update(input.plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { format: HUB_SECRET_FORMAT_AES_256_GCM_V1, nonce, ciphertext };
};

/** Throws when the format is unknown or authentication fails. */
export const decryptHubSecret = (input: {
  readonly key: Buffer;
  readonly tenantId: string;
  readonly name: string;
  readonly stored: HubSecretCiphertext;
}): Uint8Array => {
  const { format, nonce, ciphertext } = input.stored;
  if (format !== HUB_SECRET_FORMAT_AES_256_GCM_V1) {
    throw new Error(`Unsupported hub secret format ${format}.`);
  }
  if (nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength < TAG_BYTES) {
    throw new Error("Malformed hub secret ciphertext.");
  }
  const body = Buffer.from(ciphertext);
  const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", input.key, Buffer.from(nonce), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(additionalData(input.tenantId, input.name));
  decipher.setAuthTag(body.subarray(body.byteLength - TAG_BYTES));
  return Uint8Array.from(
    Buffer.concat([
      decipher.update(body.subarray(0, body.byteLength - TAG_BYTES)),
      decipher.final(),
    ]),
  );
};
