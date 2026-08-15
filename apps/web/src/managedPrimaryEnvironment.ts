import {
  ExecutionEnvironmentDescriptor,
  type ExecutionEnvironmentDescriptor as ExecutionEnvironmentDescriptorType,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const MANAGED_PRIMARY_ENVIRONMENT_STORAGE_KEY =
  "t3-managed-primary-environment-descriptor-v1";

const decodeEnvironmentDescriptor = Schema.decodeUnknownOption(ExecutionEnvironmentDescriptor);

/**
 * The descriptor contains only public environment metadata. Persisting it lets
 * the managed browser reopen its IndexedDB-backed shell while the guest is
 * intentionally asleep, without inventing a second server-side identity.
 */
export function readManagedPrimaryEnvironmentDescriptor(): ExecutionEnvironmentDescriptorType | null {
  if (import.meta.env.VITE_DEVPC_MANAGED !== "1") return null;
  try {
    const encoded = window.localStorage.getItem(MANAGED_PRIMARY_ENVIRONMENT_STORAGE_KEY);
    if (!encoded) return null;
    return Option.getOrNull(decodeEnvironmentDescriptor(JSON.parse(encoded)));
  } catch {
    return null;
  }
}

export function writeManagedPrimaryEnvironmentDescriptor(
  descriptor: ExecutionEnvironmentDescriptorType,
): void {
  if (import.meta.env.VITE_DEVPC_MANAGED !== "1") return;
  try {
    window.localStorage.setItem(
      MANAGED_PRIMARY_ENVIRONMENT_STORAGE_KEY,
      JSON.stringify(descriptor),
    );
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts. The
    // managed bootstrap will perform a normal wake on the next cold load.
  }
}
