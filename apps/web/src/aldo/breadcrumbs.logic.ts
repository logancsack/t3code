import type { AldoHomeConversation } from "./homeApi";
import { repoShortName } from "./places.logic";

/** Keep a user's name; replace the generated multi-repository label with the primary name. */
export function breadcrumbProjectName(name: string, repos: ReadonlyArray<string>): string {
  const primary = repos[0];
  if (!primary) return name;
  const generated = repos.map(repoShortName).join(" + ");
  const short = repoShortName(primary);
  if (!name || name === generated || name === short) return short === "aldo" ? "Aldo" : short;
  return name;
}

/** Companion repositories don't change which project owns a thread. */
export function breadcrumbProjectThreads(
  conversations: ReadonlyArray<AldoHomeConversation>,
  primary: string,
): ReadonlyArray<AldoHomeConversation> {
  return conversations.filter((thread) => thread.repos[0] === primary);
}
