import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { buildHubBlankProjectSourceItem, hubAddProjectFlowCopy } from "./hubCommandPalette";

describe("hub add-repository palette", () => {
  it("offers a blank project in place of a local folder", async () => {
    const run = vi.fn();
    const item = buildHubBlankProjectSourceItem(EnvironmentId.make("environment-hub"), run);
    expect(item).toMatchObject({
      kind: "action",
      value: "action:add-project:environment-hub:blank",
      title: "Blank project",
      keepOpen: true,
    });
    await item.run();
    expect(run).toHaveBeenCalledOnce();
  });

  it("asks for a name, not a destination, when creating a blank project", () => {
    expect(hubAddProjectFlowCopy({ source: "url", blankProject: true })).toEqual({
      placeholder: "Name your project",
      buttonLabel: "Create",
      emptyStateMessage: "Name the project and press Enter to create it.",
    });
  });

  it("adds repositories instead of cloning them", () => {
    expect(hubAddProjectFlowCopy({ source: "url" })).toMatchObject({
      placeholder: "Enter Git repository URL",
      buttonLabel: "Add",
    });
    // Provider sources keep their own placeholder ("owner/repo" hints).
    expect(hubAddProjectFlowCopy({ source: "github" })).toMatchObject({
      placeholder: null,
      buttonLabel: "Add",
    });
  });
});
