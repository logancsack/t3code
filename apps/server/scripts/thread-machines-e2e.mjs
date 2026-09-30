#!/usr/bin/env node
// @ts-check
/**
 * End-to-end check of hub mode against a real runner process, on loopback.
 *
 * Starts `t3 runner` for one thread (port 4422) and a hub
 * (`T3CODE_SERVER_MODE=hub`, port 4421) that reaches it through the static
 * development machine directory (`T3CODE_RUNNER_URL`), then drives the hub's
 * public HTTP and WebSocket API like a client:
 *
 *   a. project and thread creation: the hub assigns the thread checkout path
 *   b. a turn that edits notes.txt on the runner, with an approval round trip
 *   c. the turn diff through the hub
 *   d. the same diff with the runner stopped (served from the hub cache)
 *   e. a runner restart (new boot), then a turn that resumes the session
 *   f. a hub restart; history and diffs survive
 *
 * Along the way it checks the hub-mode client contract: the threadMachines
 * capability, selectable provider snapshots before any runner reported (and
 * the persisted report after a restart), the provider settings push, the
 * thread shell's machine state and thread-machine.state activities,
 * vcs.listRefs on the virtual project root and on the thread's checkout, and
 * threadMachines.pause / threadMachines.wake.
 *
 * By default the hub persists to SQLite in its base directory. With
 * `--hub-database-url` it runs as production hubs do: on Postgres, for a fresh
 * tenant with a random secret key, seeded through `t3 hub import` from a
 * standalone state directory after `t3 hub migrate` (with a separate
 * migration role when `--hub-database-admin-url` is given; tenant processes
 * never get it), and restarting on an empty base directory. Use a disposable database; the tenant's rows are left in it.
 *
 * It uses the real provider through T3's adapter on the runner, with this
 * machine's existing provider login, for two short turns (plus title
 * generation). The model defaults to claude-haiku-4-5 on the claudeAgent
 * instance. Nothing outside the temporary directory (and the hub database)
 * is written; processes started here are stopped by PID on exit.
 *
 * With `--dist <dir>` every process runs from a built server package instead
 * of the source: an extracted release artifact (`<dir>/dist/bin.mjs`) or the
 * `bin.mjs` itself.
 *
 *   node apps/server/scripts/thread-machines-e2e.mjs [--keep] [--model <id>]
 *     [--hub-database-url <url> [--hub-database-admin-url <url>]] [--dist <dir>]
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const HUB_PORT = 4421;
const RUNNER_PORT = 4422;
const HUB = `http://127.0.0.1:${HUB_PORT}`;

const args = process.argv.slice(2);
const flagValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const DIST = flagValue("--dist", undefined);
const BIN = DIST
  ? NodePath.resolve(DIST.endsWith(".mjs") ? DIST : NodePath.join(DIST, "dist", "bin.mjs"))
  : NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../src/bin.ts");
const KEEP = args.includes("--keep");
const MODEL = { instanceId: "claudeAgent", model: flagValue("--model", "claude-haiku-4-5") };
const HUB_DATABASE_URL = flagValue("--hub-database-url", undefined);
const HUB_DATABASE_ADMIN_URL = flagValue("--hub-database-admin-url", undefined);

const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-thread-machines-e2e-"));
const threadId = `thread-${NodeCrypto.randomUUID()}`;
const projectId = `project-${NodeCrypto.randomUUID()}`;
const checkoutRoot = NodePath.join(root, "t");
const checkout = NodePath.join(checkoutRoot, threadId);
const runnerToken = NodeCrypto.randomBytes(24).toString("base64url");
const logs = NodePath.join(root, "logs");
// The settings every process starts with; titles are generated on the
// thread's runner with the same cheap model.
const SETTINGS = JSON.stringify({
  enableProviderUpdateChecks: false,
  textGenerationModelSelection: MODEL,
});

const stamp = () => new Date().toISOString().slice(11, 23);
const log = (...values) => console.log(`[${stamp()}]`, ...values);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const id = () => NodeCrypto.randomUUID();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

// ── Processes ─────────────────────────────────────────────────────────────

const children = new Map();
const baseEnv = {
  ...process.env,
  T3CODE_TELEMETRY_ENABLED: "false",
  T3CODE_NO_BROWSER: "true",
  T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
};

function start(name, cwd, argv, env) {
  const out = NodeFS.openSync(NodePath.join(logs, `${name}.log`), "a");
  const child = NodeChildProcess.spawn(process.execPath, [BIN, ...argv], {
    cwd,
    env: { ...baseEnv, ...env },
    stdio: ["ignore", out, out],
  });
  children.set(name, child);
  return child;
}

async function stop(name) {
  const child = children.get(name);
  if (!child || child.exitCode !== null) return;
  const started = Date.now();
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(undefined);
    }, 15_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
  children.delete(name);
  log(`${name} stopped in ${Date.now() - started} ms`);
}

async function waitFor(description, probe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await probe();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${description}: ${String(last?.message ?? last)}`);
}

const listening = (port) =>
  NodeChildProcess.execFileSync("ss", ["-H", "-ltn", `sport = :${port}`], {
    encoding: "utf8",
  }).trim().length > 0;

async function startRunner() {
  const started = Date.now();
  start(
    "runner",
    checkout,
    ["runner", "--base-dir", NodePath.join(root, "runner"), "--port", `${RUNNER_PORT}`],
    {
      T3CODE_RUNNER_THREAD_ID: threadId,
      T3CODE_RUNNER_CHECKOUT: checkout,
      T3CODE_RUNNER_TOKEN: runnerToken,
      T3CODE_RUNNER_DRIVERS: "claudeAgent",
    },
  );
  await waitFor("runner to listen", () => listening(RUNNER_PORT));
  log(`runner listening in ${Date.now() - started} ms`);
}

/**
 * Postgres hub settings: a fresh tenant and secret key per run (never printed).
 * As on the hub host, tenant processes get only the runtime URL; the admin URL
 * is used by `t3 hub migrate` alone.
 */
