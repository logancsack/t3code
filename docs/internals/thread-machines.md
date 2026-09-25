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

A hub process serves exactly one tenant (`T3CODE_HUB_TENANT_ID`) and its base directory is
disposable: it holds only logs, caches, and the live process's runtime state file. Everything
a standalone server keeps in its state directory lives in Postgres instead, in tables whose
keys and indexes all start with `user_id`:

| Standalone                                                              | Hub                                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `state.sqlite`: events, receipts, projections, provider session runtime | The same tables in Postgres; event sequences are per tenant (`hub_users.last_event_sequence`)                |
| `state.sqlite`: auth sessions and pairing links                         | `auth_sessions`, `auth_pairing_links`; T3's pairing, browser sessions, and bearer tokens work unchanged      |
| `settings.json`, `keybindings.json`, `environment-id`, `anonymous-id`   | `hub_documents` rows named after the files; in-process notifications replace the file watcher                |
| `secrets/*.bin`                                                         | `hub_secrets`, AES-256-GCM with `T3CODE_HUB_SECRET_KEY`; the authenticated data binds tenant and secret name |
| `attachments/`                                                          | `hub_attachments` (`bytea`); the local directory is a cache filled on lookup                                 |
| Repository identity from `git remote` on every read                     | `projection_projects.repository_identity_json`, recorded by `project.create` / `project.meta.update`         |
| `checkpoint_diff_blobs` (unused standalone)                             | Created for the per-turn diff cache                                                                          |

Machine-published themes stay local (a hub has no desktop to publish them). The last
reported VCS status per thread and the runner cursors belong to the thread-machine
migrations.

In code, hub mode is a `HubDatabase` reference provided at the server and auth CLI roots
(`apps/server/src/persistence/Postgres/`). The SQLite persistence layer hands out its client,
each repository layer selects its Postgres port through `localOrHub`, and file-backed stores
branch on it. Standalone layers, types, and behavior are unchanged.

## Operations

**Migrations.** Hub migrations are numbered entries in
`apps/server/src/persistence/Postgres/migrations/index.ts`: 001–049 for hub persistence,
050–099 for thread-machine state. A hub applies pending ones at startup with
`T3CODE_HUB_DATABASE_ADMIN_URL` (or the runtime URL), each in its own transaction under a
transaction-scoped advisory lock, recorded in `hub_schema_migrations`. They are applied by id,
not list position, so separately owned ranges can land in any order. Keep them
expand/contract compatible: an older hub may still be running.

**Roles and row-level security.** Every tenant table has a forced policy comparing `user_id`
with the transaction-local `hub.user_id`. The runtime client sets it with `SET LOCAL` at the
start of every transaction and wraps statements outside one in their own transaction (two
extra round trips), so it works behind a transaction pooler and never leaks between clients.
Without the setting a query sees nothing and cannot write. Use a runtime role without
`BYPASSRLS` (PlanetScale's default role has it) and pass the owner as the admin URL; after
migrating, the hub grants the runtime role DML on the schema's tables (read-only on the
migration history). The explicit `user_id` predicates remain the primary isolation; RLS is
the backstop. Each hub keeps a pool of at most four connections.

**Import.** `t3 hub import <state-dir>` copies a standalone state directory into the tenant
named by the `T3CODE_HUB_*` environment in one transaction: the database (read-only, paged,
at the current standalone migration), the documents, attachments within the upload limit,
and provider environment secrets re-encrypted with the hub key. Auth sessions, pairing
links, and other secrets stay behind. It refuses a tenant with data unless `--replace`,
which first deletes every row the tenant has (sessions and hub secrets included), records
repository identities for projects whose checkouts exist on the machine, and prints
counts only.
