import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { AldoInstructions, AldoMemoryItem } from "./cloud";

const state = vi.hoisted(() => ({
  instructions: [] as AldoInstructions[],
  memory: [] as AldoMemoryItem[],
  environments: [],
}));
vi.mock("./settingsData", () => ({
  settingsInstructions: "instructions",
  settingsMemory: "memory",
  settingsRepositories: { load: async () => [] },
}));
vi.mock("./settingsResource", () => ({
  useSettingsResource: (key: "instructions" | "memory") => ({ data: state[key], error: null }),
}));
vi.mock("./cloud", () => ({
  AldoApiError: class extends Error {},
  aldoInstructions: {},
  aldoMemory: {},
  getAldoEnvironments: () => state.environments,
  subscribeAldoEnvironments: () => () => {},
}));
vi.mock("../components/settings/settingsLayout", () => ({ SettingsSection: "section" }));
vi.mock("../components/ui/button", () => ({ Button: "button" }));
vi.mock("../components/ui/input", () => ({ Input: "input" }));
vi.mock("../components/ui/textarea", () => ({ Textarea: "textarea" }));
vi.mock("../components/ui/menu", () => ({
  Menu: "div",
  MenuItem: "button",
  MenuPopup: "div",
  MenuTrigger: "button",
}));

import { AldoInstructionsPanel } from "./AldoInstructionsPanel";
import { AldoMemoryPanel } from "./AldoMemoryPanel";

let renderer: ReactTestRenderer;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it.each(["instructions", "memory"] as const)(
  "%s refreshes clean text and preserves a draft when stale data returns",
  async (kind) => {
    const setText = (text: string) => {
      state.instructions = [{ scope: "*", text, updated_at: text }];
      state.memory = [
        {
          id: "profile",
          kind: "profile",
          title: "",
          body: text,
          source: "user",
          updatedAt: "2026-10-16T00:00:00Z",
        },
      ];
    };
    const panel = () => (kind === "instructions" ? <AldoInstructionsPanel /> : <AldoMemoryPanel />);
    setText("cached");
    await act(() => {
      renderer = create(panel());
    });
    const editor = () => renderer.root.findByType("textarea");
    expect(editor().props.value).toBe("cached");
    setText("fresh");
    await act(() => renderer.update(panel()));
    expect(editor().props.value).toBe("fresh");
    await act(() =>
      editor().props.onChange({
        target: { value: "my draft" },
        currentTarget: { value: "my draft" },
      }),
    );
    setText("changed elsewhere");
    await act(() => renderer.update(panel()));
    expect(editor().props.value).toBe("my draft");
  },
);

it("keeps an open note draft when the background answer updates its timestamp", async () => {
  const note: AldoMemoryItem = {
    id: "note",
    kind: "note",
    title: "Editor",
    body: "cached",
    source: "user",
    updatedAt: "2026-10-15T00:00:00Z",
  };
  state.memory = [note];
  await act(() => {
    renderer = create(<AldoMemoryPanel />);
  });
  const edit = () =>
    renderer.root.findAllByType("button").find((button) => button.props.children === "Edit")!;
  await act(() => edit().props.onClick());
  const editor = () => renderer.root.findAllByType("textarea")[1]!;
  await act(() => editor().props.onChange({ target: { value: "my note draft" } }));
  state.memory = [{ ...note, body: "fresh", updatedAt: "2026-10-16T00:00:00Z" }];
  await act(() => renderer.update(<AldoMemoryPanel />));
  expect(editor().props.value).toBe("my note draft");
  const cancel = renderer.root
    .findAllByType("button")
    .find((button) => button.props.children === "Cancel")!;
  await act(() => cancel.props.onClick());
  await act(() => edit().props.onClick());
  expect(editor().props.value).toBe("fresh");
});
