// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { AldoUpdateCard } from "./AldoUpdateCard";
import type { AldoHomeUpdate } from "./homeUpdate.logic";
vi.mock("./AldoWorkstream", () => ({
  threadLink: (_: unknown, children: ReactNode) => <a href="/aldo-demo/work">{children}</a>,
}));
const update: AldoHomeUpdate = {
  id: "report-1",
  title: "Agent practices",
  thread: { environmentId: "aldo-demo", threadId: "work" },
  state: "unfinished",
  summary: "I’ve checked the safeguards. I still need to run the first real-world comparison.",
  checked: ["Type checking and lint passed."],
  notChecked: ["First live model comparison and its saved results."],
  links: [],
};
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
afterEach(async () => {
  await act(async () => root.render(null));
});
it("keeps one result together and reveals reported evidence only when Details is opened", async () => {
  await act(async () => root.render(<AldoUpdateCard update={update} />));
  expect(container.querySelectorAll("article")).toHaveLength(1);
  expect(container.querySelector("article > p")?.textContent).toBe(update.summary);
  expect(container.querySelector("a")?.textContent).toBe("Open work ↗");
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  await act(async () => details.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  expect(details.textContent).toContain("Reported checksType checking and lint passed.");
  expect(details.textContent).toContain("Not checkedFirst live model comparison");
  await act(async () => details.querySelector("summary")!.click());
  expect(details.open).toBe(false);
  expect(container.querySelectorAll("article")).toHaveLength(1);
});
