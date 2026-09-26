// @effect-diagnostics nodeBuiltinImport:off -- Append order and fsync-before-publish are the durability contract; synchronous node:sqlite keeps both trivially true.
/**
 * RunnerOutbox - the runner's durable, replayable provider event log.
 *
 * Provider adapters publish runtime events to in-memory streams, but the hub
 * that ingests them lives on another machine and can disconnect, restart or
 * lag. Every event is appended to a SQLite table on the machine's state disk
 * with a strictly increasing `sequence` and committed (WAL, `synchronous =
 * FULL`, so the commit is fsynced) before any subscriber sees it. The hub
 * subscribes from its cursor and acknowledges once the events' effects are
 * durable on the hub; acknowledged rows are deleted.
 *
 * Guarantees:
 * - At-least-once, in-order delivery of every committed event.
 * - Sequences never repeat for this outbox (`runnerId`), across restarts.
 * - Event ids are unique among retained rows; a duplicate id from an adapter
 *   is suffixed with its sequence, so hub-side deterministic ingestion ids
 *   never collide.
 * - Retention: when more than `maxRetained` events are unacknowledged, the
 *   oldest are dropped and `firstRetainedSequence` moves past them. A hub
 *   whose cursor is below it has lost events and must resynchronize.
 *
 * @module runner/RunnerOutbox
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { EventId, type ProviderRuntimeEvent } from "@t3tools/contracts";
import { RunnerEventEnvelope } from "@t3tools/contracts/runner";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";

const EnvelopeJson = Schema.fromJsonString(RunnerEventEnvelope);
const encodeEnvelopeJson = Schema.encodeSync(EnvelopeJson);
const decodeEnvelopeJson = Schema.decodeUnknownSync(EnvelopeJson);

/** Unacknowledged events kept before the oldest are dropped. */
export const DEFAULT_MAX_RETAINED_EVENTS = 200_000;
const REPLAY_PAGE_SIZE = 500;

export interface RunnerOutboxStats {
  readonly runnerId: string;
  readonly bootId: string;
  readonly headSequence: number;
  readonly ackedSequence: number;
  readonly firstRetainedSequence: number;
  readonly retained: number;
  readonly rejected: number;
  readonly dropped: number;
}

export interface RunnerOutboxShape {
  readonly append: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  /** Retained events with `sequence > afterSequence`, then live events, without gaps or overlap. */
  readonly subscribe: (afterSequence: number) => Stream.Stream<RunnerEventEnvelope>;
  readonly ack: (
    throughSequence: number,
  ) => Effect.Effect<{ readonly ackedSequence: number; readonly retained: number }>;
  readonly stats: Effect.Effect<RunnerOutboxStats>;
}

export class RunnerOutbox extends Context.Service<RunnerOutbox, RunnerOutboxShape>()(
  "t3/runner/RunnerOutbox",
) {}

