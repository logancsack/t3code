import { artifactsField, type AldoArtifact } from "./artifacts.logic";
import { openTargetOf, type AldoOpenTarget } from "./assistant.logic";

export type AldoVoiceReference =
  | { readonly kind: "artifact"; readonly artifact: AldoArtifact }
  | { readonly kind: "thread"; readonly title: string; readonly target: AldoOpenTarget }
  | { readonly kind: "link"; readonly title: string; readonly url: string };

export function voiceReferencesOf(value: unknown): AldoVoiceReference[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((raw): AldoVoiceReference[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    if (r.kind === "artifact") {
      return (artifactsField([r.artifact]).artifacts ?? []).map((artifact) => ({
        kind: "artifact",
        artifact,
      }));
    }
    if (typeof r.title !== "string") return [];
    if (r.kind === "thread") {
      const target = openTargetOf({ result: { open: r.target } });
      return target ? [{ kind: "thread", title: r.title, target }] : [];
    }
    if (
      r.kind === "link" &&
      typeof r.url === "string" &&
      /^https:\/\/(github\.com|gitlab\.com)\//.test(r.url)
    ) {
      return [{ kind: "link", title: r.title, url: r.url }];
    }
    return [];
  });
}

export function voiceReferenceKey(r: AldoVoiceReference): string {
  return r.kind === "thread"
    ? `${r.target.environmentId}/${r.target.threadId}`
    : r.kind === "link"
      ? r.url
      : r.artifact.kind === "file"
        ? r.artifact.url
        : JSON.stringify(r.artifact);
}

export function mergeVoiceReferences(
  previous: readonly AldoVoiceReference[],
  next: readonly AldoVoiceReference[],
): AldoVoiceReference[] {
  return [...new Map([...previous, ...next].map((r) => [voiceReferenceKey(r), r])).values()].slice(
    -20,
  );
}
