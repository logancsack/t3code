import { describe, expect, it } from "vite-plus/test";

import {
  aldoAddressParts,
  aldoBlankPage,
  aldoBrowserState,
  aldoDialogFrom,
  aldoTabTitle,
} from "./browserChrome.logic";

describe("aldoAddressParts", () => {
  it("shows the site in full and the rest after it, without the scheme or www", () => {
    expect(aldoAddressParts("https://www.resy.com/cities/sf?date=2026-10-24#top")).toEqual({
      host: "resy.com",
      rest: "/cities/sf?date=2026-10-24#top",
    });
    expect(aldoAddressParts("http://localhost:3000/")).toEqual({
      host: "localhost:3000",
      rest: "",
    });
  });

  it("has nothing to show for a blank tab or a browser page", () => {
    expect(aldoAddressParts("about:blank")).toBeNull();
    expect(aldoAddressParts("chrome://newtab/")).toBeNull();
    expect(aldoAddressParts("chrome://settings")).toBeNull();
    expect(aldoAddressParts("not a url")).toBeNull();
  });
});

describe("aldoBlankPage", () => {
  it("knows a tab with nothing in it yet", () => {
    expect(aldoBlankPage("")).toBe(true);
    expect(aldoBlankPage("about:blank")).toBe(true);
    expect(aldoBlankPage("chrome://new-tab-page/")).toBe(true);
    expect(aldoBlankPage("https://example.com")).toBe(false);
  });
});

describe("aldoTabTitle", () => {
  it("names a tab by its title, else its site", () => {
    expect(aldoTabTitle({ url: "https://news.ycombinator.com/", title: "Hacker News" })).toBe(
      "Hacker News",
    );
    expect(aldoTabTitle({ url: "https://news.ycombinator.com/item?id=1", title: " " })).toBe(
      "news.ycombinator.com",
    );
    expect(aldoTabTitle({ url: "about:blank", title: "about:blank" })).toBe("New tab");
  });
});

describe("aldoDialogFrom", () => {
  it("says which site a dialog is from", () => {
    expect(aldoDialogFrom("https://www.airbnb.com/s/San-Francisco")).toBe("airbnb.com says");
    expect(aldoDialogFrom("about:blank")).toBe("This page says");
  });
});

describe("aldoBrowserState", () => {
  const none = {
    recording: false,
    handoff: false,
    explicit: false,
    agentActive: false,
    using: false,
  };

  it("is shared when nobody is using it", () => {
    expect(aldoBrowserState(none)).toBe("shared");
  });

  it("puts the most pressing state first", () => {
    expect(aldoBrowserState({ ...none, recording: true, handoff: true, explicit: true })).toBe(
      "recording",
    );
    expect(aldoBrowserState({ ...none, handoff: true, explicit: true, agentActive: true })).toBe(
      "handoff",
    );
    expect(aldoBrowserState({ ...none, explicit: true, agentActive: true })).toBe("yours");
    expect(aldoBrowserState({ ...none, using: true, agentActive: true })).toBe("using");
    expect(aldoBrowserState({ ...none, agentActive: true })).toBe("agent");
  });
});
