import { describe, expect, it } from "vite-plus/test";

import {
  aldoLibraryGroups,
  aldoLibraryWhen,
  aldoShareAudience,
  aldoShareIdOf,
  aldoShareKind,
  aldoShareProject,
  aldoShareViews,
  aldoThreadLibrary,
  parseAldoShares,
  type AldoShareView,
} from "./library.logic";

// Tuesday October 13, 2026, 3pm local time.
const NOW = new Date(2026, 9, 13, 15, 0);
const local = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

const share = (overrides: Partial<AldoShareView> & Pick<AldoShareView, "id">): AldoShareView => ({
  title: "Shared file",
  url: `https://aldo.example/s/${overrides.id}`,
  contentType: "text/html",
  bytes: 1200,
  public: true,
  views: 0,
  createdAt: local(13, 10),
  ...overrides,
});

const file = (path: string, additions = 10, deletions = 0) => ({ path, additions, deletions });

describe("parseAldoShares", () => {
  it("keeps what it recognizes, and says when there's no list", () => {
    expect(parseAldoShares(undefined)).toBeNull();
    expect(parseAldoShares("<html>")).toBeNull();
    expect(
      parseAldoShares([
        {
          id: "a",
          title: "Lisbon in May",
          url: "https://aldo.example/s/a",
          contentType: "text/html",
          bytes: 10,
          public: false,
          views: 2,
          createdAt: "2026-10-13T10:00:00.000Z",
          environmentId: "env-1",
          repos: ["aldo:lisbon-trip", 4],
        },
        { id: "b", url: "https://aldo.example/s/b", createdAt: "2026-10-12T10:00:00.000Z" },
        { title: "no id" },
        null,
      ]),
    ).toEqual([
      {
        id: "a",
        title: "Lisbon in May",
        url: "https://aldo.example/s/a",
        contentType: "text/html",
        bytes: 10,
        public: false,
        views: 2,
        createdAt: "2026-10-13T10:00:00.000Z",
        environmentId: "env-1",
        repos: ["aldo:lisbon-trip"],
      },
      {
        id: "b",
        title: "Shared file",
        url: "https://aldo.example/s/b",
        contentType: "",
        bytes: 0,
        public: true,
        views: 0,
        createdAt: "2026-10-12T10:00:00.000Z",
      },
    ]);
  });
});

describe("aldoLibraryWhen", () => {
  it("is today since midnight, this week for the six days before, older before that", () => {
    expect(aldoLibraryWhen(local(13, 0), NOW)).toBe("today");
    expect(aldoLibraryWhen(local(13, 14), NOW)).toBe("today");
    expect(aldoLibraryWhen(local(12, 23), NOW)).toBe("week");
    expect(aldoLibraryWhen(local(7, 0), NOW)).toBe("week");
    expect(aldoLibraryWhen(local(6, 23), NOW)).toBe("older");
    expect(aldoLibraryWhen("not a date", NOW)).toBe("older");
  });
});

describe("aldoLibraryGroups", () => {
  it("puts things newest first, in the groups that have any", () => {
    const groups = aldoLibraryGroups(
      [
        { name: "old", at: local(1) },
        { name: "morning", at: local(13, 9) },
        { name: "afternoon", at: local(13, 14) },
        { name: "older still", at: local(2) },
      ],
      (item) => item.at,
      NOW,
    );
    expect(groups.map((group) => [group.label, group.items.map((item) => item.name)])).toEqual([
      ["Today", ["afternoon", "morning"]],
      ["Older", ["older still", "old"]],
    ]);
  });
});

