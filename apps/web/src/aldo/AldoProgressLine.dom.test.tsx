// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { AldoProgressLine } from "./AldoProgressLine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("ticks the time on its own", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:05Z"));
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <AldoProgressLine
        plan={null}
        words="Working on fiverr.com"
        startedAt="2026-10-20T12:00:00Z"
      />,
    ),
  );
  expect(host.textContent).toBe("Working on fiverr.com · 5 sec");
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(host.textContent).toBe("Working on fiverr.com · 7 sec");
  act(() => root.unmount());
  vi.useRealTimers();
});
