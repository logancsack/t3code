import { settingsSubagents } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
import type { ClientSettings } from "@t3tools/contracts";
import { NetworkIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useClientSettings } from "../hooks/useSettings";
import { AldoBrandTile } from "./AldoBrandTile";
import {
  saveAldoSubagents,
  type AldoSubagentDefault,
  type AldoSubagentProvider,
} from "./threadApi";
import { newestAldoProviders, onAldoServerConfigChange } from "./serverConfig";
import {
  chooseModel,
  MODELS_DEFAULT,
  offeredEfforts,
  offeredModels,
  SAME_AS_MAIN,
  SUBAGENT_AGENTS,
  subagentModels,
  withSubagentDefault,
  type HiddenModels,
  type SubagentAgent,
} from "./subagents.logic";

const hiddenModels = (settings: ClientSettings): HiddenModels => settings.providerModelPreferences;

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function SubagentRow(props: {
  readonly id?: string;
  readonly agent: SubagentAgent;
  readonly providers: ReadonlyArray<Record<string, unknown>>;
  readonly hidden: HiddenModels;
  readonly saved: AldoSubagentDefault | undefined;
  readonly onChange: (value: AldoSubagentDefault | null) => void;
}) {
  const { agent, saved } = props;
  const models = offeredModels(subagentModels(props.providers, agent, props.hidden), saved);
  const model = saved ? models.find((candidate) => candidate.slug === saved.model) : undefined;
  const efforts = agent.efforts ? offeredEfforts(models, saved) : [];
  const effort = efforts.find((candidate) => candidate.id === saved?.reasoning);
  return (
    <SettingsRow
      {...(props.id ? { id: props.id } : {})}
      leading={<AldoBrandTile id={agent.kind} name={agent.title} size="sm" />}
      title={`${agent.title}’s helpers`}
      description={
        models.length > 0
          ? agent.description
          : `${agent.description} Its models show here once one of your threads has started.`
      }
      control={
        <>
          <Select
            value={saved?.model ?? SAME_AS_MAIN}
            onValueChange={(value) =>
              props.onChange(
                chooseModel(value === SAME_AS_MAIN ? null : String(value), models, saved),
              )
            }
          >
            <SelectTrigger
              className="h-8 min-w-44 text-xs"
              aria-label={`${agent.title}’s helpers’ model`}
            >
              <SelectValue>{model ? model.name : "Same as the thread"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value={SAME_AS_MAIN}>Same as the thread</SelectItem>
              {models.map((candidate) => (
                <SelectItem key={candidate.slug} value={candidate.slug}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {saved && efforts.length > 0 ? (
            <Select
              value={effort?.id ?? MODELS_DEFAULT}
              onValueChange={(value) =>
                props.onChange(
                  value === MODELS_DEFAULT
                    ? { model: saved.model }
                    : { model: saved.model, reasoning: String(value) },
                )
              }
            >
              <SelectTrigger
                className="h-8 min-w-32 text-xs"
                aria-label={`${agent.title}’s helpers’ reasoning`}
              >
                <SelectValue>{effort ? effort.label : "Model's default"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value={MODELS_DEFAULT}>Model's default</SelectItem>
                {efforts.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
        </>
      }
    />
  );
}

/**
 * Settings → Models: what each agent's subagents (its helpers) run on when it
 * doesn't pick a model (by default, the main agent's). Aldo writes it into
 * each machine's Claude Code and Codex config. Hidden with an Aldo that
 * doesn't keep it. `bare`, its rows alone, for a section of the page's.
 */
export function AldoSubagentsPanel(props: { readonly bare?: boolean } = {}) {
  const cached = useSettingsResource(settingsSubagents);
  const saved = cached.data ?? null;
  const loadError = cached.error;
  const [providers, setProviders] = useState<ReadonlyArray<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const hidden = useClientSettings(hiddenModels);
  const load = useCallback(() => {
    void settingsSubagents.refresh().catch(() => undefined);
  }, []);

  // The models: the newest config's, again as an agent's changes (its first one may come after this opens).
  useEffect(() => {
    const refresh = () => {
      newestAldoProviders().then(setProviders, () => undefined);
    };
    refresh();
    return onAldoServerConfigChange(refresh);
  }, []);

  if (!saved) {
    if (!loadError) return null;
    const failed = (
      <SettingsRow
        {...(props.bare ? { id: "aldo-subagents" } : {})}
        title="Couldn't load what helpers run on"
        description={loadError}
        control={
          <Button size="sm" variant="outline" onClick={load}>
            Try again
          </Button>
        }
      />
    );
    if (props.bare) return failed;
    return (
      <SettingsSection
        id="aldo-subagents"
        title="Helper models"
        icon={<NetworkIcon className="size-4" />}
      >
        {failed}
      </SettingsSection>
    );
  }

  const change = (kind: AldoSubagentProvider, value: AldoSubagentDefault | null) => {
    setError(null);
    void settingsSubagents
      .mutate(
        (current) => withSubagentDefault(current ?? {}, kind, value),
        () => saveAldoSubagents({ [kind]: value }),
      )
      .catch((cause: unknown) => setError(message(cause)));
  };

  const rows = (
    <>
      {SUBAGENT_AGENTS.map((agent, index) => (
        <SubagentRow
          key={agent.kind}
          {...(props.bare && index === 0 ? { id: "aldo-subagents" } : {})}
          agent={agent}
          providers={providers}
          hidden={hidden}
          saved={saved[agent.kind]}
          onChange={(value) => change(agent.kind, value)}
        />
      ))}
      {error ? <p className="px-4 pb-3 text-destructive-foreground text-sm">{error}</p> : null}
    </>
  );
  const note = (
    <p className="px-3 py-3 text-muted-foreground text-xs sm:px-4">
      A model you ask an agent to give a helper still wins. Changes reach new conversations within
      10 minutes.
    </p>
  );
  if (props.bare) {
    return (
      <>
        {rows}
        {note}
      </>
    );
  }
  return (
    <SettingsSection
      id="aldo-subagents"
      title="Helper models"
      icon={<NetworkIcon className="size-4" />}
    >
      {rows}
      {note}
    </SettingsSection>
  );
}
