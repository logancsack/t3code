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

interface RelayWorkflow {
  readonly on?: Readonly<Record<string, unknown>>;
}

it("requires an explicit dispatch before deploying the production relay", () => {
  const workflowPath = NodePath.join(repositoryRoot, ".github", "workflows", "deploy-relay.yml");
  const workflow = YAML.parse(NodeFS.readFileSync(workflowPath, "utf8")) as RelayWorkflow;
  const triggers = workflow.on;

  assert.ok(triggers, "Relay workflow is missing its trigger configuration");
  assert.ok(
    Object.hasOwn(triggers, "workflow_dispatch"),
    "Relay workflow must retain an explicit manual trigger",
  );
  assert.ok(
    !Object.hasOwn(triggers, "push"),
    "Relay workflow must not deploy production from a repository push",
  );
});
