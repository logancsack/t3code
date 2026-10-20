import { describe, expect, it } from "vite-plus/test";

import { aldoThreadLibrary, type AldoShareView } from "./library.logic";
import { aldoTurnMade } from "./made.logic";

const zip: AldoShareView = {
  id: "abc",
  title: "Renders",
  url: "https://aldo.computer/s/abc",
  contentType: "application/zip",
  bytes: 1024,
  public: true,
  views: 0,
  createdAt: "2026-10-20T08:00:00.000Z",
  environmentId: "env-1",
};

describe("a zip it shared", () => {
  it("is a Zip by its path, or by its title where the provider recorded only the reply", () => {
    const made = (path: string | null, title: string) =>
      aldoTurnMade({
        files: [],
        shares: [{ path, title, url: null }],
        workspaceRoot: "/vercel/work/general",
      }).items[0]?.kind;
    expect(made("/vercel/work/general/renders.zip", "Renders")).toBe("archive");
    expect(made(null, "renders.zip")).toBe("archive");
    expect(made(null, "Launch plan")).toBe("page");
  });

  it("is a Zip in the thread's library by its share's type", () => {
    const library = aldoThreadLibrary({
      turns: [{ turnId: "turn-1", completedAt: "2026-10-20T08:01:00.000Z", files: [] }],
      sharesByTurn: new Map([["turn-1", [{ path: null, title: "Renders", url: zip.url }]]]),
      workspaceRoot: "/vercel/work/general",
      shares: [zip],
      environmentId: "env-1",
    });
    expect(library.items.map((item) => [item.name, item.kind])).toEqual([["Renders", "archive"]]);
  });
});
