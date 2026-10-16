import { describe, expect, it } from "vite-plus/test";

import { type AldoHandoff } from "./homeApi";
import {
  aldoHandoffCode,
  aldoHandoffDuration,
  aldoHandoffElsewhere,
  aldoHandoffEyebrow,
  aldoHandoffFor,
  aldoHandoffHow,
  aldoHandoffOn,
  aldoHandoffParam,
  aldoHandoffSkipLabel,
  aldoHandoffWantsCode,
} from "./handoffs.logic";

const handoff = (over: Partial<AldoHandoff> = {}): AldoHandoff => ({
  id: "ho_1",
  kind: "captcha",
  reason: "OpenTable wants to check you're human",
  how: null,
  site: "opentable.com",
  url: "https://www.opentable.com/r/juniper",
  seconds: 10,
  thread: { environmentId: "env-1", threadId: "t-1" },
  threadTitle: "Dinner Friday",
  createdAt: "2026-10-13T08:00:00.000Z",
  expiresAt: "2026-10-13T08:30:00.000Z",
  ...over,
});

describe("handoffs", () => {
  it("finds a conversation's open handoff, and one on a computer", () => {
    const other = handoff({ id: "ho_2", thread: { environmentId: "env-1", threadId: "t-2" } });
    const home = { handoffs: [other, handoff()] };
    expect(aldoHandoffFor(home, { environmentId: "env-1", threadId: "t-1" })?.id).toBe("ho_1");
    expect(aldoHandoffFor(home, { environmentId: "env-2", threadId: "t-1" })).toBeNull();
    expect(aldoHandoffOn(home, "env-1")?.id).toBe("ho_2");
    // An older Aldo has no handoffs.
    expect(aldoHandoffFor({}, { environmentId: "env-1", threadId: "t-1" })).toBeNull();
    expect(aldoHandoffOn(null, "env-1")).toBeNull();
  });

  it("says how long it usually takes, only when that's known", () => {
    expect(aldoHandoffEyebrow(handoff())).toBe("Needs you · about 10 seconds");
    expect(aldoHandoffEyebrow(handoff({ seconds: null }))).toBe("Needs you");
    expect(aldoHandoffDuration(3)).toBe("about 5 seconds");
    expect(aldoHandoffDuration(70)).toBe("about a minute");
    expect(aldoHandoffDuration(150)).toBe("about 3 minutes");
    expect(aldoHandoffDuration(0)).toBeNull();
  });

  it("says what to do: the agent's words, or the kind's", () => {
    expect(aldoHandoffHow(handoff({ how: "Tick the box, then hand it back" }))).toBe(
      "Tick the box, then hand it back",
    );
    expect(aldoHandoffHow(handoff())).toBe(
      "Get past the check on opentable.com, then hand it back.",
    );
    expect(aldoHandoffHow(handoff({ kind: "something_new", site: null }))).toBe(
      "Do what the page asks, then hand it back.",
    );
  });

  it("leads with I'm done for what's done on another device", () => {
    expect(aldoHandoffElsewhere(handoff({ kind: "approve_on_device" }))).toBe(true);
    expect(aldoHandoffElsewhere(handoff({ kind: "number_match" }))).toBe(true);
    expect(aldoHandoffElsewhere(handoff())).toBe(false);
  });

  it("asks for a code only when one was sent, and cleans what's typed", () => {
    expect(aldoHandoffWantsCode(handoff({ kind: "code" }))).toBe(true);
    expect(aldoHandoffWantsCode(handoff())).toBe(false);
    expect(aldoHandoffCode(" 123 456 ")).toBe("123456");
    expect(aldoHandoffCode("AB-12")).toBe("AB12");
  });

  it("names the site to skip as the reason does, else by its domain", () => {
    expect(aldoHandoffSkipLabel(handoff())).toBe("Skip OpenTable");
    expect(
      aldoHandoffSkipLabel(
        handoff({ site: "accounts.google.com", reason: "Google wants a code it texted you" }),
      ),
    ).toBe("Skip Google");
    expect(
      aldoHandoffSkipLabel(handoff({ site: "bbc.co.uk", reason: "The BBC wants you to sign in" })),
    ).toBe("Skip BBC");
    expect(
      aldoHandoffSkipLabel(
        handoff({ site: "my.example-shop.com", reason: "A check you're human" }),
      ),
    ).toBe("Skip example-shop.com");
    expect(
      aldoHandoffSkipLabel(
        handoff({ site: "shop.opentable.com", reason: "Open Table wants to check" }),
      ),
    ).toBe("Skip Open Table");
    expect(aldoHandoffSkipLabel(handoff({ site: null }))).toBe("Skip it");
  });

  it("reads the handoff a notification opened the page for", () => {
    expect(aldoHandoffParam("?handoff=ho_1")).toBe("ho_1");
    expect(aldoHandoffParam("?other=1")).toBeNull();
    expect(aldoHandoffParam("")).toBeNull();
  });
});
