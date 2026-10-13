import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { RightPanelTabs } from "../components/RightPanelTabs";
import type { WorkLogEntry } from "../session-logic";
import type { TurnDiffSummary } from "../types";
import { AldoLibraryPanel } from "./AldoLibrary";

const threadRef = {
  environmentId: "aldo-abc" as EnvironmentId,
  threadId: "t3-thread" as ThreadId,
};

const checkpoint = (turnId: string, completedAt: string, paths: string[]) =>
  ({
    turnId,
    checkpointTurnCount: 1,
    checkpointRef: "ref",
    status: "ready",
    files: paths.map((path) => ({ path, kind: "added", additions: 10, deletions: 0 })),
    assistantMessageId: null,
    completedAt,
  }) as unknown as TurnDiffSummary;

const shareStep = {
  id: "w1",
  createdAt: new Date().toISOString(),
  turnId: "t2",
  label: "MCP tool call",
  tone: "tool",
  itemType: "mcp_tool_call",
  detail:
    'mcp__aldo__share_file: {"path":"/vercel/work/general/plan.html","title":"Lisbon in May"}',
} as unknown as WorkLogEntry;

describe("AldoLibraryPanel", () => {
  it("lists what the thread made, newest first, before Aldo's list arrives", () => {
    const markup = renderToStaticMarkup(
      <AldoLibraryPanel
        threadRef={threadRef}
        checkpoints={[
          checkpoint("t1", "2020-01-02T10:00:00.000Z", ["Budget.xlsx", "build.py"]),
          checkpoint("t2", new Date().toISOString(), ["plan.html"]),
        ]}
        workLogEntries={[shareStep]}
        workspaceRoot="/vercel/work/general"
      />,
    );
    expect(markup).toContain(">Today<");
    expect(markup).toContain(">Older<");
    expect(markup.indexOf("Lisbon in May")).toBeLessThan(markup.indexOf("Budget.xlsx"));
    expect(markup).toContain("Open Budget.xlsx");
    expect(markup).not.toContain("build.py");
    // An unshared file can be shared by asking the agent.
    expect(markup).toContain("Ask the agent to share Budget.xlsx by link");
    // One the agent shared isn't offered again, even before Aldo says how.
    expect(markup).not.toContain("Ask the agent to share Lisbon in May");
  });

  it("waits for Aldo's list before saying there's nothing", () => {
    const markup = renderToStaticMarkup(
      <AldoLibraryPanel
        threadRef={threadRef}
        checkpoints={[checkpoint("t1", new Date().toISOString(), ["build.py"])]}
        workLogEntries={[]}
        workspaceRoot="/vercel/work/general"
      />,
    );
    // Aldo's list is still on its way: a spinner, not "Nothing yet".
    expect(markup).not.toContain("Nothing yet");
  });
});

describe("the right panel's Library", () => {
  const launcher = (onAddLibrary: (() => void) | undefined) =>
    renderToStaticMarkup(
      <RightPanelTabs
        mode="inline"
        surfaces={[]}
        activeSurfaceId={null}
        pendingSurfaceIds={new Set()}
        previewSessions={{}}
        desktopByTabId={{}}
        terminalLabelsById={new Map()}
        onActivate={() => {}}
        onCloseSurface={() => {}}
        onCloseOtherSurfaces={() => {}}
        onCloseSurfacesToRight={() => {}}
        onCloseAllSurfaces={() => {}}
        onCopyFilePath={() => {}}
        onAddBrowser={() => {}}
        onAddTerminal={() => {}}
        onAddDiff={() => {}}
        onAddFiles={() => {}}
        onAddPullRequest={() => {}}
        onAddAgents={() => {}}
        onAddLibrary={onAddLibrary}
        browserAvailable={false}
        terminalAvailable
        diffAvailable
        filesAvailable
        pullRequestAvailable={false}
        offersPullRequests={onAddLibrary === undefined}
        agentsAvailable
        liveAgentCount={0}
      >
        {null}
      </RightPanelTabs>,
    );

  it("is offered first, by its letter, to a thread that isn't code", () => {
    const markup = launcher(() => {});
    expect(markup).toContain("What the agent made and shared, by day.");
    expect(markup.indexOf(">Library<")).toBeLessThan(markup.indexOf(">More<"));
    expect(markup).toMatch(/data-surface-launcher-keys="[^"]*L/);
  });

  it("isn't there for a repository thread", () => {
    expect(launcher(undefined)).not.toContain(">Library<");
  });
});
