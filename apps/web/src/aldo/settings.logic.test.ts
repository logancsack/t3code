import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_SETTINGS_NAV,
  aldoSettingsNavActive,
  aldoSettingsRedirect,
  aldoSettingsScopeSearch,
} from "./settings.logic";

describe("aldoSettingsScopeSearch", () => {
  it("keeps a project and drops a machine or checkout", () => {
    expect(
      aldoSettingsScopeSearch({ project: "repository:aldo", machine: "m", checkout: "m:/w" }),
    ).toEqual({ project: "repository:aldo" });
  });

  it("is every thread without a project", () => {
    expect(aldoSettingsScopeSearch({ machine: "m" })).toEqual({});
    expect(aldoSettingsScopeSearch({})).toEqual({});
  });

  it("keeps the project only on a project's own pages", () => {
    const search = { project: "repository:aldo" };
    expect(aldoSettingsScopeSearch(search, "/settings/projects")).toEqual(search);
    expect(aldoSettingsScopeSearch(search, "/settings/archived/")).toEqual(search);
    expect(aldoSettingsScopeSearch(search, "/settings/agents")).toEqual({});
  });
});

describe("aldoSettingsRedirect", () => {
  const at = (pathname: string, searchStr = "", hash = "") =>
    aldoSettingsRedirect({ pathname, searchStr, hash });

  it("sends Integrations to Connections with what a sign-in sent back", () => {
    expect(at("/settings/integrations", "?integration=google&status=connected")).toBe(
      "/settings/connections?integration=google&status=connected",
    );
    expect(at("/settings/integrations", "", "aldo-integration-link")).toBe(
      "/settings/connections#aldo-integration-link",
    );
  });

  it("sends the agents' email to Agents and the phone to its own page", () => {
    expect(at("/settings/integrations", "", "aldo-agent-inbox")).toBe(
      "/settings/agents#aldo-agent-inbox",
    );
    expect(at("/settings/integrations/", "", "aldo-phone")).toBe("/settings/phone");
  });

  it("sends each old page to its new one", () => {
    expect(at("/settings/providers")).toBe("/settings/agents");
    expect(at("/settings/source-control")).toBe("/settings/connections");
    expect(at("/settings/environments", "", "aldo-environments")).toBe(
      "/settings/code#aldo-environments",
    );
    expect(at("/settings/shared")).toBe("/library");
  });

  it("leaves the pages that stayed", () => {
    expect(at("/settings/general")).toBeNull();
    expect(at("/settings/connections")).toBeNull();
  });
});

describe("ALDO_SETTINGS_NAV", () => {
  it("lists each page once", () => {
    const paths = ALDO_SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.to));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("lights Personalization on its tabs and General on the pages it opens", () => {
    const item = (label: string) =>
      ALDO_SETTINGS_NAV.flatMap((group) => group.items).find((entry) => entry.label === label)!;
    expect(aldoSettingsNavActive(item("Personalization"), "/settings/memory")).toBe(true);
    expect(aldoSettingsNavActive(item("Personalization"), "/settings/skills")).toBe(true);
    expect(aldoSettingsNavActive(item("General"), "/settings/appearance")).toBe(true);
    expect(aldoSettingsNavActive(item("General"), "/settings/agents")).toBe(false);
  });
});
