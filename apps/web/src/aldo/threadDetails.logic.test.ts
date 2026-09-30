import { describe, expect, it } from "vite-plus/test";

import { readAldoThreadDetail } from "./threadDetails.logic";

const detail = (snapshotSequence: number) => ({ snapshotSequence, thread: { id: "t" } });

describe("readAldoThreadDetail", () => {
  it("opens a thread this browser never had from Aldo's copy", () => {
    const copy = detail(40);
    expect(readAldoThreadDetail(null, { sequence: 40, detail: copy })).toEqual({
      detail: copy,
      missing: false,
    });
  });

  it("takes Aldo's copy over an older cached one", () => {
    const copy = detail(40);
    expect(readAldoThreadDetail(12, { sequence: 40, detail: copy }).detail).toBe(copy);
  });

  it("keeps the cache when Aldo's copy isn't newer", () => {
    expect(readAldoThreadDetail(40, { sequence: 40, detail: null })).toEqual({
      detail: null,
      missing: false,
    });
    // Even if a copy comes anyway.
    expect(readAldoThreadDetail(40, { sequence: 40, detail: detail(40) }).detail).toBeNull();
  });

  it("is missing only when neither Aldo nor this browser has the thread", () => {
    expect(readAldoThreadDetail(null, { sequence: null, detail: null }).missing).toBe(true);
    expect(readAldoThreadDetail(7, { sequence: null, detail: null })).toEqual({
      detail: null,
      missing: false,
    });
  });

  it("ignores a copy without a sequence", () => {
    expect(readAldoThreadDetail(null, { sequence: 3, detail: { thread: {} } }).detail).toBeNull();
  });
});
