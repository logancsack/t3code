import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const mode = vi.hoisted(() => ({ cloud: true }));
vi.mock("~/aldo/cloud", () => ({
  get isAldoCloud() {
    return mode.cloud;
  },
}));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        environmentId: "env-1",
        connection: { phase: "connected" },
        serverConfig: { scratchWorkspaceRoot: "/home/user/.t3/scratch" },
      },
    ],
  }),
}));
vi.mock("~/state/projects", () => ({ projectEnvironment: { ensureScratch: {} } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("~/state/entities", () => ({ waitForProject: vi.fn() }));
vi.mock("~/components/ui/toast", () => ({ stackedThreadToast: vi.fn(), toastManager: {} }));
vi.mock("./useHandleNewThread", () => ({ useNewThreadHandler: () => vi.fn() }));

import { useScratchProject } from "./useScratchProject";

const environmentId = EnvironmentId.make("env-1");

type ScratchProject = ReturnType<typeof useScratchProject>;

function Probe(props: { readonly onRender: (scratch: ScratchProject) => void }) {
  props.onRender(useScratchProject());
  return null;
}

function scratchProject(): ScratchProject {
  const rendered: ScratchProject[] = [];
  renderToStaticMarkup(<Probe onRender={(scratch) => rendered.push(scratch)} />);
  return rendered[0]!;
}

describe("useScratchProject in Aldo", () => {
  it("offers no scratch project, so no thread lands on another thread's machine", () => {
    mode.cloud = true;
    const scratch = scratchProject();
    expect(scratch.scratchEnvironmentId(environmentId)).toBeNull();
    expect(scratch.scratchEnvironmentId(null)).toBeNull();
  });

  it("still names the folder, so a scratch project made before stays out of the project lists", () => {
    mode.cloud = true;
    expect(scratchProject().scratchWorkspaceRootFor(environmentId)).toBe("/home/user/.t3/scratch");
  });

  it("offers the machine's scratch project outside Aldo", () => {
    mode.cloud = false;
    const scratch = scratchProject();
    expect(scratch.scratchWorkspaceRootFor(environmentId)).toBe("/home/user/.t3/scratch");
    expect(scratch.scratchEnvironmentId(environmentId)).toBe(environmentId);
    expect(scratch.scratchEnvironmentId(null)).toBe(environmentId);
  });
});
