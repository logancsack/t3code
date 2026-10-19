// @effect-diagnostics nodeBuiltinImport:off - a build check that runs on plain Node, with no Effect runtime.
/**
 * Fails when the JavaScript the home screen downloads, gzipped, grows past its
 * budget. Reads a finished Aldo cloud build (`VITE_ALDO_CLOUD=1 vp build`):
 * the scripts index.html loads, and the route chunks the router loads before
 * the home screen first renders, each with every chunk they import.
 *
 *   node scripts/check-first-screen-size.ts [dist]
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

/** About 10% over what the home screen downloaded when this was set: 1,120 kB on 2026-10-19. */
const BUDGET_BYTES = 1_230_000;

/** The home route's own chunks: the chat layout and its index route. */
const HOME_ROUTE_CHUNKS = [
  "src/routes/_chat.tsx?tsr-split=component",
  "src/routes/_chat.index.tsx?tsr-split=component",
];

interface ManifestChunk {
  readonly file: string;
  readonly imports?: ReadonlyArray<string>;
}

const dist = NodePath.resolve(process.argv[2] ?? NodePath.join(import.meta.dirname, "../dist"));
const manifest = JSON.parse(
  NodeFS.readFileSync(NodePath.join(dist, ".vite/manifest.json"), "utf8"),
) as Record<string, ManifestChunk>;
const html = NodeFS.readFileSync(NodePath.join(dist, "index.html"), "utf8");

const keyByFile = new Map(Object.entries(manifest).map(([key, chunk]) => [chunk.file, key]));
const files = new Set<string>();
function addChunk(key: string): void {
  const chunk = manifest[key];
  if (!chunk) {
    throw new Error(`${key} isn't in the build's manifest: update HOME_ROUTE_CHUNKS.`);
  }
  if (files.has(chunk.file)) return;
  files.add(chunk.file);
  for (const imported of chunk.imports ?? []) addChunk(imported);
}

const htmlScripts = [
  ...html.matchAll(
    /<(?:script|link rel="modulepreload")[^>]*\s(?:src|href)="[^"]*?(assets\/[^"]+\.js)"/g,
  ),
].map((match) => match[1]!);
if (htmlScripts.length === 0) throw new Error(`No scripts found in ${dist}/index.html.`);
for (const file of htmlScripts) {
  const key = keyByFile.get(file);
  if (key) addChunk(key);
  else files.add(file);
}
for (const key of HOME_ROUTE_CHUNKS) addChunk(key);

const sizes = [...files]
  .map((file) => ({
    file,
    bytes: NodeZlib.gzipSync(NodeFS.readFileSync(NodePath.join(dist, file))).length,
  }))
  .toSorted((a, b) => b.bytes - a.bytes);
const total = sizes.reduce((sum, { bytes }) => sum + bytes, 0);
const kB = (bytes: number) =>
  `${(bytes / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} kB`;

console.log(
  `The home screen loads ${kB(total)} of JavaScript, gzipped, in ${sizes.length} files ` +
    `(${htmlScripts.length} from index.html); its budget is ${kB(BUDGET_BYTES)}.`,
);
for (const { file, bytes } of sizes.slice(0, 8))
  console.log(`  ${kB(bytes).padStart(10)}  ${file}`);
if (total > BUDGET_BYTES) {
  console.error(
    `\nThat's ${kB(total - BUDGET_BYTES)} over budget. Load what was added when it's first used ` +
      `(a lazy route, component or import()), or, if it belongs on the first screen, raise ` +
      `BUDGET_BYTES in apps/web/scripts/check-first-screen-size.ts.`,
  );
  process.exit(1);
}
