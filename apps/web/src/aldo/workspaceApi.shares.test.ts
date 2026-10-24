import { expect, it, vi } from "vite-plus/test";

const aldo = vi.hoisted(() => ({
  list: null as unknown,
  patched: null as unknown,
  sent: [] as unknown[],
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: async (_path: string, init?: RequestInit) => {
    if (init?.method !== "PATCH") return aldo.list;
    aldo.sent.push(JSON.parse(String(init.body)));
    return aldo.patched;
  },
}));
vi.mock("./directory", () => ({ requestAldoDirectoryRefresh: () => {} }));

const { aldoShareAudienceChangeable, fetchAldoShares, setAldoShareAudience } =
  await import("./workspaceApi");

const share = {
  id: "s1",
  title: "Q4 forecast",
  url: "https://aldo.computer/s/s1",
  public: false,
  createdAt: "2026-10-23T08:00:00.000Z",
};

it("lets the user change who can open a share only where Aldo's list says they can", async () => {
  aldo.list = { shares: [share] };
  await fetchAldoShares();
  expect(aldoShareAudienceChangeable()).toBe(false);
  aldo.list = { shares: [share], audienceChangeable: true };
  await fetchAldoShares();
  expect(aldoShareAudienceChangeable()).toBe(true);
  // An older Aldo's page in place of the list says nothing either way.
  aldo.list = "<!doctype html>";
  await fetchAldoShares();
  expect(aldoShareAudienceChangeable()).toBe(true);
});

it("says how a share stands once Aldo changed who can open it, and fails when it didn't", async () => {
  aldo.patched = { ...share, public: true };
  await expect(setAldoShareAudience("s1", true)).resolves.toMatchObject({ id: "s1", public: true });
  expect(aldo.sent).toEqual([{ public: true }]);
  aldo.patched = share;
  await expect(setAldoShareAudience("s1", true)).rejects.toThrow(/didn’t change/);
});
