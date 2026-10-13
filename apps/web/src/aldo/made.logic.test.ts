import { describe, expect, it } from "vite-plus/test";

import { aldoMadeKind, aldoTurnMade } from "./made.logic";

const file = (path: string, additions = 0, deletions = 0) => ({ path, additions, deletions });

describe("aldoMadeKind", () => {
  it("knows the kinds of things people use", () => {
    expect(aldoMadeKind("out/Budget.xlsx")).toBe("sheet");
    expect(aldoMadeKind("Report.DOCX")).toBe("document");
    expect(aldoMadeKind("deck.pptx")).toBe("deck");
    expect(aldoMadeKind("trip/plan.html")).toBe("page");
    expect(aldoMadeKind("build.py")).toBeNull();
    expect(aldoMadeKind(".env")).toBeNull();
  });
});

describe("aldoTurnMade", () => {
  it("puts shares first, then what it made, and counts the rest", () => {
    const made = aldoTurnMade({
      files: [
        file("trip/plan.html", 120),
        file("Budget.xlsx"),
        file("build_deck.py", 40),
        file(".aldo/state.json", 3),
        file("node_modules/x/readme.md", 3),
        file("README.md", 2),
        file("old.md", 0, 12),
      ],
      shares: [
        {
          path: "/vercel/work/general/trip/plan.html",
          title: "Lisbon in May",
          url: "https://aldo.example/s/abc",
        },
      ],
      workspaceRoot: "/vercel/work/general",
    });
    expect(made.items).toEqual([
      {
        path: "trip/plan.html",
        name: "plan.html",
        kind: "page",
        sharedAs: "Lisbon in May",
        url: "https://aldo.example/s/abc",
      },
      { path: "Budget.xlsx", name: "Budget.xlsx", kind: "sheet" },
    ]);
    expect(made.others).toBe(5);
  });

  it("keeps a share from outside the folder, without opening it", () => {
    const made = aldoTurnMade({
      files: [],
      shares: [{ path: "/tmp/chart.png", title: null, url: null }],
      workspaceRoot: "/vercel/work/general",
    });
    expect(made.items).toEqual([{ path: null, name: "chart.png", kind: "image" }]);
  });
});
