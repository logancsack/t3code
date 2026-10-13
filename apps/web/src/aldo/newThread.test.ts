import { describe, expect, it } from "vite-plus/test";

import { DraftId } from "../composerDraftStore";
import { openAldoThreadOnce } from "./newThread";

/** A start that opens `draft` once it's let go. */
function opener(draft: string) {
  let go: () => void = () => {};
  const ready = new Promise<void>((resolve) => (go = resolve));
  let calls = 0;
  return {
    open: async () => {
      calls++;
      await ready;
      return { draftId: DraftId.make(draft) };
    },
    go: () => go(),
    calls: () => calls,
  };
}

describe("openAldoThreadOnce", () => {
  it("opens one thread for starts in the same place, whichever asked", async () => {
    const first = opener("draft-1");
    const second = opener("draft-2");
    const a = openAldoThreadOnce("", first.open);
    const b = openAldoThreadOnce("", second.open);
    first.go();
    expect(await a).toEqual({ draftId: "draft-1" });
    expect(await b).toEqual({ draftId: "draft-1" });
    expect(second.calls()).toBe(0);
  });

  it("opens a share's draft of its own, after the user's start and before the next", async () => {
    const users = opener("draft-users");
    const shares = opener("draft-shared");
    const next = opener("draft-next");
    const user = openAldoThreadOnce("", users.open);
    const share = openAldoThreadOnce("share-1", shares.open);
    users.go();
    expect(await user).toEqual({ draftId: "draft-users" });
    // The user's New while the share opens: it waits, and opens its own.
    const again = openAldoThreadOnce("", next.open);
    shares.go();
    expect(await share).toEqual({ draftId: "draft-shared" });
    next.go();
    expect(await again).toEqual({ draftId: "draft-next" });
    expect([users.calls(), shares.calls(), next.calls()]).toEqual([1, 1, 1]);
  });
});
