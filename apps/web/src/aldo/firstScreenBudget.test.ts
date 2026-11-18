// @effect-diagnostics nodeBuiltinImport:off - runs CI's scope script in a throwaway repository.
// The home screen's JavaScript budget (scripts/check-first-screen-size.ts) only
// holds if every change that can grow it builds the client: for a while a
// source-only change didn't, and an import that added 290 kB to the first screen
// passed CI and was found when Aldo pinned the client.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

const SCOPE = NodePath.resolve(import.meta.dirname, "../../../../.circleci/scope.sh");
const TRUNK = "aldo/cloud-platform";
const roots: string[] = [];

const git = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync(
    "git",
    ["-c", "user.name=ci", "-c", "user.email=ci@example.com", ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

/** The SCOPE_ variables scope.sh reports for a branch that changes `files`. */
function scopeOf(files: ReadonlyArray<string>): Record<string, string> {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scope-"));
  roots.push(root);
  const origin = NodePath.join(root, "origin.git");
  const work = NodePath.join(root, "work");
  git(root, "init", "-q", "--bare", "-b", TRUNK, origin);
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", TRUNK);
  NodeFS.writeFileSync(NodePath.join(work, "README.md"), "x\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "trunk");
  git(work, "push", "-q", "origin", TRUNK);
  git(work, "checkout", "-q", "-b", "change");
  for (const file of files) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(work, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(work, file), "export {};\n");
  }
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "change");
  NodeChildProcess.execFileSync("bash", [SCOPE, NodePath.join(root, "out")], {
    cwd: work,
    env: { ...process.env, CIRCLE_BRANCH: "change" },
    stdio: "ignore",
  });
  const env = NodeFS.readFileSync(NodePath.join(root, "out", "scope.env"), "utf8");
  return Object.fromEntries(
    [...env.matchAll(/^export (\w+)=(.*)$/gm)].map((match) => [match[1]!, match[2]!]),
  );
}

afterAll(() => {
  for (const root of roots) NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("what CI builds for a change", () => {
  it.each([
    "apps/web/src/aldo/AldoMadeCards.tsx",
    "apps/web/src/components/ChatMarkdown.tsx",
    "apps/web/src/routes/_chat.index.tsx",
    "apps/web/src/index.css",
    "packages/client-runtime/src/work-log/presentation.ts",
  ])("builds the client, and checks its first screen's size, for %s", (file) => {
    expect(scopeOf([file]).SCOPE_CLIENT).toBe("1");
  });

  it("leaves the client alone for a test, which isn't in its bundle", () => {
    const scope = scopeOf(["apps/web/src/aldo/held.logic.test.ts"]);
    expect(scope.SCOPE_CLIENT).toBe("0");
    expect(scope.SCOPE_TEST).toBe("1");
  });
});
