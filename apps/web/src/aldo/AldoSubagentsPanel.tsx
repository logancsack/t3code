import type { ClientSettings } from "@t3tools/contracts";
import { NetworkIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
import {
  fetchAldoSubagents,
  saveAldoSubagents,
  type AldoSubagentDefault,
  type AldoSubagentProvider,
  type AldoSubagents,
} from "./cloud";
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
      title={agent.title}
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
              aria-label={`${agent.title} subagents' model`}
            >
              <SelectValue>{model ? model.name : "Same as the main agent"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value={SAME_AS_MAIN}>Same as the main agent</SelectItem>
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
                aria-label={`${agent.title} subagents' reasoning`}
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
 * Settings → Agents: what each agent's subagents run on when it doesn't
 * pick a model (by default, the main agent's). Aldo writes it into each
 * machine's Claude Code and Codex config. Hidden with an Aldo that doesn't
 * keep it.
 */
export function AldoSubagentsPanel() {
  const [saved, setSaved] = useState<AldoSubagents | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ReadonlyArray<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const hidden = useClientSettings(hiddenModels);
  // What Aldo last said it keeps, to go back to if the newest change fails.
  const confirmed = useRef<AldoSubagents>({});
  // Changes go to Aldo one at a time, in the order they were made; only the newest one's answer shows.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const newest = useRef(0);

  const load = useCallback(() => {
    fetchAldoSubagents().then(
      (next) => {
        if (next) confirmed.current = next;
        setSaved(next);
        setLoadError(null);
      },
      (cause: unknown) => setLoadError(message(cause)),
    );
  }, []);
  useEffect(load, [load]);

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
    return (
      <SettingsSection
        id="aldo-subagents"
        title="Subagents"
        icon={<NetworkIcon className="size-4" />}
      >
        <SettingsRow
          title="Couldn't load what subagents run on"
          description={loadError}
          control={
            <Button size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  const change = (kind: AldoSubagentProvider, value: AldoSubagentDefault | null) => {
    setSaved((current) => withSubagentDefault(current ?? {}, kind, value));
    setError(null);
    const turn = ++newest.current;
    queue.current = queue.current.then(() =>
      saveAldoSubagents({ [kind]: value }).then(
        (next) => {
          confirmed.current = next;
          if (turn === newest.current) setSaved(next);
        },
        (cause: unknown) => {
          setError(message(cause));
          // A later change's answer says what Aldo keeps; the newest one failing goes back to the last it said.
          if (turn === newest.current) setSaved(confirmed.current);
        },
      ),
    );
  };

  return (
    <SettingsSection
      id="aldo-subagents"
      title="Subagents"
      icon={<NetworkIcon className="size-4" />}
    >
      {SUBAGENT_AGENTS.map((agent) => (
        <SubagentRow
          key={agent.kind}
          agent={agent}
          providers={providers}
          hidden={hidden}
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
