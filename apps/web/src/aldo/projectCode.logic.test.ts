import { describe, expect, it } from "vite-plus/test";

import type { AldoProjectSummary } from "./cloud";
import {
  codeChoices,
  isAldoProjectRef,
  projectOfCode,
  withCode,
  withoutCode,
  withSaved,
} from "./projectCode.logic";

const project = (slug: string, repos?: string[]): AldoProjectSummary => ({
  ref: `aldo:${slug}`,
  slug,
  title: slug.toUpperCase(),
  description: "",
  ...(repos ? { repos } : {}),
});

const bakery = project("bakery", ["acme/bakery-app", "acme/bakery-site"]);
const clips = project("clips", []);
const older = project("older");

describe("project code", () => {
  it("tells an Aldo project from code", () => {
    expect(isAldoProjectRef("aldo:bakery")).toBe(true);
    expect(isAldoProjectRef("acme/bakery-app")).toBe(false);
    expect(isAldoProjectRef("gitlab:group/app")).toBe(false);
  });

  it("finds the project code is the code of", () => {
    expect(projectOfCode([clips, bakery], "acme/bakery-site")?.slug).toBe("bakery");
    expect(projectOfCode([clips, bakery, older], "acme/other")).toBeNull();
  });

  it("links and unlinks without repeating a repository", () => {
    expect(withCode(bakery, "acme/bakery-api")).toEqual([
      "acme/bakery-app",
      "acme/bakery-site",
      "acme/bakery-api",
    ]);
    expect(withCode(bakery, "acme/bakery-app")).toEqual(["acme/bakery-app", "acme/bakery-site"]);
    expect(withCode(older, "acme/x")).toEqual(["acme/x"]);
    expect(withoutCode(bakery, "acme/bakery-app")).toEqual(["acme/bakery-site"]);
    expect(withoutCode(older, "acme/x")).toEqual([]);
  });

  it("takes what Aldo saved at once, moving a repository from the project that had it", () => {
    const saved = project("clips", ["acme/bakery-site"]);
    expect(withSaved([bakery, clips, older], saved)).toEqual([
      { ...bakery, repos: ["acme/bakery-app"] },
      saved,
      older,
    ]);
  });

  it("offers code that isn't the project's own yet, saying whose it is", () => {
    const repositories = [
      { nameWithOwner: "acme/bakery-app" },
      { nameWithOwner: "acme/old", isArchived: true },
      { nameWithOwner: "aldo:clips" },
      { nameWithOwner: "acme/tools" },
      { nameWithOwner: "acme/bakery-site" },
    ];
    expect(codeChoices(repositories, clips, [bakery, clips])).toEqual([
      { ref: "acme/bakery-app", partOf: "BAKERY" },
      { ref: "acme/tools", partOf: null },
      { ref: "acme/bakery-site", partOf: "BAKERY" },
    ]);
    expect(codeChoices(repositories, bakery, [bakery, clips]).map((c) => c.ref)).toEqual([
      "acme/tools",
    ]);
  });
});
