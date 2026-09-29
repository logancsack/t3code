import { describe, expect, it } from "vite-plus/test";

import { aldoShellCandidates, planAldoShellSync, type AldoShellEntry } from "./shells.logic";

const machine = (
  environmentId: string,
  shellSequence: number | null | undefined,
  state: AldoShellEntry["state"] = "stopped",
): AldoShellEntry =>
  shellSequence === undefined ? { environmentId, state } : { environmentId, state, shellSequence };

const none = { known: new Map<string, number>(), offerChecked: new Set<string>() };
const notLive = () => false;

describe("aldoShellCandidates", () => {
  it("reads every machine Aldo has a shell for the first time", () => {
    const environments = [machine("aldo-a", 5), machine("aldo-b", 0)];
    expect(aldoShellCandidates(environments, { ...none, isLive: notLive })).toEqual(environments);
  });

  it("reads again only once Aldo's shell is newer than the cache was", () => {
    const known = new Map([
      ["aldo-a", 5],
      ["aldo-b", 3],
    ]);
    const candidates = aldoShellCandidates([machine("aldo-a", 5), machine("aldo-b", 9)], {
      ...none,
      known,
      isLive: notLive,
    });
    expect(candidates.map((entry) => entry.environmentId)).toEqual(["aldo-b"]);
  });

  it("leaves out connected machines, machines not created yet, and an older Aldo's directory", () => {
    const candidates = aldoShellCandidates(
      [machine("aldo-live", 5), machine("aldo-new", 5, "new"), machine("aldo-old", undefined)],
      { ...none, isLive: (id) => id === "aldo-live" },
    );
    expect(candidates).toEqual([]);
  });

  it("looks for a copy to offer once per machine Aldo has no shell for", () => {
    const environments = [machine("aldo-a", null), machine("aldo-b", null)];
    const candidates = aldoShellCandidates(environments, {
      ...none,
      offerChecked: new Set(["aldo-a"]),
      isLive: notLive,
    });
    expect(candidates.map((entry) => entry.environmentId)).toEqual(["aldo-b"]);
  });
});

describe("planAldoShellSync", () => {
  it("downloads the shells newer than the cache, or missing from it", () => {
    const cached = new Map([
      ["aldo-behind", { sequence: 4, threadCount: 1 }],
      ["aldo-current", { sequence: 9, threadCount: 1 }],
      ["aldo-ahead", { sequence: 12, threadCount: 2 }],
    ]);
    const { download, offer } = planAldoShellSync(
      [
        machine("aldo-behind", 9),
        machine("aldo-current", 9),
        machine("aldo-ahead", 9),
        machine("aldo-uncached", 0),
      ],
      cached,
    );
    expect(download.map((entry) => entry.environmentId)).toEqual(["aldo-behind", "aldo-uncached"]);
    expect(offer).toEqual([]);
  });

  it("offers a cached copy with threads for a machine Aldo has no shell for", () => {
    const cached = new Map([
      ["aldo-threads", { sequence: 40, threadCount: 3 }],
      ["aldo-empty", { sequence: 2, threadCount: 0 }],
    ]);
    const { download, offer } = planAldoShellSync(
      [machine("aldo-threads", null), machine("aldo-empty", null), machine("aldo-uncached", null)],
      cached,
    );
    expect(offer.map((entry) => entry.environmentId)).toEqual(["aldo-threads"]);
    expect(download).toEqual([]);
  });
});
