import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { isGitRepository } from "./Utils.ts";

export const localCheckoutGitProbe = (cwd: string): Effect.Effect<boolean> =>
  Effect.sync(() => isGitRepository(cwd));

/**
 * Answers "is this checkout a git repository?" for orchestration reactors.
 *
 * Defaults to the local `.git` existence check. A hub that owns no checkout
 * overrides it with a runner-backed probe so reactors never stat the path.
 */
export class CheckoutGitProbe extends Context.Reference<(cwd: string) => Effect.Effect<boolean>>(
  "t3/git/CheckoutGitProbe",
  { defaultValue: () => localCheckoutGitProbe },
) {}
