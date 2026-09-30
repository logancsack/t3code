/**
 * The runner has no orchestration state. A few checkout services it hosts
 * (review path authorization, setup scripts inside git actions) look up
 * projects by id or root; on a runner those lookups find nothing, and the
 * services fall back to the runner's own checkout root. Whole-model reads are
 * never valid on a runner and die loudly.
 *
 * @module runner/RunnerProjectionSnapshotQuery
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

const noProjections = (method: string) =>
  Effect.die(new Error(`ProjectionSnapshotQuery.${method} is not available on a runner.`));

export const layer = Layer.succeed(
  ProjectionSnapshotQuery,
  ProjectionSnapshotQuery.of({
    getCommandReadModel: () => noProjections("getCommandReadModel"),
    getSnapshot: () => noProjections("getSnapshot"),
    getShellSnapshot: () => noProjections("getShellSnapshot"),
    getArchivedShellSnapshot: () => noProjections("getArchivedShellSnapshot"),
    searchThreads: () => noProjections("searchThreads"),
    getSnapshotSequence: () => noProjections("getSnapshotSequence"),
    getCounts: () => noProjections("getCounts"),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    getFullThreadDiffContext: () => Effect.succeed(Option.none()),
    getThreadShellById: () => Effect.succeed(Option.none()),
    getThreadDetailById: () => Effect.succeed(Option.none()),
    getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
  }),
);
