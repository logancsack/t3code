import { describe, expect, it } from "vite-plus/test";

import { type AldoHandoff } from "./homeApi";
import {
  aldoHandoffButtons,
  aldoHandoffCode,
  aldoHandoffConversationPath,
  aldoHandoffDuration,
  aldoHandoffElsewhere,
  aldoHandoffEyebrow,
  aldoHandoffFor,
  aldoHandoffHow,
  aldoHandoffOn,
  aldoHandoffParam,
  aldoHandoffPhoneLink,
  aldoHandoffSiteLabel,
  aldoHandoffSiteLink,
  aldoOnSameSite,
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
    expect(aldoHandoffHow(handoff({ kind: "identity", site: "fiverr.com" }))).toBe(
      "Confirm who you are on fiverr.com (an ID or a selfie), then hand it back.",
    );
    expect(aldoHandoffHow(handoff({ kind: "payout", site: "fiverr.com" }))).toBe(
      "Add your payout, bank or tax details on fiverr.com, then hand it back.",
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

  it("offers the site's own phone link only when it's https on the step's site", () => {
    const link = "https://verify.fiverr.com/continue?session=7f3a&step=selfie";
    const idCheck = (phoneUrl: string | null | undefined) =>
      handoff({
        kind: "identity",
        site: "fiverr.com",
        reason: "Fiverr needs an ID check",
        ...(phoneUrl === undefined ? {} : { phoneUrl }),
      });
    expect(aldoHandoffSiteLink(idCheck(link))).toBe(link);
    expect(aldoHandoffSiteLink(idCheck("https://fiverr.com/m/1"))).toBe("https://fiverr.com/m/1");
    // An older Aldo sends none.
    expect(aldoHandoffSiteLink(idCheck(undefined))).toBeNull();
    expect(aldoHandoffSiteLink(idCheck(null))).toBeNull();
    expect(aldoHandoffSiteLink(idCheck("http://verify.fiverr.com/continue"))).toBeNull();
    expect(aldoHandoffSiteLink(idCheck("https://evil.example/continue"))).toBeNull();
    expect(aldoHandoffSiteLink(idCheck("https://fiverr.com.evil.example/continue"))).toBeNull();
    expect(aldoHandoffSiteLink(idCheck("https://a:b@verify.fiverr.com/continue"))).toBeNull();
    expect(aldoHandoffSiteLink(idCheck("javascript:alert(1)"))).toBeNull();
    expect(aldoHandoffSiteLink(idCheck(`https://fiverr.com/?s=${"x".repeat(1000)}`))).toBeNull();
    expect(aldoHandoffSiteLink({ site: null, phoneUrl: link })).toBeNull();
    // Short as written, but long once its address is encoded: its QR code wouldn't fit.
    expect(aldoHandoffSiteLink(idCheck(`https://fiverr.com/?s=${"😀".repeat(480)}`))).toBeNull();
    expect(aldoHandoffSiteLabel(idCheck(link))).toBe("Open on Fiverr");
    expect(aldoHandoffSiteLabel(handoff({ site: null }))).toBe("Open the site's page");
  });

  it("takes a host on the step's site, or one above or under it, never a neighbour on a shared suffix", () => {
    expect(aldoOnSameSite("fiverr.com", "www.fiverr.com")).toBe(true);
    expect(aldoOnSameSite("verify.fiverr.com", "www.fiverr.com")).toBe(true);
    expect(aldoOnSameSite("google.com", "accounts.google.com")).toBe(true);
    expect(aldoOnSameSite("evil.github.io", "alice.github.io")).toBe(false);
    expect(aldoOnSameSite("evil.co.uk", "bbc.co.uk")).toBe(false);
    expect(aldoOnSameSite("myaccount.google.com", "accounts.google.com")).toBe(false);
    expect(aldoOnSameSite("fiverr.com.evil.example", "fiverr.com")).toBe(false);
    expect(aldoOnSameSite("com", "fiverr.com")).toBe(false);
  });

  it("sends a phone to the site's own page for a camera step, else to the agent's browser in Aldo", () => {
    const id = handoff({ id: "ho_9", thread: { environmentId: "aldo-t1", threadId: "c-1" } });
    expect(aldoHandoffConversationPath(id)).toBe("/aldo-t1/c-1?handoff=ho_9");
    expect(aldoHandoffPhoneLink(id, "https://aldo.computer")).toEqual({
      href: "https://aldo.computer/aldo-t1/c-1?handoff=ho_9",
      onSite: false,
    });
    const camera = handoff({
      kind: "identity",
      site: "fiverr.com",
      phoneUrl: "https://www.fiverr.com/verify/phone?t=1",
    });
    expect(aldoHandoffPhoneLink(camera, "https://aldo.computer")).toEqual({
      href: "https://www.fiverr.com/verify/phone?t=1",
      onSite: true,
    });
    // A page that isn't on the web has no address a phone could open.
    expect(aldoHandoffPhoneLink(id, "file://")).toBeNull();
    expect(aldoHandoffPhoneLink(id, "null")).toBeNull();
  });

  it("puts Take control first, with Do it on my phone beside it on a computer", () => {
    const computer = { onPhone: false, phoneLink: true };
    const phone = { onPhone: true, phoneLink: true };
    expect(aldoHandoffButtons(handoff(), computer)).toEqual(["take", "phone", "skip"]);
    expect(aldoHandoffButtons(handoff({ kind: "identity" }), computer)).toEqual([
      "take",
      "phone",
      "skip",
    ]);
    // Without an address a phone can open, there's no phone button.
    expect(aldoHandoffButtons(handoff(), { onPhone: false, phoneLink: false })).toEqual([
      "take",
      "skip",
    ]);
    // On the phone already, its own browser is the way.
    expect(aldoHandoffButtons(handoff({ kind: "payout" }), phone)).toEqual(["take", "skip"]);
    // A camera step on a phone leads with the site's own page, then hands back.
    const camera = handoff({
      kind: "identity",
      site: "fiverr.com",
      phoneUrl: "https://verify.fiverr.com/continue",
    });
    expect(aldoHandoffButtons(camera, phone)).toEqual(["site", "done", "take", "skip"]);
    expect(aldoHandoffButtons(camera, computer)).toEqual(["take", "phone", "skip"]);
    // A code is typed into the card; what's done on another device leads with I'm done.
    expect(aldoHandoffButtons(handoff({ kind: "code" }), computer)).toEqual(["browser", "skip"]);
    expect(aldoHandoffButtons(handoff({ kind: "number_match" }), computer)).toEqual([
      "done",
      "browser",
      "skip",
    ]);
    expect(aldoHandoffButtons(handoff({ kind: "approve_on_device" }), phone)).toEqual([
      "done",
      "browser",
      "skip",
    ]);
  });
});
