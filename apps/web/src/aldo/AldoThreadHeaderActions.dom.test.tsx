// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
const screen = vi.hoisted(() => ({ mobile: true }));
vi.mock("../hooks/useMediaQuery", () => ({ useIsMobile: () => screen.mobile }));
import { AldoThreadHeaderActions } from "./AldoThreadHeaderActions";

it("groups existing preview controls on a phone and exposes them directly on desktop", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const controls = (
    <AldoThreadHeaderActions>
      <button>Preview</button>
      <button>Thread tools</button>
    </AldoThreadHeaderActions>
  );
  try {
    await act(async () => root.render(controls));
    expect(container.textContent).not.toContain("Thread tools");
    await act(async () =>
      container
        .querySelector('button[aria-label="Preview and thread tools"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="popover-popup"]')?.textContent).toContain(
        "PreviewThread tools",
      ),
    );
    screen.mobile = false;
    await act(async () =>
      root.render(
        <AldoThreadHeaderActions>
          <button>Preview</button>
          <button>Thread tools</button>
        </AldoThreadHeaderActions>,
      ),
    );
    expect(container.textContent).toBe("PreviewThread tools");
    expect(container.querySelector('[aria-label="Preview and thread tools"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    screen.mobile = true;
    vi.unstubAllGlobals();
  }
});
