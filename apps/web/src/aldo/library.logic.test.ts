import { describe, expect, it } from "vite-plus/test";

import {
  aldoLibraryGroups,
  aldoShareItem,
  aldoShareUpdated,
  aldoShareViewable,
  parseAldoShares,
} from "./library.logic";

const listed = {
  id: "abc",
  title: "Morning dashboard",
  url: "https://aldo.example/s/abc",
  contentType: "text/html",
  bytes: 120,
  public: false,
  views: 2,
  createdAt: "2026-10-20T07:00:00.000Z",
};

describe("parseAldoShares", () => {
  it("reads a page that stays current, and whether it's pinned", () => {
    const [share] = parseAldoShares([
      { ...listed, live: true, updatedAt: "2026-10-22T07:42:00.000Z", pinned: true },
    ])!;
    expect(share).toMatchObject({
      live: true,
      updatedAt: "2026-10-22T07:42:00.000Z",
      pinned: true,
    });
  });

  it("leaves out what an older Aldo doesn't say, so nothing offers to pin", () => {
    const [share] = parseAldoShares([{ ...listed, updatedAt: null }])!;
    expect(share).not.toHaveProperty("live");
    expect(share).not.toHaveProperty("updatedAt");
    expect(share).not.toHaveProperty("pinned");
  });
});

describe("aldoShareUpdated", () => {
  const now = new Date(2026, 9, 22, 12, 0);
  it("says when it last changed, closer is more exact", () => {
    expect(aldoShareUpdated({}, now)).toBeNull();
    expect(aldoShareUpdated({ updatedAt: "not a time" }, now)).toBeNull();
    const today = new Date(2026, 9, 22, 7, 42).toISOString();
    expect(aldoShareUpdated({ updatedAt: today }, now)).toMatch(/^Updated 7:42/);
    const yesterday = new Date(2026, 9, 21, 23, 0).toISOString();
    expect(aldoShareUpdated({ updatedAt: yesterday }, now)).toBe("Updated yesterday");
    const monday = new Date(2026, 9, 19, 9, 0);
    expect(aldoShareUpdated({ updatedAt: monday.toISOString() }, now)).toBe(
      `Updated ${monday.toLocaleDateString([], { weekday: "long" })}`,
    );
    const earlier = new Date(2026, 9, 3, 9, 0);
    expect(aldoShareUpdated({ updatedAt: earlier.toISOString() }, now)).toBe(
      `Updated ${earlier.toLocaleDateString([], { month: "short", day: "numeric" })}`,
    );
  });
});

describe("aldoShareViewable", () => {
  it("opens in Aldo what its link shows, and leaves the rest to download", () => {
    for (const type of [
      "text/html",
      "text/markdown",
      "application/pdf",
      "image/png",
      "video/mp4",
      "audio/mpeg",
      "text/csv; charset=utf-8",
    ]) {
      expect(aldoShareViewable(type)).toBe(true);
    }
    for (const type of [
      "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "",
    ]) {
      expect(aldoShareViewable(type)).toBe(false);
    }
  });
});

describe("the Library's order", () => {
  it("puts what's pinned first, then by when, a page by when it was last updated", () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const shares = parseAldoShares([
      { ...listed, id: "old", title: "Old", createdAt: "2026-09-01T00:00:00.000Z", pinned: true },
      {
        ...listed,
        id: "live",
        title: "Live",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-10-22T11:00:00.000Z",
        pinned: false,
      },
      { ...listed, id: "new", title: "New", createdAt: "2026-10-22T10:00:00.000Z", pinned: false },
    ])!;
    const items = shares.map(aldoShareItem);
    expect(items.find((item) => item.key === "share:live")?.at).toBe("2026-10-22T11:00:00.000Z");
    const groups = aldoLibraryGroups(
      items,
      (item) => item.at,
      now,
      (item) => item.share?.pinned === true,
    );
    expect(groups.map((group) => [group.label, group.items.map((item) => item.name)])).toEqual([
      ["Pinned", ["Old"]],
      ["Today", ["Live", "New"]],
    ]);
  });
});
