/**
 * Hand-built states the captured machine was not in when its fixtures were taken. Each starts from
 * the real thread capture and changes only what the name says, using the V1 schema's own shapes.
 */
import captured from "./thread.real.json" with { type: "json" };

const thread = captured.thread;
const runningTurnId = thread.latestTurn.turnId;
const askedAt = "2026-11-24T06:10:00.000Z";

/** The real question payload this thread once asked, asked again and left unanswered. */
const realQuestion = thread.activities.find((activity) => activity.kind === "user-input.requested");

export const pendingApprovalThread = {
  ...thread,
  activities: [
    ...thread.activities,
    {
      id: "synthetic-approval-requested",
      tone: "approval",
      kind: "approval.requested",
      summary: "Command approval requested",
      payload: {
        requestId: "synthetic-approval-1",
        requestKind: "command",
        detail: "rm -rf build",
      },
      turnId: runningTurnId,
      createdAt: askedAt,
    },
  ],
};

export const pendingUserInputThread = {
  ...thread,
  activities: [
    ...thread.activities,
    {
      ...realQuestion,
      id: "synthetic-user-input-requested",
      payload: { ...(realQuestion?.payload as object), requestId: "synthetic-question-1" },
      turnId: runningTurnId,
      createdAt: askedAt,
    },
  ],
};

export const stoppedTurnThread = {
  ...thread,
  latestTurn: { ...thread.latestTurn, state: "interrupted", completedAt: askedAt },
  session: { ...thread.session, status: "interrupted", activeTurnId: null, updatedAt: askedAt },
};

export const failedTurnThread = {
  ...thread,
  latestTurn: { ...thread.latestTurn, state: "error", completedAt: askedAt },
  session: {
    ...thread.session,
    status: "error",
    activeTurnId: null,
    lastError: "The provider rejected the request.",
    updatedAt: askedAt,
  },
};
