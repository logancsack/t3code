import { describe, expect, it } from "vite-plus/test";

import {
  aldoLoginSite,
  aldoLoginToSave,
  nextAldoLoginOffer,
  parseAldoLoginOffers,
  pendingAldoLoginAnswers,
} from "./loginOffers.logic";

const offer = {
  id: "o1",
  origin: "https://www.github.com",
  username: "alice@example.com",
};

describe("parseAldoLoginOffers", () => {
  it("reads offers, with the saved login an update would replace", () => {
    const saved = { id: "v_1", label: "GitHub (work)", scope: "me/app" };
    expect(parseAldoLoginOffers([offer, { ...offer, id: "o2", saved }])).toEqual([
      offer,
      { ...offer, id: "o2", saved },
    ]);
  });

  it("skips what isn't a whole offer, and never keeps a password", () => {
    expect(parseAldoLoginOffers(undefined)).toEqual([]);
    expect(parseAldoLoginOffers([null, { ...offer, origin: 3 }, offer])).toEqual([offer]);
    expect(parseAldoLoginOffers([{ ...offer, saved: { id: "v_1" } }])).toEqual([offer]);
    expect(parseAldoLoginOffers([{ ...offer, password: "hunter22" }])).toEqual([offer]);
  });
});

describe("aldoLoginSite", () => {
  it("names a site by its host, without www", () => {
    expect(aldoLoginSite("https://www.github.com")).toBe("github.com");
    expect(aldoLoginSite("https://dashboard.stripe.com")).toBe("dashboard.stripe.com");
    expect(aldoLoginSite("http://localhost:3000")).toBe("localhost:3000");
  });
});

describe("nextAldoLoginOffer", () => {
  it("skips sites the user said never to", () => {
    const other = { ...offer, id: "o2", origin: "https://vercel.com" };
    expect(nextAldoLoginOffer([offer, other], new Set())).toBe(offer);
    expect(nextAldoLoginOffer([offer, other], new Set([offer.origin]))).toBe(other);
    expect(nextAldoLoginOffer([offer], new Set([offer.origin]))).toBeNull();
  });

  it("skips offers the user answered, before the machine has taken the answer", () => {
    const other = { ...offer, id: "o2", origin: "https://vercel.com" };
    expect(nextAldoLoginOffer([offer, other], new Set(), new Map([["o1", false]]))).toBe(other);
  });
});

describe("pendingAldoLoginAnswers", () => {
  it("keeps the answers to offers the machine still sends, to send again", () => {
    const answered = new Map([
      ["o1", true],
      ["gone", false],
    ]);
    expect(pendingAldoLoginAnswers(answered, [offer])).toEqual(new Map([["o1", true]]));
    expect(pendingAldoLoginAnswers(answered, [])).toEqual(new Map());
  });
});

describe("aldoLoginToSave", () => {
  it("saves a new login under the site's name, for the threads chosen", () => {
    expect(aldoLoginToSave(offer, "hunter22", "*")).toEqual({
      label: "github.com",
      origin: offer.origin,
      username: offer.username,
      password: "hunter22",
      scope: "*",
    });
  });

  it("updates a saved login in place, keeping its name and threads", () => {
    const saved = { id: "v_1", label: "GitHub (work)", scope: "me/app" };
    expect(aldoLoginToSave({ ...offer, saved }, "hunter22", "*")).toEqual({
      id: "v_1",
      label: "GitHub (work)",
      origin: offer.origin,
      username: offer.username,
      password: "hunter22",
      scope: "me/app",
    });
  });
});