const hubDatabaseEnv = HUB_DATABASE_URL
  ? {
      T3CODE_HUB_DATABASE_URL: HUB_DATABASE_URL,
      T3CODE_HUB_TENANT_ID: `e2e-${NodeCrypto.randomUUID()}`,
      T3CODE_HUB_SECRET_KEY: NodeCrypto.randomBytes(32).toString("base64"),
    }
  : {};
const hubEnv = {
  T3CODE_SERVER_MODE: "hub",
  T3CODE_RUNNER_URL: `ws://127.0.0.1:${RUNNER_PORT}/runner/ws`,
  T3CODE_RUNNER_TOKEN: runnerToken,
  T3CODE_HUB_CHECKOUT_ROOT: checkoutRoot,
  T3CODE_HUB_PUBLIC_URL: HUB,
  ...hubDatabaseEnv,
};

const t3 = (argv, env) =>
  NodeChildProcess.execFileSync(process.execPath, [BIN, ...argv], {
    encoding: "utf8",
    env: { ...baseEnv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * Postgres hubs keep settings in the database: import a standalone state
 * directory holding them (its state.sqlite is created by a standalone command).
 */
function seedHubDatabase() {
  // The hub host migrates once with the migration role before any tenant starts.
  const migrateDir = NodePath.join(root, "migrate");
  NodeFS.mkdirSync(migrateDir, { recursive: true });
  const migrated = t3(["hub", "migrate", "--base-dir", migrateDir], {
    T3CODE_SERVER_MODE: "hub",
    T3CODE_HUB_DATABASE_URL: HUB_DATABASE_URL,
    ...(HUB_DATABASE_ADMIN_URL ? { T3CODE_HUB_DATABASE_ADMIN_URL: HUB_DATABASE_ADMIN_URL } : {}),
    T3CODE_HUB_TENANT_ID: "00000000-0000-4000-8000-000000000000",
    T3CODE_HUB_SECRET_KEY: hubDatabaseEnv.T3CODE_HUB_SECRET_KEY,
  });
  check("t3 hub migrate", /hub migrations|nothing to apply/.test(migrated));
  const seedDir = NodePath.join(root, "seed");
  t3(["auth", "session", "list", "--base-dir", seedDir], {});
  const report = t3(["hub", "import", NodePath.join(seedDir, "userdata")], hubDatabaseEnv);
  const documents = /documents: (\d+)/.exec(report)?.[1];
  check(
    "hub tenant seeded through t3 hub import",
    Number(documents) >= 1,
    `${documents} documents`,
  );
}

let hubToken = "";
let hubBoots = 0;
async function startHub() {
  const started = Date.now();
  // A Postgres hub's base directory is disposable: every boot gets an empty one.
  hubBoots += 1;
  const hubDir = NodePath.join(root, HUB_DATABASE_URL ? `hub-${hubBoots}` : "hub");
  NodeFS.mkdirSync(hubDir, { recursive: true });
  start("hub", hubDir, ["--base-dir", hubDir, "--port", `${HUB_PORT}`], hubEnv);
  await waitFor("hub to listen", () => listening(HUB_PORT));
  if (!hubToken) {
    hubToken = t3(
      ["auth", "session", "issue", "--base-dir", hubDir, "--token-only"],
      hubEnv,
    ).trim();
  }
  await waitFor(
    "hub API",
    async () => (await http("GET", "/api/orchestration/shell", undefined, 2_000)) !== undefined,
  );
  log(`hub ready in ${Date.now() - started} ms`);
}

// ── Hub client ────────────────────────────────────────────────────────────

async function http(method, route, body, timeoutMs = 60_000) {
  const response = await fetch(`${HUB}${route}`, {
    method,
    // A request that reaches a server between listen and route registration
    // is never answered; bound every request so probes retry instead.
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Bearer ${hubToken}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${route} -> ${response.status}: ${text.slice(0, 400)}`);
  return text.length > 0 ? JSON.parse(text) : null;
}

const dispatch = (command) => http("POST", "/api/orchestration/dispatch", command);
const thread = async () => (await http("GET", `/api/orchestration/threads/${threadId}`)).thread;

/** One RPC over the hub's /ws endpoint (Effect RPC JSON wire format). */
async function rpc(tag, payload) {
  const { ticket } = await http("POST", "/api/auth/websocket-ticket");
  const socket = new WebSocket(
    `${HUB.replace(/^http/, "ws")}/ws?wsTicket=${encodeURIComponent(ticket)}`,
  );
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`rpc ${tag} timed out`)), 60_000);
    socket.addEventListener("open", () =>
      socket.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] })),
    );
    socket.addEventListener("message", (message) => {
      const decoded = JSON.parse(String(message.data));
      for (const entry of Array.isArray(decoded) ? decoded : [decoded]) {
        if (entry._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
        if (entry._tag === "Exit" && String(entry.requestId) === "1") {
          clearTimeout(timer);
          socket.close();
          if (entry.exit._tag === "Success") resolve(entry.exit.value);
          else reject(new Error(`rpc ${tag} failed: ${JSON.stringify(entry.exit).slice(0, 600)}`));
        }
      }
    });
    socket.addEventListener("error", () => reject(new Error(`rpc ${tag} socket error`)));
  });
}

/** Starts a turn, approves every request, and waits until it settles. */
async function runTurn(text, timeoutMs = 240_000) {
  const before = await thread();
  const seen = new Set(before.activities.map((activity) => activity.id));
  const approved = new Set();
  const started = Date.now();
  await dispatch({
    type: "thread.turn.start",
    commandId: id(),
    threadId,
    message: { messageId: `msg-${id()}`, role: "user", text, attachments: [] },
    modelSelection: MODEL,
    runtimeMode: "approval-required",
    interactionMode: "default",
    createdAt: now(),
  });
  log(`turn started: ${JSON.stringify(text)}`);
  return await waitFor(
    "turn to settle",
    async () => {
      const current = await thread();
      for (const activity of current.activities) {
        if (seen.has(activity.id)) continue;
        seen.add(activity.id);
        log(`  activity ${activity.kind}: ${activity.summary}`);
        const requestId = activity.payload?.requestId;
        if (activity.kind === "approval.requested" && requestId && !approved.has(requestId)) {
          approved.add(requestId);
          const t0 = Date.now();
          await dispatch({
            type: "thread.approval.respond",
            commandId: id(),
            threadId,
            requestId,
            decision: "accept",
            createdAt: now(),
          });
          log(`  approved ${requestId} in ${Date.now() - t0} ms`);
        }
      }
      const latest = current.latestTurn;
      const settled =
        latest &&
        latest.turnId !== before.latestTurn?.turnId &&
        latest.state !== "running" &&
        (current.session?.activeTurnId ?? null) === null;
      if (!settled) return undefined;
      log(`turn ${latest.turnId} ${latest.state} after ${Date.now() - started} ms`);
      return current;
    },
    timeoutMs,
  );
}

// ── Scenario ──────────────────────────────────────────────────────────────

async function main() {
  NodeFS.mkdirSync(logs, { recursive: true });
  NodeFS.mkdirSync(checkout, { recursive: true });
  for (const dir of ["runner", HUB_DATABASE_URL ? "seed" : "hub"]) {
    NodeFS.mkdirSync(NodePath.join(root, dir, "userdata"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, dir, "userdata", "settings.json"), SETTINGS);
  }
  const git = (...gitArgs) =>
    NodeChildProcess.execFileSync(
      "git",
      ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", ...gitArgs],
      {
        cwd: checkout,
        encoding: "utf8",
      },
    );
  git("init", "--initial-branch=main");
  NodeFS.writeFileSync(NodePath.join(checkout, "notes.txt"), "hello from the runner\n");
  git("add", ".");
  git("commit", "-m", "initial");
  log(`workspace ${root}; hub persistence: ${HUB_DATABASE_URL ? "Postgres" : "SQLite"}; ${BIN}`);

  if (HUB_DATABASE_URL) seedHubDatabase();
  await startRunner();
  await startHub();

  // a. The hub assigns the per-thread checkout NodePath.
  await dispatch({
    type: "project.create",
    commandId: id(),
    projectId,
    title: "Thread machines e2e",
    workspaceRoot: "/anywhere/the/client/says",
    defaultModelSelection: MODEL,
    createdAt: now(),
  });
  await dispatch({
    type: "thread.create",
    commandId: id(),
    threadId,
    projectId,
    title: "New thread",
    modelSelection: MODEL,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: now(),
  });
  const created = await thread();
  check("thread checkout path", created.worktreePath === checkout, created.worktreePath);

  // The hub-mode client contract before any machine ran.
  const config = await rpc("server.getConfig", {});
  check(
    "threadMachines capability without pullRequests",
    config.environment.capabilities.threadMachines === true &&
      config.environment.capabilities.pullRequests === undefined,
  );
  const pending = config.providers.find((provider) => provider.instanceId === "claudeAgent");
  check(
    "provider selectable before any runner reported",
    pending?.enabled === true && pending.installed && pending.status === "ready",
    `${pending?.status} / auth ${pending?.auth.status}`,
  );
  const projectRefs = await rpc("vcs.listRefs", { cwd: `/workspace/p/${projectId}` });
  check(
    "blank project lists no refs without a machine",
    projectRefs.isRepo === false && projectRefs.refs.length === 0,
  );
  const shell = await http("GET", "/api/orchestration/shell");
  const project = (shell.projects ?? shell.snapshot?.projects ?? []).find(
    (entry) => entry.id === projectId,
  );
  check(
    "virtual project root",
    project?.workspaceRoot === `/workspace/p/${projectId}`,
    project?.workspaceRoot,
  );

  // b. A turn edits the runner's checkout, with an approval round trip.
  const first = await runTurn(
    "Append exactly one line, 'edited by the runner', to notes.txt using your file editing tool. Then reply with just: done",
  );
  const notes = NodeFS.readFileSync(NodePath.join(checkout, "notes.txt"), "utf8");
  check("turn 1 edited the runner checkout", notes.includes("edited by the runner"));
  // The checkpoint is captured just after the turn settles.
  const captured = await waitFor("turn 1 checkpoint", async () => {
    const current = await thread();
    return current.checkpoints.some(
      (entry) => entry.checkpointTurnCount === 1 && entry.status === "ready",
    )
      ? current
      : undefined;
  });
  const checkpoint = captured.checkpoints.find((entry) => entry.checkpointTurnCount === 1);
  check(
    "turn 1 checkpoint captured",
    checkpoint?.status === "ready" && checkpoint.files.some((file) => file.path === "notes.txt"),
    JSON.stringify(checkpoint?.files ?? []),
  );

  // The machine, the settings push, and the runner's provider report.
  const shellAfterTurn = await http("GET", "/api/orchestration/shell");
  const shellThread = (shellAfterTurn.threads ?? shellAfterTurn.snapshot?.threads ?? []).find(
    (entry) => entry.id === threadId,
  );
  check(
    "thread shell carries the machine state",
    shellThread?.machine?.state === "running",
    JSON.stringify(shellThread?.machine ?? null),
  );
  check(
    "thread-machine.state activity recorded",
    first.activities.some(
      (activity) =>
        activity.kind === "thread-machine.state" && activity.payload?.state === "running",
    ),
  );
  check(
    "provider settings pushed to the runner",
    /runner rpc configure[\s\S]{0,120}claudeAgent/.test(
      NodeFS.readFileSync(NodePath.join(logs, "runner.log"), "utf8"),
    ),
  );
  const reported = (await rpc("server.getConfig", {})).providers.find(
    (provider) => provider.instanceId === "claudeAgent",
  );
  check(
    "runner reported the provider",
    reported?.auth.status === "authenticated",
    reported?.auth.status,
  );
  const threadRefs = await rpc("vcs.listRefs", { cwd: checkout });
  check(
    "thread checkout lists its refs",
    threadRefs.refs.some((ref) => ref.name === "main"),
    threadRefs.refs.map((ref) => ref.name).join(","),
  );
  // c. The diff through the hub.
  const t0 = Date.now();
  const diff = await rpc("orchestration.getTurnDiff", {
    threadId,
    fromTurnCount: 0,
    toTurnCount: 1,
  });
  check(
    "turn diff through the hub",
    diff.diff.includes("+edited by the runner"),
    `${Date.now() - t0} ms`,
  );

  // d. With the runner stopped, the hub still serves the diff and git status.
  // The first turn's title is generated on the runner; let it finish first.
  await waitFor(
    "title generation",
    async () => ((await thread()).title !== "New thread" ? true : undefined),
    90_000,
  ).catch((error) => log(`title not generated before the runner stopped: ${error.message}`));
  await stop("runner");
  const t1 = Date.now();
  const cached = await rpc("orchestration.getTurnDiff", {
    threadId,
    fromTurnCount: 0,
    toTurnCount: 1,
  });
  check("turn diff with the runner stopped", cached.diff === diff.diff, `${Date.now() - t1} ms`);

  // e. A new runner boot; the next turn resumes the provider session.
  await startRunner();
  const second = await runTurn(
    "Which line did you add to notes.txt earlier? Reply with only that line.",
  );
  const answer = second.messages.findLast((message) => message.role === "assistant")?.text ?? "";
  check(
    "turn 2 resumed with memory of turn 1",
    /edited by the runner/i.test(answer),
    JSON.stringify(answer.slice(0, 120)),
  );
  const runnerLog = NodeFS.readFileSync(NodePath.join(logs, "runner.log"), "utf8");
  check(
    "runner resumed from the hub's resume cursor",
    /runner rpc startSession[\s\S]{0,200}resume: true/.test(runnerLog),
  );

  // Releasing the machine waits for work still using it (the title, for one).
  const paused = await waitFor(
    "threadMachines.pause",
    () => rpc("threadMachines.pause", { threadId }),
    60_000,
  );
  const woken = await rpc("threadMachines.wake", { threadId });
  check(
    "threadMachines.pause and threadMachines.wake",
    paused?.state === "running" && woken?.state === "running",
    `${paused?.state} / ${woken?.state}`,
  );

  // f. A hub restart keeps history and diffs.
  const beforeRestart = await thread();
  await stop("hub");
  await startHub();
  const afterRestart = await thread();
  check(
    "hub restart keeps history",
    afterRestart.messages.length === beforeRestart.messages.length &&
      afterRestart.checkpoints.length === beforeRestart.checkpoints.length,
    `${afterRestart.messages.length} messages, ${afterRestart.checkpoints.length} checkpoints`,
  );
  const afterDiff = await rpc("orchestration.getTurnDiff", {
    threadId,
    fromTurnCount: 0,
    toTurnCount: 1,
  });
  check("turn diff after hub restart", afterDiff.diff === diff.diff);
  const restartedProvider = (await rpc("server.getConfig", {})).providers.find(
    (provider) => provider.instanceId === "claudeAgent",
  );
  check(
    "provider status after the hub restart",
    restartedProvider?.auth.status === "authenticated",
    restartedProvider?.auth.status,
  );
  check(
    "title generated on the runner",
    afterRestart.title !== "New thread",
    JSON.stringify(afterRestart.title),
  );
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  log("ERROR", error?.stack ?? error);
} finally {
  await stop("hub");
  await stop("runner");
  const failures = results.filter((result) => !result.ok);
  log(`${results.length - failures.length}/${results.length} checks passed; logs in ${logs}`);
  if (!KEEP && !failed && failures.length === 0)
    NodeFS.rmSync(root, { recursive: true, force: true });
  process.exitCode = failed || failures.length > 0 ? 1 : 0;
}
