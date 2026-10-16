import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { AldoInstructions, AldoMemoryItem } from "./cloud";

const state = vi.hoisted(() => ({
  instructions: [] as AldoInstructions[],
  memory: [] as AldoMemoryItem[],
  skills: [],
  cause: null as Error | null,
  environments: [],
}));
vi.mock("./settingsData", () => ({
  settingsInstructions: "instructions",
  settingsMemory: "memory",
  settingsSkills: "skills",
  settingsRepositories: { load: async () => [] },
}));
vi.mock("./settingsResource", () => ({
  useSettingsResource: (key: "instructions" | "memory" | "skills") => ({
    data: state.cause ? undefined : state[key],
    error: state.cause?.message ?? null,
    cause: state.cause,
  }),
}));
vi.mock("./cloud", () => ({
  AldoApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  aldoInstructions: {},
  aldoMemory: {},
  aldoSkills: {},
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
import { AldoSkillsPanel } from "./AldoSkillsPanel";
import { AldoApiError } from "./cloud";

let renderer: ReactTestRenderer;
beforeEach(() => {
  state.cause = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it.each([
  ["instructions", AldoInstructionsPanel],
  ["memory", AldoMemoryPanel],
  ["skills", AldoSkillsPanel],
] as const)("%s shows compatibility 404s without a duplicate error", async (kind, Panel) => {
  state.cause = new AldoApiError(404, "Compatibility read failed");
  await act(() => {
    renderer = create(<Panel />);
  });
  const text = () =>
    renderer.root
      .findAllByType("p")
      .flatMap((p) => p.children.filter((child) => typeof child === "string"))
      .join(" ");
  expect(text()).toContain(`doesn't have ${kind} yet`);
  expect(text()).not.toContain("Compatibility read failed");
  state.cause = new AldoApiError(503, "Temporary read failure");
  await act(() => renderer.update(<Panel />));
  expect(text()).not.toContain(`doesn't have ${kind} yet`);
  expect(text()).toContain("Temporary read failure");
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
