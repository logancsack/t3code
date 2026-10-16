// @vitest-environment jsdom

import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AldoSidebarOrderInput } from "./sidebarOrder.logic";

const directory = vi.hoisted(() => ({
  environments: [] as Array<{ environmentId: string; starts?: Record<string, unknown> }>,
  listeners: new Set<() => void>(),
}));
vi.mock("./cloud", () => ({
  isAldoCloud: true,
  getAldoEnvironments: () => directory.environments,
  subscribeAldoEnvironments: (listener: () => void) => {
    directory.listeners.add(listener);
    return () => directory.listeners.delete(listener);
  },
}));

const { useAldoSidebarOrder } = await import("./sidebarOrder");

const ENV = "aldo-a";
const at = (minute: number) => new Date(Date.UTC(2026, 9, 16, 12, minute)).toISOString();

function finished(id: string, minute: number): AldoSidebarOrderInput {
  return {
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make(ENV),
    createdAt: at(0),
    updatedAt: at(minute),
    latestTurn: {
      turnId: TurnId.make(`${id}-turn`),
      state: "completed",
      requestedAt: at(minute - 1),
      startedAt: at(minute - 1),
      completedAt: at(minute),
      assistantMessageId: null,
    },
    session: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
  };
}

type Hook = ReturnType<typeof useAldoSidebarOrder>;

function Probe(props: {
  threads: readonly AldoSidebarOrderInput[];
  hold?: boolean;
  onHook: (hook: Hook) => void;
}) {
  const hook = useAldoSidebarOrder({ hold: props.hold ?? false });
  const ordered = hook.order("active", props.threads);
  const { onHook } = props;
  useEffect(() => onHook(hook));
  return (
    <ol>
      {ordered.map((thread) => (
        <li key={thread.id}>{thread.id}</li>
      ))}
    </ol>
  );
}

let hook: Hook;
let container: HTMLDivElement;
let root: Root;
const show = (threads: readonly AldoSidebarOrderInput[]) =>
  act(() =>
    root.render(
      <Probe
        threads={threads}
        onHook={(next) => {
          hook = next;
        }}
      />,
    ),
  );
const shownIds = () => [...container.querySelectorAll("li")].map((item) => item.textContent);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  directory.environments = [];
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe("useAldoSidebarOrder", () => {
  it("keeps rows in place while the pointer is over the list, and reorders once it leaves", () => {
    show([finished("a", 10), finished("b", 20)]);
    expect(shownIds()).toEqual(["b", "a"]);
    act(() => hook.listProps.onPointerEnter());
    show([finished("a", 30), finished("b", 20)]);
    expect(shownIds()).toEqual(["b", "a"]);
    act(() => hook.listProps.onPointerLeave());
    expect(shownIds()).toEqual(["a", "b"]);
  });

  it("shows a new thread in its place while held", () => {
    show([finished("a", 10), finished("b", 20)]);
    act(() => hook.listProps.onPointerEnter());
    show([finished("a", 30), finished("b", 20), finished("c", 40)]);
    expect(shownIds()).toEqual(["c", "b", "a"]);
  });

  it("holds a press that leaves the list (a drag) until it ends", () => {
    show([finished("a", 10), finished("b", 20)]);
    act(() => {
      hook.listProps.onPointerEnter();
      hook.listProps.onPointerDown();
      hook.listProps.onPointerLeave();
    });
    show([finished("a", 30), finished("b", 20)]);
    expect(shownIds()).toEqual(["b", "a"]);
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    expect(shownIds()).toEqual(["a", "b"]);
  });

  it("lists a thread Aldo holds a message for with the work, but not a failed one", () => {
    const threads = [finished("a", 10), finished("b", 20)];
    show(threads);
    expect(shownIds()).toEqual(["b", "a"]);
    directory.environments = [
      { environmentId: ENV, starts: { a: { kind: "message", state: "queued" } } },
    ];
    act(() => directory.listeners.forEach((listener) => listener()));
    expect(shownIds()).toEqual(["a", "b"]);
    directory.environments = [
      { environmentId: ENV, starts: { a: { kind: "message", state: "failed" } } },
    ];
    act(() => directory.listeners.forEach((listener) => listener()));
    expect(shownIds()).toEqual(["b", "a"]);
    // When it failed, as Aldo says, orders it among the finished ones.
    directory.environments = [
      { environmentId: ENV, starts: { a: { kind: "message", state: "failed", at: at(30) } } },
    ];
    act(() => directory.listeners.forEach((listener) => listener()));
    expect(shownIds()).toEqual(["a", "b"]);
  });

  it("keeps rows in place while the sidebar holds them (a search open)", () => {
    const hold = (threads: readonly AldoSidebarOrderInput[], held: boolean) =>
      act(() =>
        root.render(
          <Probe
            threads={threads}
            hold={held}
            onHook={(next) => {
              hook = next;
            }}
          />,
        ),
      );
    hold([finished("a", 10), finished("b", 20)], false);
    hold([finished("a", 30), finished("b", 20)], true);
    expect(shownIds()).toEqual(["b", "a"]);
    hold([finished("a", 30), finished("b", 20)], false);
    expect(shownIds()).toEqual(["a", "b"]);
  });
});
