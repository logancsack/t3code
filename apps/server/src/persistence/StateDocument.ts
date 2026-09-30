/**
 * StateDocument - a small durable text document of the server's state, such as
 * settings.json or keybindings.json.
 *
 * A standalone server keeps it as a file and watches the directory for edits
 * made outside the process. A hub keeps it as a Postgres row (see
 * `HubDocuments`); one process owns a tenant, so every change already passes
 * through the service that wrote it and there is nothing to watch.
 *
 * @module StateDocument
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { HubDatabase } from "./Postgres/HubDatabase.ts";
import { makeHubDocuments } from "./Postgres/HubDocuments.ts";

export type StateDocumentError = PlatformError.PlatformError | SqlError;

export interface StateDocument {
  readonly exists: Effect.Effect<boolean, StateDocumentError>;
  readonly readString: Effect.Effect<string, StateDocumentError>;
  readonly writeStringAtomically: (contents: string) => Effect.Effect<void, StateDocumentError>;
  /**
   * Prepares change detection and returns a stream that emits (debounced)
   * after another writer changes the document.
   */
  readonly watchExternalChanges: Effect.Effect<
    Stream.Stream<void, StateDocumentError>,
    StateDocumentError
  >;
}

const makeFileStateDocument = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  filePath: string,
): StateDocument => ({
  exists: fs.exists(filePath),
  readString: fs.readFileString(filePath),
  writeStringAtomically: (contents) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    ),
  watchExternalChanges: Effect.gen(function* () {
    const directory = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const resolvedPath = path.resolve(filePath);
    yield* fs.makeDirectory(directory, { recursive: true });
    // Debounce watch events so the file is fully written before we read it.
    // Editors emit multiple events per save (truncate, write, rename) and
    // `fs.watch` can fire before the content has been flushed to disk.
    return fs.watch(directory).pipe(
      Stream.filter(
        (event) =>
          event.path === fileName ||
          event.path === filePath ||
          path.resolve(directory, event.path) === resolvedPath,
      ),
      Stream.debounce(Duration.millis(100)),
      Stream.map(() => undefined),
    );
  }),
});

/** The document at `filePath`, or its hub row (keyed by the file name) in hub mode. */
export const make = Effect.fn("StateDocument.make")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hubDatabase = yield* HubDatabase;
  if (hubDatabase === undefined) {
    return makeFileStateDocument(fs, path, filePath);
  }

  const documents = makeHubDocuments(hubDatabase);
  const name = path.basename(filePath);
  return {
    exists: documents.read(name).pipe(Effect.map(Option.isSome)),
    readString: documents.read(name).pipe(
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed,
          onNone: () =>
            Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "StateDocument",
                method: "readString",
                pathOrDescriptor: name,
              }),
            ),
        }),
      ),
    ),
    writeStringAtomically: (contents) => documents.write(name, contents),
    watchExternalChanges: Effect.succeed(Stream.empty),
  } satisfies StateDocument;
});
