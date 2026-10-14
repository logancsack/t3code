import { describe, expect, it } from "vite-plus/test";

import {
  aldoMoveMessage,
  aldoProjectSlug,
  buildAldoPlaces,
  draftTitle,
  filterAldoPlaces,
  generalMatches,
  generalPlace,
  namesAPlace,
  placeDetail,
  repoShortName,
  typedRepositoryRef,
} from "./places.logic";

const machines = [
  { environmentId: "aldo-general", repos: [] },
  { environmentId: "aldo-app-1", repos: ["logancsack/aldo", "logancsack/t3code"] },
  { environmentId: "aldo-app-2", repos: ["logancsack/aldo", "logancsack/t3code"] },
  { environmentId: "aldo-clips", repos: ["aldo:podcast-clips"] },
  { environmentId: "aldo-site", repos: ["logancsack/site"] },
];

const groups = [
  { name: "General", project: "general", environmentIds: ["aldo-general"] },
  { name: "aldo", project: "app", environmentIds: ["aldo-app-1", "aldo-app-2"] },
  { name: "Podcast clips", project: "clips", environmentIds: ["aldo-clips"] },
  { name: "site", project: "site", environmentIds: ["aldo-site"] },
];

describe("buildAldoPlaces", () => {
  it("makes one place per project, most recently active first, General left out", () => {
    const places = buildAldoPlaces({
      machines,
      groups,
      activity: new Map([
        ["aldo-general", "2026-10-14T12:00:00Z"],
        ["aldo-app-1", "2026-10-13T09:00:00Z"],
        ["aldo-app-2", "2026-10-14T08:00:00Z"],
        ["aldo-site", "2026-10-12T08:00:00Z"],
      ]),
      aldoProjects: [],
    });
    expect(places.map((place) => [place.name, place.activeAt, place.project])).toEqual([
      ["aldo", "2026-10-14T08:00:00Z", "app"],
      ["site", "2026-10-12T08:00:00Z", "site"],
      ["Podcast clips", null, "clips"],
    ]);
    expect(places[0]!.repos).toEqual(["logancsack/aldo", "logancsack/t3code"]);
    expect(places[0]!.detail).toBe("Repositories · aldo, t3code");
  });

  it("adds the Aldo projects with no machine yet, after the active ones", () => {
    const places = buildAldoPlaces({
      machines,
      groups,
      activity: new Map([["aldo-site", "2026-10-12T08:00:00Z"]]),
      aldoProjects: [
        { ref: "aldo:podcast-clips", name: "podcast-clips" },
        { ref: "aldo:trip-plans", name: "Trip plans" },
      ],
    });
    expect(places.map((place) => place.name)).toEqual([
      "site",
      "aldo",
      "Podcast clips",
      "Trip plans",
    ]);
    expect(places.at(-1)).toEqual({
      repos: ["aldo:trip-plans"],
      name: "Trip plans",
      detail: "Aldo project",
      activeAt: null,
      project: null,
    });
  });

  it("skips a project whose machines the directory doesn't list", () => {
    const places = buildAldoPlaces({
      machines: [],
      groups,
      activity: new Map(),
      aldoProjects: [],
    });
    expect(places).toEqual([]);
  });
});

describe("finding places", () => {
  const places = buildAldoPlaces({
    machines,
    groups,
    activity: new Map(),
    aldoProjects: [{ ref: "aldo:café-notes", name: "Café notes" }],
  });

  it("matches names and repositories, without accents or case", () => {
    expect(filterAldoPlaces(places, "T3CODE").map((place) => place.name)).toEqual(["aldo"]);
    expect(filterAldoPlaces(places, "cafe").map((place) => place.name)).toEqual(["Café notes"]);
    expect(filterAldoPlaces(places, "  ")).toBe(places);
  });

  it("finds General by its name or as no project", () => {
    expect(generalMatches("")).toBe(true);
    expect(generalMatches("gen")).toBe(true);
    expect(generalMatches("no proj")).toBe(true);
    expect(generalMatches("site")).toBe(false);
  });

  it("knows a name that's taken, so it isn't offered as a new project", () => {
    expect(namesAPlace(places, "Podcast Clips")).toBe(true);
    expect(namesAPlace(places, "logancsack/site")).toBe(true);
    expect(namesAPlace(places, "general")).toBe(true);
    expect(namesAPlace(places, "Podcast")).toBe(false);
  });
});

describe("place names", () => {
  it("shortens a repository to its name", () => {
    expect(repoShortName("logancsack/aldo")).toBe("aldo");
    expect(repoShortName("gitlab:group/sub/app.git")).toBe("app");
    expect(repoShortName("aldo:podcast-clips")).toBe("podcast-clips");
  });

  it("says what a place is", () => {
    expect(placeDetail([])).toBe("No project");
    expect(placeDetail(["aldo:podcast-clips"])).toBe("Aldo project");
    expect(placeDetail(["logancsack/site"])).toBe("Repository");
    expect(generalPlace()).toEqual({
      repos: [],
      name: "General",
      detail: "No project",
      activeAt: null,
      project: null,
    });
  });

  it("reads a typed repository or pasted URL", () => {
    expect(typedRepositoryRef(" logancsack/site.git ")).toBe("logancsack/site");
    expect(typedRepositoryRef("https://github.com/logancsack/site/")).toBe(
      "https://github.com/logancsack/site",
    );
    expect(typedRepositoryRef("gitlab:group/app")).toBe("gitlab:group/app");
    expect(typedRepositoryRef("aldo:trip-plans")).toBe("aldo:trip-plans");
    expect(typedRepositoryRef("Trip plans")).toBeNull();
  });

  it("makes an Aldo project's slug from its title", () => {
    expect(aldoProjectSlug("Podcast Clips!")).toBe("podcast-clips");
    expect(aldoProjectSlug("Café notes")).toBe("cafe-notes");
    expect(aldoProjectSlug("!!!")).toBe("project");
  });
});

describe("draftTitle", () => {
  it("is the first line typed, one line, shortened", () => {
    expect(draftTitle("")).toBeNull();
    expect(draftTitle("\n  \n")).toBeNull();
    expect(draftTitle("\n  Plan   the trip \nto Lisbon")).toBe("Plan the trip");
    const long = draftTitle("a".repeat(100));
    expect(long).toHaveLength(80);
    expect(long?.endsWith("…")).toBe(true);
  });
});

describe("aldoMoveMessage", () => {
  it("asks for a handoff to the place's repositories", () => {
    const message = aldoMoveMessage({ name: "aldo", repos: ["logancsack/aldo"] });
    expect(message).toContain(
      "Move this thread to aldo: call continue_in_new_thread with move set",
    );
    expect(message).toContain('repos ["logancsack/aldo"]');
    expect(message).toContain("a brief");
  });

  it("says General is outside any project", () => {
    expect(aldoMoveMessage({ name: "General", repos: [] })).toContain(
      "to General, outside any project: call continue_in_new_thread with move set and repos []",
    );
  });

  it("creates a new project first", () => {
    expect(aldoMoveMessage({ create: "Trip plans" })).toContain(
      'to a new Aldo project, "Trip plans": create it with create_project, then call continue_in_new_thread',
    );
  });
});
