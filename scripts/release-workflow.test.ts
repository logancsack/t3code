// @effect-diagnostics nodeBuiltinImport:off
import { assert, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as YAML from "yaml";

const repositoryRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);

interface ReleaseWorkflow {
  readonly on?: Readonly<Record<string, unknown>>;
}

it("does not publish public nightlies on a schedule", () => {
  const workflowPath = NodePath.join(repositoryRoot, ".github", "workflows", "release.yml");
  const workflow = YAML.parse(NodeFS.readFileSync(workflowPath, "utf8")) as ReleaseWorkflow;
  const triggers = workflow.on;

  assert.ok(triggers, "Release workflow is missing its trigger configuration");
  assert.ok(
    Object.hasOwn(triggers, "workflow_dispatch"),
    "Release workflow must retain an explicit manual trigger",
  );
  assert.ok(
    !Object.hasOwn(triggers, "schedule"),
    "Release workflow must not publish public nightlies automatically",
  );
});
