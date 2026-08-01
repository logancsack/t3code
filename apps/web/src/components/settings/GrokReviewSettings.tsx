import { useAtomValue } from "@effect/atom-react";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isManagedDevPc } from "../../managedDevPc";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsSection } from "./settingsLayout";

const SETTINGS_PATH = "/_devpc/aldo-review/repositories";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GROK_REVIEW_MODEL = "grok-4.5";

interface AldoReviewRepositorySetting {
  readonly repository: string;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly providerInstanceId: string | null;
  readonly providerDriver: string | null;
  readonly model: string | null;
}

interface AldoReviewRepositoryList {
  readonly installationUrl: string | null;
  readonly repositories: ReadonlyArray<AldoReviewRepositorySetting>;
}

interface ReviewSelection {
  readonly providerInstanceId: string;
  readonly providerDriver: string;
  readonly model: string;
}

export function normalizeGrokReviewRepository(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const segments = normalized.split("/");
  return REPOSITORY_PATTERN.test(normalized) &&
    segments.every((segment) => segment !== "." && segment !== "..")
    ? normalized
    : null;
}

export function aldoReviewToggleDisabled(input: {
  saving: boolean;
  enabled: boolean;
  connected: boolean;
  providerAvailable: boolean;
}): boolean {
  return input.saving || (!input.enabled && (!input.connected || !input.providerAvailable));
}

