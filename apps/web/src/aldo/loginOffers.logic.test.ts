import { describe, expect, it } from "vite-plus/test";

import {
  aldoLoginSite,
  aldoLoginToSave,
  nextAldoLoginOffer,
  parseAldoLoginOffers,
} from "./loginOffers.logic";

const offer = {
  id: "o1",
  origin: "https://www.github.com",
  username: "alice@example.com",
  password: "hunter22",
};

describe("parseAldoLoginOffers", () => {
  it("reads offers, with the saved login an update would replace", () => {
    const saved = { id: "v_1", label: "GitHub (work)", scope: "me/app" };
    expect(parseAldoLoginOffers([offer, { ...offer, id: "o2", saved }])).toEqual([
      offer,
      { ...offer, id: "o2", saved },
    ]);
  });

  it("skips what isn't a whole offer", () => {
    expect(parseAldoLoginOffers(undefined)).toEqual([]);
    expect(
      parseAldoLoginOffers([null, { ...offer, password: "" }, { ...offer, origin: 3 }, offer]),
    ).toEqual([offer]);
    expect(parseAldoLoginOffers([{ ...offer, saved: { id: "v_1" } }])).toEqual([offer]);
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
});

describe("aldoLoginToSave", () => {
  it("saves a new login under the site's name, for the threads chosen", () => {
    expect(aldoLoginToSave(offer, "*")).toEqual({
      label: "github.com",
      origin: offer.origin,
      username: offer.username,
      password: offer.password,
      scope: "*",
    });
  });

  it("updates a saved login in place, keeping its name and threads", () => {
    const saved = { id: "v_1", label: "GitHub (work)", scope: "me/app" };
    expect(aldoLoginToSave({ ...offer, saved }, "*")).toEqual({
      id: "v_1",
      label: "GitHub (work)",
      origin: offer.origin,
      username: offer.username,
      password: offer.password,
      scope: "me/app",
    });
  });
});
