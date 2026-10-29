import { describe, expect, it } from "vite-plus/test";
import { breadcrumbProjectName, breadcrumbProjectThreads } from "./breadcrumbs.logic";
import type { AldoHomeConversation } from "./homeApi";

describe("breadcrumb projects", () => {
  it("shows the primary project rather than enumerating repositories", () => {
    expect(breadcrumbProjectName("aldo + t3code", ["logan/aldo", "logan/t3code"])).toBe("Aldo");
    expect(breadcrumbProjectName("aldo", ["logan/aldo"])).toBe("Aldo");
    expect(breadcrumbProjectName("", ["gitlab:team/Portal"])).toBe("Portal");
  });
  it("preserves a saved project name, including names containing a plus sign", () => {
    expect(breadcrumbProjectName("Research + development", ["logan/app", "logan/lib"])).toBe(
      "Research + development",
    );
    expect(breadcrumbProjectName("Quarterly planning", ["aldo:quarterly-planning"])).toBe(
      "Quarterly planning",
    );
  });
  it("lists the project's threads across companion repository changes without matching a companion's own project", () => {
    const make = (ref: string, repos: string[]) =>
      ({
        ref,
        repos,
        thread: { environmentId: ref, threadId: ref },
        title: ref,
        branch: "main",
        state: "done",
        machine: "asleep",
        at: "2026-10-29T00:00:00.000Z",
      }) satisfies AldoHomeConversation;
    const own = make("own", ["logan/aldo", "logan/t3code"]);
    const sibling = make("sibling", ["logan/aldo"]);
    const companion = make("other", ["logan/t3code", "logan/aldo"]);
    const general = make("general", []);
    expect(breadcrumbProjectThreads([own, sibling, companion, general], "logan/aldo")).toEqual([
      own,
      sibling,
    ]);
    expect(breadcrumbProjectThreads([own, general], "aldo:planning")).toEqual([]);
  });
});
