import { useEffect, useState } from "react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  fetchAldoSubagents,
  saveAldoSubagents,
  type AldoSubagentDefault,
  type AldoSubagentProvider,
  type AldoSubagents,
} from "./cloud";
import { newestAldoProviders } from "./serverConfig";
import {
  chooseModel,
  offeredModels,
  SUBAGENT_AGENTS,
  subagentModels,
  type SubagentAgent,
} from "./subagents.logic";

const MAIN_MODEL = "main";
const MODEL_EFFORT = "default";

function SubagentRow(props: {
  readonly agent: SubagentAgent;
  readonly providers: ReadonlyArray<Record<string, unknown>>;
  readonly saved: AldoSubagentDefault | undefined;
  readonly onChange: (value: AldoSubagentDefault | null) => void;
}) {
  const { agent, saved } = props;
  const models = offeredModels(subagentModels(props.providers, agent), saved);
  const model = saved ? models.find((candidate) => candidate.slug === saved.model) : undefined;
  const efforts = model?.efforts ?? [];
  const effort = efforts.find((candidate) => candidate.id === saved?.reasoning);
  return (
    <SettingsRow
      title={agent.title}
      description={
        models.length > 0
          ? agent.description
          : `${agent.description} Its models show here once one of your threads has started.`
      }
      control={
        <>
          <Select
            value={saved?.model ?? MAIN_MODEL}
            onValueChange={(value) =>
              props.onChange(
                chooseModel(value === MAIN_MODEL ? null : String(value), models, saved),
              )
            }
          >
            <SelectTrigger
              className="h-8 min-w-44 text-xs"
              aria-label={`${agent.title} subagents' model`}
            >
              <SelectValue>{model ? model.name : "Same as the main agent"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value={MAIN_MODEL}>Same as the main agent</SelectItem>
              {models.map((candidate) => (
                <SelectItem key={candidate.slug} value={candidate.slug}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {saved && agent.efforts && efforts.length > 0 ? (
            <Select
              value={effort?.id ?? MODEL_EFFORT}
              onValueChange={(value) =>
                props.onChange(
                  value === MODEL_EFFORT
                    ? { model: saved.model }
                    : { model: saved.model, reasoning: String(value) },
                )
              }
            >
              <SelectTrigger
                className="h-8 min-w-32 text-xs"
                aria-label={`${agent.title} subagents' reasoning`}
              >
                <SelectValue>{effort ? effort.label : "Model's default"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value={MODEL_EFFORT}>Model's default</SelectItem>
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
 * Settings → Providers: what each agent's subagents run on when it doesn't
 * pick a model (by default, the main agent's). Aldo writes it into each
 * machine's Claude Code and Codex config. Hidden with an Aldo that doesn't
 * keep it.
 */
export function AldoSubagentsPanel() {
  const [saved, setSaved] = useState<AldoSubagents | null>(null);
  const [providers, setProviders] = useState<ReadonlyArray<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void fetchAldoSubagents()
      .then((next) => {
        if (live) setSaved(next);
      })
      .catch(() => undefined);
    void newestAldoProviders()
      .then((next) => {
        if (live) setProviders(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!saved) return null;

  const change = (kind: AldoSubagentProvider, value: AldoSubagentDefault | null) => {
    const before = saved;
    const { [kind]: _previous, ...rest } = saved;
    setSaved(value ? { ...rest, [kind]: value } : rest);
    setError(null);
    saveAldoSubagents({ [kind]: value })
      .then(setSaved)
      .catch((cause: unknown) => {
        setSaved(before);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  return (
    <SettingsSection title="Subagents">
      {SUBAGENT_AGENTS.map((agent) => (
        <SubagentRow
          key={agent.kind}
          agent={agent}
          providers={providers}
          saved={saved[agent.kind]}
          onChange={(value) => change(agent.kind, value)}
        />
      ))}
      <p className="px-4 py-3 text-muted-foreground text-xs">
        A model you ask an agent to give a subagent still wins. Changes reach new conversations
        within 10 minutes.
      </p>
      {error ? <p className="px-4 pb-3 text-destructive-foreground text-sm">{error}</p> : null}
    </SettingsSection>
  );
}
