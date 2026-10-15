// In a project's settings (ProjectSettingsPanel), what links an Aldo project
// and its code (aldoLinksProjectCode): an Aldo project's repositories, each
// with Remove, and one to add; for a repository, the Aldo project it's the
// code of. Threads on either side know the other and read it when the work
// needs it, without its files joining their workspace.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { toastManager } from "../components/ui/toast";
import {
  aldoLinksProjectCode,
  getAldoEnvironments,
  listAldoProjects,
  listAldoRepositoryDirectory,
  setAldoProjectRepos,
  subscribeAldoEnvironments,
  type AldoProjectSummary,
} from "./cloud";
import {
  codeChoices,
  isAldoProjectRef,
  projectOfCode,
  withCode,
  withoutCode,
} from "./projectCode.logic";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const NONE = "none";

/** The project's code, or the project its code is of; nothing for General or on an older Aldo. */
export function AldoProjectCodeSettings(props: { readonly environmentId: string }) {
  const linking = useSyncExternalStore(
    subscribeAldoEnvironments,
    aldoLinksProjectCode,
    () => false,
  );
  const environments = useSyncExternalStore(
    subscribeAldoEnvironments,
    getAldoEnvironments,
    () => null,
  );
  const environment = environments?.find((entry) => entry.environmentId === props.environmentId);
  const ref = environment ? (environment.repos?.[0] ?? environment.repo) : "";
  const [projects, setProjects] = useState<ReadonlyArray<AldoProjectSummary> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    void listAldoProjects().then(setProjects, () => undefined);
  }, []);
  useEffect(() => {
    if (linking && ref) load();
  }, [linking, ref, load]);

  const save = useCallback(
    async (project: AldoProjectSummary, repos: ReadonlyArray<string>) => {
      setSaving(true);
      try {
        await setAldoProjectRepos(project.slug, repos);
        load();
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: `Couldn't change ${project.title}'s code`,
          description: messageOf(cause),
        });
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  if (!linking || !ref || projects === null) return null;
  if (isAldoProjectRef(ref)) {
    const project = projects.find((candidate) => candidate.ref === ref);
    return project ? (
      <ProjectCode project={project} projects={projects} saving={saving} save={save} />
    ) : null;
  }
  return <PartOf code={ref} projects={projects} saving={saving} save={save} />;
}

type Save = (project: AldoProjectSummary, repos: ReadonlyArray<string>) => Promise<void>;

function ProjectCode(props: {
  readonly project: AldoProjectSummary;
  readonly projects: ReadonlyArray<AldoProjectSummary>;
  readonly saving: boolean;
  readonly save: Save;
}) {
  const { project, projects, saving, save } = props;
  const [repositories, setRepositories] = useState<ReadonlyArray<{
    readonly nameWithOwner: string;
    readonly isArchived?: boolean;
  }> | null>(null);
  useEffect(() => {
    void listAldoRepositoryDirectory().then(
      (result) => setRepositories(result.repositories),
      () => setRepositories([]),
    );
  }, []);
  const choices = useMemo(
    () => (repositories ? codeChoices(repositories, project, projects) : []),
    [repositories, project, projects],
  );
  const code = project.repos ?? [];

  return (
    <SettingsSection title="Code">
      {code.map((ref) => (
        <SettingsRow
          key={ref}
          title={<span className="font-mono">{ref}</span>}
          description="Its threads know this project and read it when the work needs it."
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => void save(project, withoutCode(project, ref))}
              aria-label={`Remove ${ref} from ${project.title}'s code`}
            >
              Remove
            </Button>
          }
        />
      ))}
      <SettingsRow
        title={code.length === 0 ? "Repositories" : "Add a repository"}
        description={
          code.length === 0
            ? `Where ${project.title}'s code is (an app, a site). Its threads know this project, and threads here can read the code, without either one's files in the other.`
            : "Another repository with this project's code."
        }
        control={
          <Select<string>
            value={null}
            onValueChange={(value) => {
              if (value) void save(project, withCode(project, value));
            }}
          >
            <SelectTrigger
              className="h-8 w-full text-sm sm:w-64"
              disabled={saving || repositories === null}
            >
              <SelectValue>
                {repositories === null
                  ? "Loading repositories…"
                  : choices.length === 0
                    ? "No other repositories"
                    : "Choose a repository"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {choices.map((choice) => (
                <SelectItem key={choice.ref} value={choice.ref}>
                  <span className="font-mono">{choice.ref}</span>
                  {choice.partOf ? (
                    <span className="ml-2 text-muted-foreground text-xs">
                      (moves from {choice.partOf})
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}

function PartOf(props: {
  readonly code: string;
  readonly projects: ReadonlyArray<AldoProjectSummary>;
  readonly saving: boolean;
  readonly save: Save;
}) {
  const { code, projects, saving, save } = props;
  const current = projectOfCode(projects, code);
  if (projects.length === 0) return null;

  const choose = async (value: string) => {
    if (value === (current?.slug ?? NONE)) return;
    if (value === NONE) {
      if (current) await save(current, withoutCode(current, code));
      return;
    }
    const next = projects.find((project) => project.slug === value);
    // Linked to one, it leaves the other (Aldo moves it).
    if (next) await save(next, withCode(next, code));
  };

  return (
    <SettingsSection title="Aldo project">
      <SettingsRow
        title="Code of"
        description="The Aldo project this repository is the code of (a business, a product). Its threads know the project and read it for context, without its files coming into the repository."
        control={
          <Select
            value={current?.slug ?? NONE}
            onValueChange={(value) => void choose(String(value))}
          >
            <SelectTrigger className="h-8 w-full text-sm sm:w-64" disabled={saving}>
              <SelectValue>{current ? current.title : "None"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value={NONE}>None</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.slug} value={project.slug}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