function sortRepositories(
  repositories: ReadonlyArray<AldoReviewRepositorySetting>,
): ReadonlyArray<AldoReviewRepositorySetting> {
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

function reviewModels(entry: ProviderInstanceEntry) {
  const models = entry.models.map((model) => ({ slug: model.slug, name: model.name }));
  if (entry.driverKind === "grok" && !models.some((model) => model.slug === GROK_REVIEW_MODEL)) {
    models.unshift({ slug: GROK_REVIEW_MODEL, name: "Grok 4.5" });
  }
  return models;
}

function defaultReviewModel(entry: ProviderInstanceEntry): string | undefined {
  if (entry.driverKind === "grok") return GROK_REVIEW_MODEL;
  return entry.models.find((candidate) => candidate.isDefault)?.slug ?? entry.models[0]?.slug;
}

function defaultSelection(entries: ReadonlyArray<ProviderInstanceEntry>): ReviewSelection | null {
  const entry = entries.find((candidate) => candidate.driverKind === "grok") ?? entries[0];
  if (!entry) return null;
  const model = defaultReviewModel(entry);
  return model
    ? {
        providerInstanceId: entry.instanceId,
        providerDriver: entry.driverKind,
        model,
      }
    : null;
}

function ProviderSelect(props: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  value: string;
  disabled: boolean;
  onChange: (entry: ProviderInstanceEntry) => void;
}) {
  const active = props.entries.find((entry) => entry.instanceId === props.value);
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        const entry = props.entries.find((candidate) => candidate.instanceId === value);
        if (entry) props.onChange(entry);
      }}
    >
      <SelectTrigger className="h-8 min-w-36 text-xs" disabled={props.disabled}>
        <SelectValue>{active?.displayName ?? "Select provider"}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {props.entries.map((entry) => (
          <SelectItem key={entry.instanceId} value={entry.instanceId}>
            {entry.displayName}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function ModelSelect(props: {
  entry: ProviderInstanceEntry | undefined;
  value: string;
  disabled: boolean;
  onChange: (model: string) => void;
}) {
  const models = props.entry ? reviewModels(props.entry) : [];
  const active = models.find((model) => model.slug === props.value);
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value) props.onChange(value);
      }}
    >
      <SelectTrigger className="h-8 min-w-40 text-xs" disabled={props.disabled || !props.entry}>
        <SelectValue>{active?.name ?? props.value ?? "Select model"}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {models.map((model) => (
          <SelectItem key={model.slug} value={model.slug}>
            {model.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function GrokReviewSettings() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const availableProviders = useMemo(
    () =>
      sortProviderInstanceEntries(deriveProviderInstanceEntries(providers)).filter(
        (entry) =>
          entry.enabled &&
          entry.installed &&
          entry.status === "ready" &&
          entry.snapshot.auth.status === "authenticated" &&
          reviewModels(entry).length > 0,
      ),
    [providers],
  );
  const preferredSelection = useMemo(
    () => defaultSelection(availableProviders),
    [availableProviders],
  );
  const [repositories, setRepositories] = useState<ReadonlyArray<AldoReviewRepositorySetting>>([]);
  const [repositoryInput, setRepositoryInput] = useState("");
  const [installationUrl, setInstallationUrl] = useState<string | null>(null);
  const [newSelection, setNewSelection] = useState<ReviewSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingRepository, setSavingRepository] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const selectedProvider = newSelection
      ? availableProviders.find((entry) => entry.instanceId === newSelection.providerInstanceId)
      : undefined;
    const selectionIsAvailable =
      selectedProvider !== undefined &&
      reviewModels(selectedProvider).some((model) => model.slug === newSelection?.model);
    if (!selectionIsAvailable && newSelection !== preferredSelection) {
      setNewSelection(preferredSelection);
    }
  }, [availableProviders, newSelection, preferredSelection]);

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
      const body = (await response.json()) as AldoReviewRepositoryList;
      setInstallationUrl(body.installationUrl ?? null);
      setRepositories(sortRepositories(body.repositories));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Could not load Aldo Review settings.");
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

  const save = useCallback(
    async (repository: string, enabled: boolean, selection: ReviewSelection) => {
      setSavingRepository(repository);
      setError(null);
      try {
        const response = await fetch(SETTINGS_PATH, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repository, enabled, ...selection }),
        });
        if (!response.ok) throw new Error(await readResponseError(response));
        setRepositories((current) =>
          sortRepositories([
            ...current.filter((entry) => entry.repository !== repository),
            {
              repository,
              enabled,
              connected:
                current.find((entry) => entry.repository === repository)?.connected ?? false,
              ...selection,
            },
          ]),
        );
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not update Aldo Review settings.");
        return false;
      } finally {
        setSavingRepository(null);
      }
    },
    [],
  );

  if (!isManagedDevPc) return null;
  const normalizedInput = normalizeGrokReviewRepository(repositoryInput);
  const addRepository = async () => {
    if (!normalizedInput || !newSelection) return;
    if (await save(normalizedInput, true, newSelection)) setRepositoryInput("");
  };

  return (
    <SettingsSection
      title="Aldo Review"
      headerAction={
        <Button
          size="icon-xs"
          variant="ghost"
          className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh Aldo Review settings"
        >
          <RefreshCwIcon className={loading ? "size-3 animate-spin" : "size-3"} />
        </Button>
      }
    >
      <div className="rounded-xl px-3 py-3 sm:px-4">
        <p className="max-w-2xl text-[13px] leading-[1.45] text-muted-foreground/80">
          Run a fast multi-agent review swarm on every pull-request head. Choose any connected
          provider and model; Grok 4.5 uses medium reasoning by default and escalates ambiguous
          severe findings to high reasoning.
        </p>
        {installationUrl ? (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 h-8"
            onClick={() => window.open(installationUrl, "_blank", "noopener,noreferrer")}
          >
            Install Aldo Review on GitHub
          </Button>
        ) : null}
        {availableProviders.length === 0 ? (
          <p className="mt-3 text-xs text-warning">
            Connect and authenticate a provider before enabling Aldo Review.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
            <Input
              value={repositoryInput}
              onChange={(event) => setRepositoryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && normalizedInput && newSelection) {
                  event.preventDefault();
                  void addRepository();
                }
              }}
              placeholder="owner/repository"
              aria-label="GitHub repository"
              className="h-8 min-w-52 text-sm"
            />
            {newSelection ? (
              <>
                <ProviderSelect
                  entries={availableProviders}
                  value={newSelection.providerInstanceId}
                  disabled={savingRepository !== null}
                  onChange={(entry) => {
                    const model = defaultReviewModel(entry);
                    if (model) {
                      setNewSelection({
                        providerInstanceId: entry.instanceId,
                        providerDriver: entry.driverKind,
                        model,
                      });
                    }
                  }}
                />
                <ModelSelect
                  entry={availableProviders.find(
                    (entry) => entry.instanceId === newSelection.providerInstanceId,
                  )}
                  value={newSelection.model}
                  disabled={savingRepository !== null}
                  onChange={(model) => setNewSelection({ ...newSelection, model })}
                />
              </>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              disabled={!normalizedInput || !newSelection || savingRepository !== null}
              onClick={() => void addRepository()}
            >
              <PlusIcon className="size-3.5" />
              Add and enable
            </Button>
          </div>
        )}
        {repositoryInput && !normalizedInput ? (
          <p className="mt-2 text-xs text-warning">Use a GitHub repository like owner/name.</p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {repositories.map((setting) => {
        const fallback = preferredSelection;
        const selection: ReviewSelection | null =
          setting.providerInstanceId && setting.providerDriver && setting.model
            ? {
                providerInstanceId: setting.providerInstanceId,
                providerDriver: setting.providerDriver,
                model: setting.model,
              }
            : fallback;
        const selectedEntry = availableProviders.find(
          (entry) => entry.instanceId === selection?.providerInstanceId,
        );
        return (
          <div
            key={setting.repository}
            className="flex flex-col gap-3 rounded-xl px-3 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-4"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{setting.repository}</p>
              <p className="text-xs text-muted-foreground/80">
                {setting.connected
                  ? "Aldo Review app connected"
                  : "Install Aldo Review on this repository to receive reviews"}
              </p>
            </div>
            {selection ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <ProviderSelect
                  entries={availableProviders}
                  value={selection.providerInstanceId}
                  disabled={savingRepository !== null}
                  onChange={(entry) => {
                    const model = defaultReviewModel(entry);
                    if (model) {
                      void save(setting.repository, setting.enabled, {
                        providerInstanceId: entry.instanceId,
                        providerDriver: entry.driverKind,
                        model,
                      });
                    }
                  }}
                />
                <ModelSelect
                  entry={selectedEntry}
                  value={selection.model}
                  disabled={savingRepository !== null}
                  onChange={(model) =>
                    void save(setting.repository, setting.enabled, { ...selection, model })
                  }
                />
                <Switch
                  checked={setting.enabled}
                  disabled={aldoReviewToggleDisabled({
                    saving: savingRepository !== null,
                    enabled: setting.enabled,
                    connected: setting.connected,
                    providerAvailable: selectedEntry !== undefined,
                  })}
                  onCheckedChange={(enabled) =>
                    void save(setting.repository, Boolean(enabled), selection)
                  }
                  aria-label={`Review every pull request for ${setting.repository}`}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {!loading && repositories.length === 0 ? (
        <p className="rounded-xl px-3 py-3 text-xs text-muted-foreground sm:px-4">
          No repositories are enabled yet.
        </p>
      ) : null}
    </SettingsSection>
  );
}
