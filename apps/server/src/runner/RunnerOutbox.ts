// @effect-diagnostics nodeBuiltinImport:off -- Append order is the durability contract; synchronous appends keep it trivially ordered.
/**
 * RunnerOutbox - durable, replayable provider runtime event log (prototype).
 *
 * Provider adapters publish runtime events to an in-memory PubSub. A hub on
 * another machine can disconnect, restart, or lag, so the runner writes each
 * event to an append-only NDJSON file with a monotonically increasing
 * `sequence` before it is offered to subscribers. The hub subscribes from its
 * last acknowledged sequence and acknowledges after ingestion; acknowledged
 * events are compacted away.
 *
 * Files under `<stateDir>/runner/`:
 *   - `runner-id`         stable runner identity (survives restarts)
 *   - `outbox.ndjson`     one encoded `RunnerEventEnvelope` per line
 *   - `outbox-ack.json`   `{ "ackedSequence": n }`
 *
 * Guarantees: at-least-once delivery of every event appended before a crash
 * (a torn final line is discarded on load), strictly increasing sequences
 * across restarts, and in-order replay. The hub deduplicates by sequence.
 *
 * @module runner/RunnerOutbox
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { RunnerEventEnvelope } from "./RunnerProtocol.ts";

const EnvelopeLine = Schema.fromJsonString(RunnerEventEnvelope);
const encodeEnvelopeLine = Schema.encodeSync(EnvelopeLine);
const decodeEnvelopeLine = Schema.decodeUnknownSync(EnvelopeLine);
const AckFile = Schema.fromJsonString(Schema.Struct({ ackedSequence: Schema.Number }));
const encodeAckFile = Schema.encodeSync(AckFile);
const decodeAckFile = Schema.decodeUnknownSync(AckFile);

/** Rewrite the file once this many acknowledged lines have accumulated. */
const COMPACT_AFTER_ACKED_LINES = 500;

export interface RunnerOutboxStats {
  readonly runnerId: string;
  readonly bootId: string;
  readonly headSequence: number;
  readonly ackedSequence: number;
  readonly retained: number;
  readonly rejected: number;
}

export class RunnerOutbox extends Context.Service<
  RunnerOutbox,
  {
    readonly append: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
    readonly subscribe: (afterSequence: number) => Stream.Stream<RunnerEventEnvelope>;
    readonly ack: (
      throughSequence: number,
    ) => Effect.Effect<{ readonly ackedSequence: number; readonly retained: number }>;
    readonly stats: Effect.Effect<RunnerOutboxStats>;
  }
>()("t3/runner/RunnerOutbox") {}

interface LoadedOutbox {
  readonly entries: Array<RunnerEventEnvelope>;
  readonly headSequence: number;
  readonly ackedSequence: number;
  readonly discardedLines: number;
}

function readAckedSequence(ackPath: string): number {
  try {
    return decodeAckFile(NodeFS.readFileSync(ackPath, "utf8")).ackedSequence;
  } catch {
    return 0;
  }
}

function loadOutbox(outboxPath: string, ackPath: string): LoadedOutbox {
  const ackedSequence = readAckedSequence(ackPath);
  const entries: Array<RunnerEventEnvelope> = [];
  let headSequence = ackedSequence;
  let discardedLines = 0;
  let raw = "";
  try {
    raw = NodeFS.readFileSync(outboxPath, "utf8");
  } catch {
    raw = "";
  }
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const envelope = decodeEnvelopeLine(line);
      headSequence = Math.max(headSequence, envelope.sequence);
      if (envelope.sequence > ackedSequence) entries.push(envelope);
    } catch {
      // A crash can tear the final line; anything unparseable is dropped.
      discardedLines += 1;
    }
  }
  entries.sort((left, right) => left.sequence - right.sequence);
  return { entries, headSequence, ackedSequence, discardedLines };
}

