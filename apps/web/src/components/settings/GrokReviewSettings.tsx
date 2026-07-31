import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { isManagedDevPc } from "../../managedDevPc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsSection } from "./settingsLayout";

const SETTINGS_PATH = "/_devpc/grok-review/repositories";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

interface GrokReviewRepositorySetting {
  readonly repository: string;
  readonly enabled: boolean;
  readonly connected: boolean;
}

interface GrokReviewRepositoryList {
  readonly repositories: ReadonlyArray<GrokReviewRepositorySetting>;
}

export function normalizeGrokReviewRepository(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const segments = normalized.split("/");
  return REPOSITORY_PATTERN.test(normalized) &&
    segments.every((segment) => segment !== "." && segment !== "..")
    ? normalized
    : null;
}

function sortRepositories(
  repositories: ReadonlyArray<GrokReviewRepositorySetting>,
): ReadonlyArray<GrokReviewRepositorySetting> {
  return repositories.toSorted((left, right) => left.repository.localeCompare(right.repository));
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed with HTTP ${response.status}.`;
  } catch {
    return `Request failed with HTTP ${response.status}.`;
  }
}

export function GrokReviewSettings() {
  const [repositories, setRepositories] = useState<ReadonlyArray<GrokReviewRepositorySetting>>([]);
  const [repositoryInput, setRepositoryInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingRepository, setSavingRepository] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(SETTINGS_PATH, {
        cache: "no-store",
        credentials: "same-origin",
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new Error(await readResponseError(response));
      const body = (await response.json()) as GrokReviewRepositoryList;
      setRepositories(sortRepositories(body.repositories));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Could not load Grok review settings.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isManagedDevPc) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const save = useCallback(async (repository: string, enabled: boolean) => {
    setSavingRepository(repository);
    setError(null);
    try {
      const response = await fetch(SETTINGS_PATH, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repository, enabled }),
      });
      if (!response.ok) throw new Error(await readResponseError(response));
      setRepositories((current) =>
        sortRepositories([
          ...current.filter((entry) => entry.repository !== repository),
          {
            repository,
            enabled,
            connected: current.find((entry) => entry.repository === repository)?.connected ?? false,
          },
        ]),
      );
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update Grok review settings.");
      return false;
    } finally {
      setSavingRepository(null);
    }
  }, []);

  if (!isManagedDevPc) return null;
  const normalizedInput = normalizeGrokReviewRepository(repositoryInput);
  const addRepository = async () => {
    if (!normalizedInput) return;
    if (await save(normalizedInput, true)) setRepositoryInput("");
  };

  return (
    <SettingsSection
      title="Automatic Grok review"
      headerAction={
        <Button
          size="icon-xs"
          variant="ghost"
          className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh automatic Grok review settings"
        >
          <RefreshCwIcon className={loading ? "size-3 animate-spin" : "size-3"} />
        </Button>
      }
    >
      <div className="rounded-xl px-3 py-3 sm:px-4">
        <p className="max-w-2xl text-[13px] leading-[1.45] text-muted-foreground/80">
          Run the bounded Grok 4.5 swarm on every new pull-request head. Reviews use medium
          reasoning by default, escalate uncertain high-severity findings when needed, and update
          one unified report on the pull request.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={repositoryInput}
            onChange={(event) => setRepositoryInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && normalizedInput) {
                event.preventDefault();
                void addRepository();
              }
            }}
            placeholder="owner/repository"
            aria-label="GitHub repository"
            className="h-8 max-w-sm text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled={!normalizedInput || savingRepository !== null}
            onClick={() => void addRepository()}
          >
            <PlusIcon className="size-3.5" />
            Add and enable
          </Button>
        </div>
        {repositoryInput && !normalizedInput ? (
          <p className="mt-2 text-xs text-warning">Use a GitHub repository like owner/name.</p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {repositories.map((setting) => (
        <div
          key={setting.repository}
          className="flex flex-col gap-3 rounded-xl px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{setting.repository}</p>
            <p className="text-xs text-muted-foreground/80">
              {setting.connected
                ? "GitHub events connected"
                : "Waiting for the first signed GitHub event"}
            </p>
          </div>
          <Switch
            checked={setting.enabled}
            disabled={savingRepository !== null}
            onCheckedChange={(enabled) => void save(setting.repository, Boolean(enabled))}
            aria-label={`Review every pull request for ${setting.repository}`}
          />
        </div>
      ))}

      {!loading && repositories.length === 0 ? (
        <p className="rounded-xl px-3 py-3 text-xs text-muted-foreground sm:px-4">
          No repositories are enabled yet.
        </p>
      ) : null}
    </SettingsSection>
  );
}
