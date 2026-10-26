// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AldoOrgNotes } from "./orgAdmin.logic";

const profile = vi.hoisted(() => ({ organization: null as string | null }));
vi.mock("./AldoAccountMenu", () => ({ useAldoProfile: () => profile }));
const notes = vi.hoisted(() => ({
  data: undefined as AldoOrgNotes | undefined,
  enabled: [] as boolean[],
}));
vi.mock("./settingsData", () => ({ settingsOrgNotes: { load: async () => undefined } }));
vi.mock("./settingsResource", () => ({
  useSettingsResource: (_resource: unknown, enabled: boolean) => {
    notes.enabled.push(enabled);
    return { data: notes.data };
  },
}));

const { AldoOrgNoteCard } = await import("./AldoOrgNoteCard");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  profile.organization = null;
  notes.data = undefined;
  notes.enabled = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const stop = {
  environmentId: "aldo-t_board",
  at: "2026-10-26T14:00:00.000Z",
  by: "sam@linden.com",
  note: "Back Monday",
};

describe("an organization's note in a thread", () => {
  it("asks nothing for someone in no organization, and shows nothing", async () => {
    notes.data = { org: "Linden Partners", paused: null, stops: [stop] };
    await act(async () => root.render(<AldoOrgNoteCard environmentId="aldo-t_board" />));
    expect(notes.enabled.every((enabled) => enabled === false)).toBe(true);
    expect(container.innerHTML).toBe("");
  });

  it("says who stopped the thread, with their note, only in that thread", async () => {
    profile.organization = "Linden Partners";
    notes.data = { org: "Linden Partners", paused: null, stops: [stop] };
    await act(async () => root.render(<AldoOrgNoteCard environmentId="aldo-t_board" />));
    expect(notes.enabled).toContain(true);
    expect(container.querySelector("[role=status]")?.textContent).toMatch(
      /^Stopped by sam@linden\.com, an admin of Linden Partners, .+Your files are kept; send a message to carry on\.“Back Monday”$/,
    );
    await act(async () => root.render(<AldoOrgNoteCard environmentId="aldo-t_other" />));
    expect(container.innerHTML).toBe("");
  });

  it("says their work is paused, in every thread", async () => {
    profile.organization = "Linden Partners";
    notes.data = {
      org: "Linden Partners",
      paused: { at: "2026-10-26T14:00:00.000Z", by: "sam@linden.com" },
      stops: [],
    };
    await act(async () => root.render(<AldoOrgNoteCard environmentId="aldo-t_other" />));
    expect(container.textContent).toMatch(
      /^sam@linden\.com, an admin of Linden Partners, paused your work/,
    );
  });
});
