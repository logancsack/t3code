import { expect, it } from "vite-plus/test";
import { adaptTaskProgress, type AldoHomeConversation } from "./homeApi";
import { boardFor, needsYouKind } from "./home.logic";
const at = new Date().toISOString();
const base: AldoHomeConversation = {
  ref: "t",
  thread: { environmentId: "aldo-t", threadId: "c" },
  title: "Task",
  repos: [],
  branch: "aldo/t",
  machine: "asleep",
  state: "failed",
  at,
};
const progress = {
  execution: "failed",
  verdict: "unknown",
  next: { owner: "aldo", kind: "delivery" },
  label: "Paused; retry scheduled",
  detail: "Aldo has retained the next step.",
} as const;
it("adapts old and new server responses without asking the user to restart scheduled work", () => {
  const scheduled = adaptTaskProgress({ ...base, progress });
  expect(scheduled.state).toBe("scheduled");
  expect(boardFor([scheduled], Date.now()).working).toEqual([scheduled]);
  expect(needsYouKind(scheduled)).toBeNull();
  expect(adaptTaskProgress(base)).toEqual(base);
  expect(adaptTaskProgress({ ...base, resultState: "unfinished" }).state).toBe("unfinished");
  const question = {
    ...base,
    state: "waiting",
    progress,
    pending: { kind: "question", requestId: "q", questions: [] },
  } as const;
  expect(needsYouKind(adaptTaskProgress(question))).toBe("question");
  expect(
    adaptTaskProgress({
      ...base,
      progress: { ...progress, execution: "stopped", next: { owner: "none", kind: "none" } },
    }).state,
  ).toBe("stopped");
});
