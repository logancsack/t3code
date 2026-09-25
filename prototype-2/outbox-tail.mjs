#!/usr/bin/env node
// Prints outbox events after a sequence: node outbox-tail.mjs <afterSeq> [typeFilter]
import * as fs from "node:fs";
const path = process.env.OUTBOX ?? "/tmp/proto-runner/runner/userdata/runner/outbox.ndjson";
const after = Number(process.argv[2] ?? 0);
const filter = process.argv[3];
const lines = fs
  .readFileSync(path, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
for (const entry of lines) {
  if (entry.sequence <= after) continue;
  if (filter && !entry.event.type.startsWith(filter)) continue;
  const payload = entry.event.payload ?? {};
  console.log(
    entry.sequence,
    entry.event.createdAt.slice(11, 23),
    entry.event.type,
    payload.itemType ?? payload.requestType ?? payload.state ?? "",
  );
}