export interface RunnerOutboxOptions {
  readonly databasePath: string;
  readonly maxRetained?: number;
}

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS runner_outbox (
    sequence INTEGER PRIMARY KEY,
    boot_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runner_outbox_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export const makeWithOptions = (options: RunnerOutboxOptions) =>
  Effect.gen(function* () {
    NodeFS.mkdirSync(NodePath.dirname(options.databasePath), { recursive: true });
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const database = new NodeSqlite.DatabaseSync(options.databasePath);
        database.exec(SCHEMA);
        return database;
      }),
      (database) => Effect.sync(() => database.close()),
    );
    const maxRetained = options.maxRetained ?? DEFAULT_MAX_RETAINED_EVENTS;

    const readState = db.prepare("SELECT value FROM runner_outbox_state WHERE key = ?");
    const writeState = db.prepare(
      "INSERT INTO runner_outbox_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    );
    const stateValue = (key: string): string | undefined => {
      const row = readState.get(key) as { value?: unknown } | undefined;
      return typeof row?.value === "string" ? row.value : undefined;
    };
    const numericState = (key: string) => Number(stateValue(key) ?? "0") || 0;

    const runnerId =
      stateValue("runner_id") ??
      (() => {
        const created = `runner-${NodeCrypto.randomUUID()}`;
        writeState.run("runner_id", created);
        return created;
      })();
    const bootId = `boot-${NodeCrypto.randomUUID()}`;

    const maxRow = db.prepare("SELECT MAX(sequence) AS max FROM runner_outbox").get() as {
      max: number | null;
    };
    let headSequence = Math.max(numericState("head_sequence"), maxRow.max ?? 0);
    let ackedSequence = numericState("acked_sequence");
    let firstRetainedSequence = Math.max(
      numericState("first_retained_sequence"),
      ackedSequence + 1,
    );
    let rejected = 0;
    let dropped = 0;

    const insertEvent = db.prepare(
      "INSERT INTO runner_outbox (sequence, boot_id, thread_id, event_id, event_type, envelope_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const eventIdTaken = db.prepare("SELECT 1 AS taken FROM runner_outbox WHERE event_id = ?");
    const countRetained = db.prepare("SELECT COUNT(*) AS count FROM runner_outbox");
    const deleteThrough = db.prepare("DELETE FROM runner_outbox WHERE sequence <= ?");
    const selectPage = db.prepare(
      "SELECT envelope_json FROM runner_outbox WHERE sequence > ? ORDER BY sequence ASC LIMIT ?",
    );
    const selectOldest = db.prepare(
      "SELECT sequence FROM runner_outbox ORDER BY sequence ASC LIMIT 1 OFFSET ?",
    );

    const retainedCount = () => (countRetained.get() as { count: number }).count;

    const transaction = <A>(body: () => A): A => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = body();
        db.exec("COMMIT");
        return result;
      } catch (cause) {
        db.exec("ROLLBACK");
        throw cause;
      }
    };

    /** Drops the oldest unacknowledged events beyond the retention bound. */
    const enforceRetention = () => {
      const excess = retainedCount() - maxRetained;
      if (excess <= 0) return;
      const boundary = selectOldest.get(excess - 1) as { sequence: number } | undefined;
      if (!boundary) return;
      transaction(() => {
        deleteThrough.run(boundary.sequence);
        firstRetainedSequence = boundary.sequence + 1;
        writeState.run("first_retained_sequence", String(firstRetainedSequence));
      });
      dropped += excess;
    };

    const live = yield* PubSub.unbounded<RunnerEventEnvelope>();

    yield* Effect.logInfo("runner outbox opened", {
      runnerId,
      bootId,
      headSequence,
      ackedSequence,
      retained: retainedCount(),
    });

    const append: RunnerOutboxShape["append"] = (event) =>
      Effect.suspend(() => {
        const sequence = headSequence + 1;
        const eventId = eventIdTaken.get(event.eventId)
          ? EventId.make(`${event.eventId}:${sequence}`)
          : event.eventId;
        const envelope: RunnerEventEnvelope = {
          sequence,
          bootId,
          event: eventId === event.eventId ? event : { ...event, eventId },
        };
        let envelopeJson: string;
        try {
          envelopeJson = encodeEnvelopeJson(envelope);
        } catch (cause) {
          // An event that fails the wire schema could never be delivered;
          // count it rather than poisoning every subscription.
          rejected += 1;
          return Effect.logWarning("runner outbox rejected an event that fails the wire schema", {
            eventType: event.type,
            eventId: event.eventId,
            cause: String(cause).slice(0, 400),
          });
        }
        transaction(() => {
          insertEvent.run(
            sequence,
            bootId,
            event.threadId,
            eventId,
            event.type,
            envelopeJson,
            event.createdAt,
          );
          writeState.run("head_sequence", String(sequence));
        });
        headSequence = sequence;
        enforceRetention();
        return PubSub.publish(live, envelope).pipe(Effect.asVoid);
      });

    const readAfter = (afterSequence: number): Array<RunnerEventEnvelope> =>
      (selectPage.all(afterSequence, REPLAY_PAGE_SIZE) as Array<{ envelope_json: string }>).map(
        (row) => decodeEnvelopeJson(row.envelope_json),
      );

    const subscribe: RunnerOutboxShape["subscribe"] = (afterSequence) =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before reading the backlog so no append falls between
          // replay and the live tail; overlap is filtered by sequence.
          const subscription = yield* PubSub.subscribe(live);
          let cursor = afterSequence;
          const backlog = Stream.unfold(afterSequence, (after) =>
            Effect.sync(() => {
              const page = readAfter(after);
              const last = page.at(-1)?.sequence;
              if (last === undefined) return undefined;
              cursor = last;
              return [page, last] as const;
            }),
          ).pipe(Stream.flatMap((page) => Stream.fromIterable(page)));
          return Stream.concat(
            backlog,
            Stream.suspend(() =>
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((entry) => entry.sequence > cursor),
              ),
            ),
          );
        }),
      );

    const ack: RunnerOutboxShape["ack"] = (throughSequence) =>
      Effect.sync(() => {
        const next = Math.min(Math.max(ackedSequence, throughSequence), headSequence);
        if (next > ackedSequence) {
          transaction(() => {
            deleteThrough.run(next);
            writeState.run("acked_sequence", String(next));
          });
          ackedSequence = next;
          firstRetainedSequence = Math.max(firstRetainedSequence, next + 1);
        }
        return { ackedSequence, retained: retainedCount() };
      });

    const stats = Effect.sync(
      (): RunnerOutboxStats => ({
        runnerId,
        bootId,
        headSequence,
        ackedSequence,
        firstRetainedSequence,
        retained: retainedCount(),
        rejected,
        dropped,
      }),
    );

    return RunnerOutbox.of({ append, subscribe, ack, stats });
  });

/** `<stateDir>/runner/outbox.sqlite` on the machine's state disk. */
export const layer = Layer.effect(
  RunnerOutbox,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return yield* makeWithOptions({
      databasePath: NodePath.join(config.stateDir, "runner", "outbox.sqlite"),
    });
  }),
);
