import { useAtomValue } from "@effect/atom-react";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isManagedDevPc } from "../../managedDevPc";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsSection } from "./settingsLayout";

const SETTINGS_PATH = "/_devpc/aldo-review/repositories";
const GROK_REVIEW_MODEL = "grok-4.5";
const NO_PROVIDER_VALUE = "__none__";

interface AldoReviewRepositorySetting {
  readonly repository: string;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly providerInstanceId: string | null;
  readonly supplementalProviderInstanceId: string | null;
  readonly providerDriver: string | null;
  readonly model: string | null;
}

interface AldoReviewRepositoryList {
  readonly installationUrl: string | null;
  readonly repositories: ReadonlyArray<AldoReviewRepositorySetting>;
}

interface ReviewSelection {
  readonly providerInstanceId: string;
  readonly supplementalProviderInstanceId: string | null;
  readonly providerDriver: string;
  readonly model: string;
}

export function aldoReviewToggleDisabled(input: {
  saving: boolean;
  enabled: boolean;
  connected: boolean;
  providerAvailable: boolean;
}): boolean {
  return input.saving || (!input.enabled && (!input.connected || !input.providerAvailable));
}

export function resolveSupplementalReviewProviderId(input: {
  stored: string | null;
  primary: string;
}): string | null {
  return input.stored && input.stored !== input.primary ? input.stored : null;
}

export function supplementalProviderInstanceIdForSave(
  entry: { readonly instanceId: string } | null,
): string | null {
  return entry?.instanceId ?? null;
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
  const supplemental = entries.find(
    (candidate) =>
      candidate.instanceId !== entry.instanceId &&
      candidate.driverKind === "opencode" &&
      candidate.models.some((candidateModel) =>
        /^opencode\/nemotron-3-ultra(?:-|$)/.test(candidateModel.slug),
      ),
  );
  return model
    ? {
        providerInstanceId: entry.instanceId,
        supplementalProviderInstanceId: supplemental?.instanceId ?? null,
        providerDriver: entry.driverKind,
        model,
      }
    : null;
}

function ProviderSelect(props: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  value: string;
  ariaLabel?: string;
  placeholder?: string;
  allowNone?: boolean;
  disabled: boolean;
  onChange: (entry: ProviderInstanceEntry | null) => void;
}) {
  const active = props.entries.find((entry) => entry.instanceId === props.value);
  const value = props.allowNone && !props.value ? NO_PROVIDER_VALUE : props.value;
  return (
    <Select
      value={value}
      onValueChange={(value) => {
        if (props.allowNone && value === NO_PROVIDER_VALUE) {
          props.onChange(null);
          return;
        }
        const entry = props.entries.find((candidate) => candidate.instanceId === value);
        if (entry) props.onChange(entry);
      }}
    >
      <SelectTrigger
        className="h-8 min-w-36 text-xs"
        disabled={props.disabled}
        aria-label={props.ariaLabel}
      >
        <SelectValue>
          {active?.displayName ??
            (props.allowNone && !props.value ? "No supplemental provider" : props.placeholder) ??
            "Select provider"}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {props.allowNone ? (
          <SelectItem value={NO_PROVIDER_VALUE}>No supplemental provider</SelectItem>
        ) : null}
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
  const supplementalProviders = useMemo(
    () =>
      availableProviders.filter(
        (entry) =>
          entry.driverKind === "opencode" &&
          entry.models.some((model) => /^opencode\/nemotron-3-ultra(?:-|$)/.test(model.slug)),
      ),
    [availableProviders],
  );
  const [repositories, setRepositories] = useState<ReadonlyArray<AldoReviewRepositorySetting>>([]);
  const [installationUrl, setInstallationUrl] = useState<string | null>(null);
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
          severe findings to high reasoning. An explicitly selected OpenCode Nemotron provider runs
          the independent code-quality and security roles.
        </p>
        {installationUrl ? (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 h-8"
            onClick={() => window.open(installationUrl, "_blank", "noopener,noreferrer")}
          >
            Install or manage Aldo Review on GitHub
          </Button>
        ) : null}
        {availableProviders.length === 0 ? (
          <p className="mt-3 text-xs text-warning">
            Connect and authenticate a provider before enabling Aldo Review.
          </p>
        ) : null}
        {availableProviders.length > 0 && supplementalProviders.length === 0 ? (
          <p className="mt-3 text-xs text-warning">
            Connect OpenCode with Nemotron 3 Ultra to enable all six review roles.
          </p>
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
                supplementalProviderInstanceId: resolveSupplementalReviewProviderId({
                  stored: setting.supplementalProviderInstanceId,
                  primary: setting.providerInstanceId,
                }),
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
                  : "GitHub access was removed; reinstall the app to resume reviews"}
              </p>
            </div>
            {selection ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <ProviderSelect
                  entries={availableProviders}
                  value={selection.providerInstanceId}
                  disabled={savingRepository !== null}
                  onChange={(entry) => {
                    if (!entry) return;
                    const model = defaultReviewModel(entry);
                    if (model) {
                      void save(setting.repository, setting.enabled, {
                        providerInstanceId: entry.instanceId,
                        supplementalProviderInstanceId: resolveSupplementalReviewProviderId({
                          stored: selection.supplementalProviderInstanceId,
                          primary: entry.instanceId,
                        }),
                        providerDriver: entry.driverKind,
                        model,
                      });
                    }
                  }}
                />
                <ProviderSelect
                  entries={supplementalProviders.filter(
                    (entry) => entry.instanceId !== selection.providerInstanceId,
                  )}
                  value={selection.supplementalProviderInstanceId ?? ""}
                  ariaLabel="Supplemental OpenCode review provider"
                  placeholder="OpenCode specialist"
                  allowNone
                  disabled={savingRepository !== null || supplementalProviders.length === 0}
                  onChange={(entry) =>
                    void save(setting.repository, setting.enabled, {
                      ...selection,
                      supplementalProviderInstanceId: supplementalProviderInstanceIdForSave(entry),
                    })
                  }
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
          Install Aldo Review, select repositories on GitHub, then refresh. New repositories appear
          here disabled until you choose a provider and turn them on.
        </p>
      ) : null}
    </SettingsSection>
  );
}
