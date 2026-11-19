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

it("places recorded user-owned next steps in Needs you while preserving execution and Stop", () => {
  for (const state of ["done", "working", "failed"] as const) {
    const waiting = adaptTaskProgress({
      ...base,
      state,
      progress: { ...progress, next: { owner: "you", kind: "release" } },
    });
    expect(waiting.state).toBe("waiting");
    expect(waiting.progress?.execution).toBe("failed");
    expect(needsYouKind(waiting)).toBe("waiting");
    expect(boardFor([waiting], Date.now()).needsYou).toEqual([waiting]);
    expect(boardFor([waiting], Date.now()).done).toEqual([]);
  }
  const stopped = adaptTaskProgress({
    ...base,
    state: "stopped",
    progress: { ...progress, next: { owner: "you", kind: "input" } },
  });
  expect(stopped.state).toBe("stopped");
  expect(needsYouKind(stopped)).toBeNull();
});
