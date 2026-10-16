import { describe, expect, it } from "vite-plus/test";

import { aldoSettingsScopeSearch } from "./settings.logic";

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
