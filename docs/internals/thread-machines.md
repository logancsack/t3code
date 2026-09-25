# Thread machines: hub and runner modes

Managed Aldo is moving from one persistent machine per user to Cursor-style cloud agents:
the T3 interface, history, settings, and projects are served without any machine, and each
thread's work runs on its own machine that is created, resumed, or recreated on demand. The
platform design is `docs/cloud-agents-architecture.md` in the remote-dev repository. This
document is the contract inside T3.

Standalone T3 behavior is unchanged. Both new modes are opt-in and only managed Aldo
staging enables them.

## Server modes

`ServerConfig.serverMode` is one of:

| Mode         | Selected by              | Owns                                                                                        |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------- |
| `standalone` | default                  | Everything, as today                                                                        |
| `hub`        | `T3CODE_SERVER_MODE=hub` | Orchestration, projections, settings, auth, attachments, provider session directory, caches |
| `runner`     | `t3 runner` command      | One thread's checkout: provider drivers, git, checkpoints, terminals, files, setup scripts  |

A hub never runs git, provider CLIs, terminals, or repository code, and never reads a
checkout path. A runner never persists orchestration state.

### Hub configuration

| Variable                        | Meaning                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `T3CODE_SERVER_MODE=hub`        | Enables hub mode                                                               |
| `T3CODE_HUB_DATABASE_URL`       | Postgres URL for the hub schema (a role without `BYPASSRLS`)                   |
| `T3CODE_HUB_DATABASE_ADMIN_URL` | Optional; used only to apply hub migrations. Defaults to the runtime URL       |
| `T3CODE_HUB_TENANT_ID`          | The Aldo user ID whose rows this process owns. One hub process serves one user |
| `T3CODE_HUB_SECRET_KEY`         | Base64 32-byte key encrypting per-user secrets at rest in Postgres             |
| `T3CODE_HUB_MACHINES_URL`       | Base URL of the machine directory (served by the platform host process)        |
| `T3CODE_HUB_MACHINES_TOKEN`     | Bearer for the machine directory                                               |

The existing managed variables (`T3CODE_MANAGED_DEVPC`, `WORKSPACE_GATEWAY_TOKEN`, port,
base dir) keep their meaning. The base dir holds only disposable caches and logs in hub
mode; losing it loses nothing.

### Runner configuration

The runner is `t3 runner` with the usual base dir and port flags plus:

| Variable                  | Meaning                                |
| ------------------------- | -------------------------------------- |
| `T3CODE_RUNNER_TOKEN`     | Bearer the hub must present            |
| `T3CODE_RUNNER_THREAD_ID` | The single thread this machine serves  |
| `T3CODE_RUNNER_CHECKOUT`  | Absolute checkout path for that thread |

The runner listens on loopback. The platform exposes it to the hub through its own
authenticated tunnel; the runner never accepts other threads' calls.

## Checkout paths and routing

In hub mode every thread gets its own checkout path on its own machine:

```
/workspace/t/<threadId>
```

Thread creation in hub mode sets `worktreePath` to that path, and projects get a virtual
`workspaceRoot` of `/workspace/p/<projectId>` that nothing reads. Because a checkout path
names exactly one thread, every existing `cwd`-keyed call (checkpoints, VCS, workspace
files, review) routes to that thread's runner without contract changes. Calls whose `cwd`
does not parse as a thread checkout fail with a typed error; the hub never falls back to its
local filesystem.

## Machine directory

The hub resolves a thread's runner through the machine directory at
`T3CODE_HUB_MACHINES_URL`. All requests carry `Authorization: Bearer
T3CODE_HUB_MACHINES_TOKEN` and JSON bodies.

```
POST /threads/{threadId}/machine
  { "projectId", "repository": { "url", "ref" } | null, "branch", "checkout", "wake": true }
GET  /threads/{threadId}/machine
POST /threads/{threadId}/machine/idle
POST /threads/{threadId}/machine/release
```

`POST` ensures a machine exists and, when `wake` is true, resumes or recreates it. `GET`
never wakes. Both return:

```json
{
  "state": "none | preparing | starting | running | paused | saved | failed",
  "runner": { "url": "wss://…", "token": "…", "expiresAt": "…" },
  "bootId": "…",
  "detail": "human-readable progress or error"
}
```

`runner` is present only in `running`. A changed `bootId` means the machine restarted;
the hub reconciles sessions and turns that were active on the previous boot. `idle` tells
the platform no session or turn needs the machine; the platform decides when to pause or
save it. `release` retires the machine when the thread is archived or deleted.

## Runner protocol

`packages/contracts/src/runner.ts` defines `RunnerRpcGroup`, versioned independently of
the client protocol. It carries provider session control, the checkpoint group, routed
workspace, VCS, git, and terminal services, text generation, and the event stream.
Runners persist provider events in a SQLite outbox before acknowledging them; the hub
saves its per-machine cursor in the same transaction as the projection writes and
deduplicates by `(threadId, runner sequence)`.

## What the hub persists

Everything a standalone server keeps in its state directory moves to Postgres, scoped by
`user_id` with row-level security as a backstop: orchestration events, projections, command
receipts, provider session runtime, auth sessions and pairing links, settings, keybindings,
secrets (encrypted with `T3CODE_HUB_SECRET_KEY`), the environment ID, attachments, per-turn
diffs, repository identity, and the last reported VCS status per thread.
