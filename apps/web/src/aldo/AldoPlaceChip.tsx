// "General ▾" in a new General draft's header: before its first message, the
// draft can move to one of the user's projects, or to a repository or a new
// project through the start dialog, with what's typed in it (newThread.ts).

import {
  CheckIcon,
  ChevronDownIcon,
  CompassIcon,
  FolderGit2Icon,
  LoaderCircleIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { readComposerThreadPrompt, type DraftId } from "../composerDraftStore";
import { openAldoRepositoryPicker } from "./AldoRepositoryPicker";
import { aldoSupportsProjects, listAldoRepositoryDirectory } from "./cloud";
import { carryAldoDraft, useStartAldoThread } from "./newThread";

/** Projects listed before "Another project or repository…". */
const MOST_PROJECTS = 8;

interface Project {
  readonly ref: string;
  readonly name: string;
}

export function AldoPlaceChip(props: { readonly draftId: DraftId }) {
  const { start, starting } = useStartAldoThread();
  const [projects, setProjects] = useState<ReadonlyArray<Project> | null>(null);
  const load = () => {
    if (projects !== null || !aldoSupportsProjects()) return;
    void listAldoRepositoryDirectory()
      .then(({ repositories }) =>
        setProjects(
          repositories
            .filter((repo) => repo.nameWithOwner.startsWith("aldo:") && !repo.isArchived)
            .slice(0, MOST_PROJECTS)
            .map((repo) => ({ ref: repo.nameWithOwner, name: repo.name })),
        ),
      )
      .catch(() => setProjects([]));
  };
  const carry = () => ({ from: props.draftId, prompt: readComposerThreadPrompt(props.draftId) });
  const viaDialog = (mode: "existing" | "new") => {
    const words = carry();
    carryAldoDraft(words.from, words.prompt);
    openAldoRepositoryPicker(mode);
  };
  return (
    <Menu onOpenChange={(open) => open && load()}>
      <MenuTrigger
        aria-label="Where this thread works: General"
        className="inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
      >
        {starting ? (
          <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <CompassIcon className="size-3.5 shrink-0" />
        )}
        <span className="truncate">General</span>
        <ChevronDownIcon className="size-3.5 shrink-0" />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-60">
        <MenuGroup>
          <MenuGroupLabel>Start it in</MenuGroupLabel>
          <MenuItem disabled>
            <CompassIcon className="size-4" /> General
            <CheckIcon className="ms-auto size-4" />
          </MenuItem>
          {projects === null && aldoSupportsProjects() ? (
            <MenuItem disabled>
              <LoaderCircleIcon className="size-4 animate-spin" /> Your projects…
            </MenuItem>
          ) : null}
          {(projects ?? []).map((project) => (
            <MenuItem
              key={project.ref}
              disabled={starting}
              onClick={() => void start([project.ref], carry())}
            >
              <SparklesIcon className="size-4" />
              <span className="truncate">{project.name}</span>
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem disabled={starting} onClick={() => viaDialog("existing")}>
          <FolderGit2Icon className="size-4" />
          {aldoSupportsProjects() ? "Another project or repository…" : "A repository…"}
        </MenuItem>
        {aldoSupportsProjects() ? (
          <MenuItem disabled={starting} onClick={() => viaDialog("new")}>
            <SparklesIcon className="size-4" /> New project…
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
