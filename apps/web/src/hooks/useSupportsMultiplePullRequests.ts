import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentServerConfigsAtom } from "~/state/server";

// One boolean per environment: every sidebar row asks this, and reading the
// whole config map re-rendered them all on any config change.
const supportsMultiplePullRequestsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => get(environmentServerConfigsAtom).get(environmentId) !== undefined).pipe(
    Atom.withLabel(`web-supports-multiple-pull-requests:${environmentId}`),
  ),
);
const UNSUPPORTED_ATOM = Atom.make(false).pipe(
  Atom.withLabel("web-supports-multiple-pull-requests:none"),
);

export function useSupportsMultiplePullRequests(environmentId: EnvironmentId | null): boolean {
  return useAtomValue(
    environmentId === null ? UNSUPPORTED_ATOM : supportsMultiplePullRequestsAtom(environmentId),
  );
}