function readOrCreateRunnerId(idPath: string): string {
  try {
    const existing = NodeFS.readFileSync(idPath, "utf8").trim();
    if (existing.length > 0) return existing;
  } catch {
    // fall through
  }
  const created = `runner-${NodeCrypto.randomUUID()}`;
  NodeFS.writeFileSync(idPath, `${created}\n`, { mode: 0o600 });
  return created;
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const dir = NodePath.join(config.stateDir, "runner");
  NodeFS.mkdirSync(dir, { recursive: true });
  const outboxPath = NodePath.join(dir, "outbox.ndjson");
  const ackPath = NodePath.join(dir, "outbox-ack.json");
  const runnerId = readOrCreateRunnerId(NodePath.join(dir, "runner-id"));
  const bootId = `boot-${NodeCrypto.randomUUID()}`;
  const fsyncEnabled = process.env.T3CODE_RUNNER_OUTBOX_FSYNC !== "0";
  // Evidence/debug switch: keep acknowledged lines instead of compacting.
  const keepAcked = process.env.T3CODE_RUNNER_OUTBOX_KEEP === "1";

  const loaded = loadOutbox(outboxPath, ackPath);
  const entries = loaded.entries;
  let headSequence = loaded.headSequence;
  let ackedSequence = loaded.ackedSequence;
  let ackedLinesSinceCompaction = 0;
  let rejected = 0;
  yield* Effect.logInfo("runner outbox loaded", {
    runnerId,
    bootId,
    headSequence,
    ackedSequence,
    retained: entries.length,
    discardedLines: loaded.discardedLines,
  });

  let fd = NodeFS.openSync(outboxPath, "a");
  yield* Effect.addFinalizer(() => Effect.sync(() => NodeFS.closeSync(fd)));

  const live = yield* PubSub.unbounded<RunnerEventEnvelope>();

  const compact = () => {
    const tmpPath = `${outboxPath}.tmp`;
    const body = entries.map((entry) => `${encodeEnvelopeLine(entry)}\n`).join("");
    NodeFS.writeFileSync(tmpPath, body);
    NodeFS.closeSync(fd);
    NodeFS.renameSync(tmpPath, outboxPath);
    fd = NodeFS.openSync(outboxPath, "a");
    ackedLinesSinceCompaction = 0;
  };

  const append = (event: ProviderRuntimeEvent) =>
    Effect.suspend(() => {
      const envelope: RunnerEventEnvelope = { sequence: headSequence + 1, bootId, event };
      let line: string;
      try {
        line = `${encodeEnvelopeLine(envelope)}\n`;
      } catch (cause) {
        // An event that does not satisfy the wire schema could never be
        // delivered; count it instead of poisoning every subscription.
        rejected += 1;
        return Effect.logWarning("runner outbox rejected an event that fails the wire schema", {
          eventType: event.type,
          eventId: event.eventId,
          cause: String(cause),
        });
      }
      headSequence = envelope.sequence;
      NodeFS.writeSync(fd, line);
      if (fsyncEnabled) NodeFS.fsyncSync(fd);
      entries.push(envelope);
      return PubSub.publish(live, envelope).pipe(Effect.asVoid);
    });

  const subscribe = (afterSequence: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before snapshotting the backlog so no append can fall
        // between replay and the live tail; overlap is filtered by sequence.
        const subscription = yield* PubSub.subscribe(live);
        const backlog = entries.filter((entry) => entry.sequence > afterSequence);
        const replayedThrough = backlog.at(-1)?.sequence ?? afterSequence;
        return Stream.concat(
          Stream.fromIterable(backlog),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((entry) => entry.sequence > replayedThrough),
          ),
        );
      }),
    );

  const ack = (throughSequence: number) =>
    Effect.sync(() => {
      const next = Math.min(Math.max(ackedSequence, throughSequence), headSequence);
      if (next > ackedSequence) {
        ackedSequence = next;
        let dropped = 0;
        while (entries.length > 0 && entries[0]!.sequence <= ackedSequence) {
          entries.shift();
          dropped += 1;
        }
        ackedLinesSinceCompaction += dropped;
        NodeFS.writeFileSync(ackPath, encodeAckFile({ ackedSequence }));
        if (
          !keepAcked &&
          (ackedLinesSinceCompaction >= COMPACT_AFTER_ACKED_LINES || entries.length === 0)
        ) {
          compact();
        }
      }
      return { ackedSequence, retained: entries.length };
    });

  const stats = Effect.sync(
    (): RunnerOutboxStats => ({
      runnerId,
      bootId,
      headSequence,
      ackedSequence,
      retained: entries.length,
      rejected,
    }),
  );

  return RunnerOutbox.of({ append, subscribe, ack, stats });
});

export const layer = Layer.effect(RunnerOutbox, make);
