// Creates a freshly migrated SQLite database so the final schema can be
// inspected with `sqlite3 <file> .schema`. Usage: node migrate-temp-sqlite.ts <file>
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeSqlitePersistenceLive } from "../../src/persistence/Layers/Sqlite.ts";

const target = process.argv[2];
if (!target) throw new Error("usage: migrate-temp-sqlite.ts <file>");

await Effect.runPromise(
  Layer.build(makeSqlitePersistenceLive(target)).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
  ),
);
process.stdout.write(`migrated ${target}\n`);