describe("labels", () => {
  it("knows a share's kind by its type", () => {
    expect(aldoShareKind("text/html; charset=utf-8")).toBe("page");
    expect(aldoShareKind("application/pdf")).toBe("pdf");
    expect(aldoShareKind("image/svg+xml")).toBe("image");
    expect(aldoShareKind("video/mp4")).toBe("video");
    expect(aldoShareKind("audio/mpeg")).toBe("audio");
    expect(aldoShareKind("text/csv")).toBe("sheet");
    expect(
      aldoShareKind("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ).toBe("deck");
    expect(aldoShareKind("text/markdown")).toBe("document");
    expect(aldoShareKind("application/zip")).toBeNull();
    expect(aldoShareKind("")).toBeNull();
  });

  it("says who can open it", () => {
    expect(aldoShareAudience({ public: true }).label).toBe("Public link");
    expect(aldoShareAudience({ public: false }).label).toBe("Only you");
  });

  it("counts the times it was opened", () => {
    expect(aldoShareViews(0)).toBeNull();
    expect(aldoShareViews(1)).toBe("Opened once");
    expect(aldoShareViews(12)).toBe("Opened 12 times");
  });

  it("names where it came from", () => {
    expect(aldoShareProject(undefined)).toBeNull();
    expect(aldoShareProject([])).toEqual({ key: "", label: "General" });
    expect(aldoShareProject(["aldo:lisbon-trip"])).toEqual({
      key: "aldo:lisbon-trip",
      label: "Lisbon trip",
    });
    expect(aldoShareProject(["acme/web", "acme/api"])).toEqual({ key: "acme/web", label: "web" });
    expect(aldoShareProject(["gitlab:group/sub/tool"])).toEqual({
      key: "gitlab:group/sub/tool",
      label: "tool",
    });
  });

  it("finds a share's id in its link", () => {
    expect(aldoShareIdOf("https://aldo.example/s/abc_123")).toBe("abc_123");
    expect(aldoShareIdOf("https://preview.aldo.example/s/abc/")).toBe("abc");
    expect(aldoShareIdOf("https://aldo.example/settings")).toBeNull();
    expect(aldoShareIdOf("not a link")).toBeNull();
  });
});

describe("aldoThreadLibrary", () => {
  const root = "/vercel/work/general";
  const turns = [
    {
      turnId: "t1",
      completedAt: local(10),
      files: [file("Budget.xlsx"), file("build.py")],
    },
    {
      turnId: "t2",
      completedAt: local(13, 11),
      files: [file("trip/plan.html"), file("Budget.xlsx", 2, 1)],
    },
  ];
  const sharesByTurn = new Map([
    [
      "t2",
      [
        {
          path: `${root}/trip/plan.html`,
          title: "Lisbon in May",
          url: "https://aldo.example/s/plan",
        },
      ],
    ],
  ]);

  it("lists each file once, at its latest turn, with its share", () => {
    const { items, elsewhere } = aldoThreadLibrary({
      turns,
      sharesByTurn,
      workspaceRoot: root,
      shares: [
        share({ id: "plan", title: "Lisbon in May", environmentId: "env-1" }),
        share({ id: "chart", title: "Chart", contentType: "image/png", environmentId: "env-1" }),
        share({ id: "theirs", environmentId: "env-2" }),
      ],
      environmentId: "env-1",
    });
    expect(elsewhere).toEqual([]);
    expect(
      items.map((item) => [item.key, item.name, item.fileName, item.kind, item.at, item.share?.id]),
    ).toEqual([
      ["trip/plan.html", "Lisbon in May", "plan.html", "page", local(13, 11), "plan"],
      ["Budget.xlsx", "Budget.xlsx", null, "sheet", local(13, 11), undefined],
      ["share:chart", "Chart", null, "image", local(13, 10), "chart"],
    ]);
  });

  it("shows a file whose share was stopped as made, and drops one that isn't here", () => {
    const { items } = aldoThreadLibrary({
      turns: [{ turnId: "t1", completedAt: local(13), files: [file("plan.html")] }],
      sharesByTurn: new Map([
        [
          "t1",
          [
            { path: `${root}/plan.html`, title: "Plan", url: "https://aldo.example/s/gone" },
            { path: "/tmp/chart.png", title: "Chart", url: "https://aldo.example/s/gone-too" },
          ],
        ],
      ]),
      workspaceRoot: root,
      shares: [],
      environmentId: "env-1",
    });
    expect(items).toEqual([
      {
        key: "plan.html",
        name: "plan.html",
        fileName: null,
        kind: "page",
        path: "plan.html",
        at: local(13),
        shared: false,
        share: null,
        url: null,
      },
    ]);
  });

  it("finds a share its step didn't record the link of by its title, during the turn", () => {
    const { items } = aldoThreadLibrary({
      turns: [{ turnId: "t1", completedAt: local(13, 11), files: [] }],
      sharesByTurn: new Map([["t1", [{ path: `${root}/plan.html`, title: "Plan", url: null }]]]),
      workspaceRoot: root,
      shares: [
        share({ id: "earlier", title: "Plan", createdAt: local(9) }),
        share({ id: "plan", title: "Plan", createdAt: local(13, 10) }),
      ],
      environmentId: "env-1",
    });
    expect(items.map((item) => [item.key, item.share?.id])).toEqual([["plan.html", "plan"]]);
  });

  it("keeps the link the agent recorded when Aldo's list can't be read", () => {
    const { items, elsewhere } = aldoThreadLibrary({
      turns,
      sharesByTurn,
      workspaceRoot: root,
      shares: null,
      environmentId: "env-1",
    });
    expect(elsewhere).toEqual([]);
    expect(items[0]).toMatchObject({
      key: "trip/plan.html",
      name: "Lisbon in May",
      shared: true,
      share: null,
      url: "https://aldo.example/s/plan",
    });
  });

  it("sets apart what an Aldo that doesn't say where shares came from lists", () => {
    const { items, elsewhere } = aldoThreadLibrary({
      turns,
      sharesByTurn,
      workspaceRoot: root,
      shares: [share({ id: "plan", title: "Lisbon in May" }), share({ id: "other" })],
      environmentId: "env-1",
    });
    expect(items[0]?.share?.id).toBe("plan");
    expect(elsewhere.map((entry) => entry.id)).toEqual(["other"]);
  });
});
