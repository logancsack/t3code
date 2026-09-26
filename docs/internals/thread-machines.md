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

## Configuration

### Hub

| Variable                        | Meaning                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `T3CODE_SERVER_MODE=hub`        | Enables hub mode                                                                                                                                                       |
| `T3CODE_HUB_DATABASE_URL`       | Postgres URL of the hub schema, for a role without `BYPASSRLS`. libpq's `sslrootcert=system` is accepted. Without it the hub persists to SQLite (tests, development)   |
| `T3CODE_HUB_DATABASE_ADMIN_URL` | Optional; the schema owner, used only to apply hub migrations and grant the runtime role. Defaults to the runtime URL                                                  |
| `T3CODE_HUB_TENANT_ID`          | The Aldo user ID whose rows this process owns; one hub process serves one user. Required with a database URL                                                           |
| `T3CODE_HUB_SECRET_KEY`         | Base64 32-byte key encrypting the tenant's secrets at rest. Required with a database URL                                                                               |
| `T3CODE_HUB_MACHINES_URL`       | Base URL of the machine directory (served by the platform host process)                                                                                                |
| `T3CODE_HUB_MACHINES_TOKEN`     | Bearer for the machine directory                                                                                                                                       |
| `T3CODE_HUB_PUBLIC_URL`         | Base URL at which thread machines reach the hub. Runners are given `<url>/mcp` as the `t3-code` MCP endpoint; without it only a runner on the hub's host can reach MCP |
| `T3CODE_HUB_CHECKOUT_ROOT`      | Root of thread checkouts (`/workspace/t`). Hub and machines must agree; only tests and development change it                                                           |
| `T3CODE_RUNNER_URL`             | Development only: a single `t3 runner` WebSocket URL used instead of the machine directory (static directory, always `running`)                                        |
| `T3CODE_RUNNER_TOKEN`           | Development only: the bearer presented to that runner                                                                                                                  |

A hub needs the machine directory (URL and token) or a development runner URL. The
database, tenant, and secret key go together: with them the hub is production-shaped and its
base directory is disposable (logs, caches, and the live process's runtime state file only);
without them it keeps a standalone-style state directory, which only tests and development
use. The existing managed variables (`T3CODE_MANAGED_DEVPC`, `WORKSPACE_GATEWAY_TOKEN`, port,
base dir) keep their meaning. In standalone mode none of these keys appear in the resolved
configuration, so it stays identical to upstream T3.

### Runner

The runner is `t3 runner` with the usual base dir and port flags plus:

| Variable                  | Meaning                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `T3CODE_RUNNER_TOKEN`     | Bearer the hub must present (`Authorization: Bearer …` on the WebSocket upgrade)       |
| `T3CODE_RUNNER_THREAD_ID` | The single thread this machine serves; required                                        |
| `T3CODE_RUNNER_CHECKOUT`  | Absolute checkout path for that thread; required. It is also the runner's server `cwd` |
| `T3CODE_RUNNER_DRIVERS`   | Optional comma-separated driver kinds to host (development); every built-in by default |

The runner listens on loopback. The platform exposes it to the hub through its own
authenticated tunnel. Every call is checked against the runner's binding: thread-keyed
calls must name its thread and `cwd`-keyed calls must stay inside its checkout, or they
fail with the RPC's own error type. The runner keeps its provider settings, the outbox
(`<state dir>/runner/outbox.sqlite`) and provider session files on the machine's disk.

## Checkout paths and routing

In hub mode every thread gets its own checkout path on its own machine:

```
/workspace/t/<threadId>
```

Client `thread.create` commands and bootstrap `createThread` get this `worktreePath`, and
`project.create` gets a virtual `workspaceRoot` of `/workspace/p/<projectId>` that nothing
reads (a `project.meta.update` cannot move it). Thread ids are URL-encoded into one path
segment. Because a checkout path names exactly one thread, every existing `cwd`-keyed call
(checkpoints, VCS, workspace files, review) routes to that thread's runner without contract
changes. Calls whose `cwd` is not inside a thread checkout fail with
`ThreadMachineUnavailableError { reason: "not-a-thread-checkout" }`; the hub never falls
back to its local filesystem.

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

Hub behavior (`hub/MachineDirectory.ts`, `hub/RunnerConnectionPool.ts`):

- A waking call posts `wake: true` with the thread's project, the project's repository
  identity (`RepositoryIdentityResolver`) and branch, then polls `GET` every 2 s while the
  state is `preparing`, `starting`, `paused`, `saved` or `none`, for at most 5 minutes
  (`wake-timeout`). Requests time out after 30 s (`directory`).
- A non-waking call uses `GET`; anything but `running` fails with
  `ThreadMachineUnavailableError { reason: "asleep", state }`.
- `failed` fails with reason `failed`; `failed` and `none` also settle the thread's live
  sessions (see crash reconciliation).
- One connection per thread is shared by concurrent callers. The runner token is sent as
  a bearer header; a token is only needed for the handshake, so reconnects re-resolve it.
- A connection with no calls, open streams or running turn for 10 minutes is closed and
  the directory is told `idle`. A connection lost while a turn runs reconnects with
  backoff (250 ms to 15 s) without waking the machine.
- The runner WebSocket URL may omit its path; `/runner/ws` is assumed.

## Runner protocol

`packages/contracts/src/runner.ts` (`@t3tools/contracts/runner`) defines `RunnerRpcGroup`,
versioned independently of the client protocol: `RUNNER_PROTOCOL_VERSION = 1`,
`RUNNER_MIN_PROTOCOL_VERSION = 1`. `runner.hello` sends the hub's range and the thread; a
runner whose range does not overlap refuses with `RunnerProtocolMismatchError`, and one
bound to another thread with `RunnerThreadMismatchError`. The reply carries the negotiated
version, `runnerId` (the outbox identity, stable across restarts), `bootId` (per process),
the outbox head, ack and first retained sequence, and the hosted provider instances.
Compatible changes add RPCs and bump the version; a hub checks `hello.protocolVersion`
before using newer calls.

Payloads and results are client contract schemas. Contract errors (VCS, git, terminal,
review, text generation) cross the wire as themselves; server-internal error unions
(provider adapter, workspace entries and files) travel inside `RunnerRemoteError`, encoded
with the server's schema and decoded back on the hub.

| Group       | RPCs                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handshake   | `runner.hello`                                                                                                                                                                                                                                                                                                                                                       |
| Provider    | `runner.provider.{startSession, sendTurn, interruptTurn, respondToRequest, respondToUserInput, stopSession, listSessions, readThread, rollbackThread, getCapabilities}`                                                                                                                                                                                              |
| Text        | `runner.text.{generateThreadTitle, generateBranchName}`                                                                                                                                                                                                                                                                                                              |
| Events      | `runner.events.subscribe` (stream), `runner.events.ack`                                                                                                                                                                                                                                                                                                              |
| Checkout    | `runner.checkout.prepare`                                                                                                                                                                                                                                                                                                                                            |
| Checkpoints | `runner.checkpoint.{isGitRepository, capture, hasRef, restore, diff, deleteRefs}`                                                                                                                                                                                                                                                                                    |
| Workspace   | `runner.workspace.{listEntries, searchEntries, searchContents, readFile, writeFile, refreshIndex}`                                                                                                                                                                                                                                                                   |
| VCS and git | `runner.vcs.{status, localStatus, remoteStatus, refreshStatus, refreshLocalStatus, streamStatus (stream), init}`, `runner.git.{pull, runStackedAction (stream), resolvePullRequest, preparePullRequestThread, listRefs, createWorktree, removeWorktree, pruneWorktrees, createRef, switchRef, renameBranch, fetchRemote, remoteExists, resolveRemoteTrackingCommit}` |
| Review      | `runner.review.{getDiffPreview, getDiffFileContents}`                                                                                                                                                                                                                                                                                                                |
| Terminals   | `runner.terminal.{open, attach (stream), write, resize, clear, restart, close, events (stream), metadata (stream)}`                                                                                                                                                                                                                                                  |

`startSession` carries the hub-minted MCP credential (`mcp`: environment, thread,
provider session, instance, endpoint, authorization header); the endpoint is rewritten to
`T3CODE_HUB_PUBLIC_URL/mcp` when set. `sendTurn` and text generation carry attachment
bytes (`RunnerAttachmentFile`: the attachment, its hub path, base64 bytes); the runner
writes them where its adapters read attachments and replaces each hub path in the prompt
with its own. Commit and PR text are generated on the runner inside git actions.

`runner.checkout.prepare` is idempotent: a missing checkout is cloned (`git clone --origin
origin`, with the machine's own git configuration and credential helper) or, without a
repository, initialized; an existing one is never reset. When `branch` is not checked out
it is switched to if it exists locally, else created from `origin/<branch>` (pushed from an
earlier machine), else from `baseRef` (remote-tracking first), else `HEAD`. Network access
happens only when cloning or creating a branch.

## Wake semantics

Whether a call may resume or recreate a sleeping machine is decided per call:

| Wakes the machine                                                                                                                                     | Never wakes it                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider session start, `sendTurn` (turn start), approval and user-input responses, interrupting an active turn, rollback (revert) and `readThread`   | `hasSession` / `listSessions` (answered by the hub; a session on a sleeping machine is resumable), `stopSession`, provider capability refresh |
| Thread bootstrap and checkout preparation before each turn, setup scripts                                                                             | Git status: `getStatus`, `streamStatus`, refreshes (hub cache; a connected runner refreshes it), `listRefs`, invalidations                    |
| Terminal `open`, `attach`, `restart`                                                                                                                  | Terminal `write`, `resize`, `clear` (fail with `TerminalNotRunningError`), `close` (no-op), terminal events and metadata                      |
| File writes; `vcs.init`; git actions (pull, commit/push/PR stacked actions, refs, worktrees, branch rename, PR resolve and thread preparation, fetch) | File list, search, content search and read; review diff preview and file contents; workspace index refresh                                    |
| Title and branch-name generation (only issued at turn start)                                                                                          | Turn and full-thread diffs that were captured (hub cache); a diff never captured wakes once and is then cached                                |

A read that needs a running machine fails with its service's own error type whose cause
is `ThreadMachineUnavailableError { reason: "asleep", state }`, which clients can render as
a resumable state. Clients should offer an explicit action (a turn, a terminal) to wake.

## Durable delivery and crash reconciliation

Runner (`runner/RunnerOutbox.ts`): every provider runtime event is stamped with its
instance id and committed to `runner_outbox` (SQLite, WAL, `synchronous = FULL`, so each
commit is fsynced) with a strictly increasing `sequence` before any subscriber sees it.
Sequences never repeat for an outbox (`runnerId`) across restarts. An adapter event id that
repeats among retained rows is suffixed with its sequence. `subscribe(after)` replays
retained events then tails live ones without gaps or overlap; `ack(n)` deletes through `n`.
More than 200,000 unacknowledged events drop the oldest and advance
`firstRetainedSequence`; a hub behind it logs the gap (resynchronizing from `readThread` is
future work). On graceful shutdown the runner stops its sessions while its event pumps
still run, so exit events reach the outbox.

Hub (`hub/RunnerEventDelivery.ts`):

- Delivery starts after server activation, so ingestion is subscribed first. Each
  connection subscribes from the thread's cursor, drops any `(thread, sequence)` already
  delivered, and resubscribes if the stream fails on a live connection.
- The cursor (`RunnerCursorStore`: outbox id, last reconciled boot, sequence) advances only
  to a turn-safe point: a sequence at which the thread had no open turn. Ingestion buffers
  assistant text and plans in memory during a turn, so after a hub crash the runner replays
  the open turn from its start.
- Replays are idempotent: in hub mode ingestion derives command ids from the runtime event
  id (`provider:<eventId>:<tag>:<n>`), so already-committed commands are answered from their
  receipts instead of applied twice.
- A cursor is written once the safe point is 250 ms old and ingestion and the checkpoint
  reactor have drained, then acknowledged to the runner. Acknowledgement only lets the
  runner compact.
- Boot reconciliation: when a runner reports a boot other than the one that hosted a
  thread's session, the hub asks it (after the backlog is delivered) whether it still hosts
  the session. If not, the hub publishes an interrupted `turn.completed` (when a turn was
  active) and a `session.exited`, with deterministic event ids, and forgets the session. The
  same happens when the directory reports the machine `failed` or `none`. The next turn
  restarts the session from the persisted resume cursor. A `sendTurn` that finds its session
  lost while the machine slept restarts it the same way before sending.
- At hub startup delivery resumes, without waking, from every thread with a live remote
  session whose machine is running.

Session directory (`hub/RemoteSessionRegistry.ts`): the remote provider adapter answers
`hasSession` and `listSessions` from a registry of sessions it started, their runner boot
and active turn, updated from delivered events and seeded after a restart from the persisted
bindings that were still active. Hub shutdown leaves remote sessions running and their
bindings live (`ProviderAdapterCapabilities.sessionsOutliveServer`).

## Hub caches that keep machines asleep

- Per-turn diffs (`CheckpointTurnDiffStore`): after capturing checkpoint `n` the hub stores
  the `n-1 → n` and `0 → n` patches in both whitespace modes while the machine is still
  connected; any diff computed through the runner is stored too. Recapturing, restoring
  past, or deleting a checkpoint invalidates every diff that read it.
- Git status (`ThreadVcsStatusStore` + `HubVcsStatusCache`): a connected runner streams its
  checkout's status into the cache; subscribers get the cached snapshot first. Automatic
  settlement reads a branch's pull-request state from the cache.

## Thread bootstrap

Bootstrap in hub mode (`hub/HubThreadCheckouts.ts`, used by `CommandDispatcher`) creates the
thread with its checkout path, ensures and wakes its machine with the project's repository
identity and the branch, and calls `runner.checkout.prepare`, then runs the setup script in a
routed terminal. Progress and failures are thread activities: `thread-machine.starting`
("Starting machine", while waking), `thread-machine.checkout.preparing` ("Preparing
checkout") and `thread-machine.failed` (tone `error`). A failed bootstrap deletes the new
thread as in standalone mode. Before every turn the checkout is prepared again (skipped when
the same runner boot already did).

## Hub persistence

A hub process serves exactly one tenant. With a database, everything a standalone server
keeps in its state directory lives in Postgres, in tables whose keys and indexes all start
with `user_id`:

| Standalone                                                              | Hub                                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `state.sqlite`: events, receipts, projections, provider session runtime | The same tables in Postgres; event sequences are per tenant (`hub_users.last_event_sequence`)                |
| `state.sqlite`: auth sessions and pairing links                         | `auth_sessions`, `auth_pairing_links`; T3's pairing, browser sessions, and bearer tokens work unchanged      |
| `settings.json`, `keybindings.json`, `environment-id`, `anonymous-id`   | `hub_documents` rows named after the files; in-process notifications replace the file watcher                |
| `secrets/*.bin`                                                         | `hub_secrets`, AES-256-GCM with `T3CODE_HUB_SECRET_KEY`; the authenticated data binds tenant and secret name |
| `attachments/`                                                          | `hub_attachments` (`bytea`); the local directory is a cache filled on lookup                                 |
| Repository identity from `git remote` on every read                     | `projection_projects.repository_identity_json`, recorded by `project.create` / `project.meta.update`         |
| (none)                                                                  | Thread-machine state, migration 050: see below                                                               |

Thread-machine state (`persistence/Services/HubThreadMachineState.ts`):

- `hub_runner_cursors` (`RunnerCursorStore`): per thread, the runner outbox id, the last
  reconciled boot, and the durable delivery sequence.
- `hub_checkpoint_turn_diffs` (`CheckpointTurnDiffStore`): per-turn patches in both
  whitespace modes. It is the hub's only diff table; standalone `checkpoint_diff_blobs` is
  never written, has no hub table, and is not imported.
- `hub_thread_vcs_status` (`ThreadVcsStatusStore`): the last git status a runner reported.

Machine-published themes stay local (a hub has no desktop to publish them).

In code, hub mode with a database is a `HubDatabase` reference (tenant id and the
tenant-scoped client) provided once at the server and auth CLI roots
(`persistence/Postgres/HubDatabase.ts`). There is one selection rule, `localOrHub(local,
hub)`: every repository layer, the thread-machine stores included, gets the tenant client as
its `SqlClient` and the tenant as `HubTenant` when the reference is set, and its SQLite
implementation otherwise. The SQLite persistence layer hands out the tenant client in hub
mode and refuses to open a local file when a database URL is configured; file-backed stores
(settings, keybindings, secrets, environment and anonymous ids, attachments) branch on the
same reference. A hub without a database therefore runs on SQLite end to end: the
thread-machine stores create their tables on first use (never in standalone databases), and
no repository identity is recorded, so machines start from an empty checkout. Standalone
layers, types, and behavior are unchanged.

Attachments are persisted when they become durable (upload completed, pending upload
claimed by a turn, inline image written) and restored into the cache before any lookup by
id, including before the remote provider driver ships a turn's attachment bytes to the
runner, so a hub on a fresh base directory still sends them.

## Operations

**Migrations.** Hub migrations are numbered entries in
`apps/server/src/persistence/Postgres/migrations/index.ts`: 001–049 for hub persistence,
050–099 for thread-machine state (050 today). A hub applies pending ones at startup with
`T3CODE_HUB_DATABASE_ADMIN_URL` (or the runtime URL), each in its own transaction under a
transaction-scoped advisory lock, recorded in `hub_schema_migrations`. They are applied by id,
not list position, so separately owned ranges can land in any order. Every new tenant table
leads its keys and indexes with `user_id` and enables `hubTenantPolicyStatements` (001).
Keep migrations expand/contract compatible: an older hub may still be running.

**Roles and row-level security.** Every tenant table has a forced policy comparing `user_id`
with the transaction-local `hub.user_id`. The runtime client sets it with `SET LOCAL` at the
start of every transaction (`BEGIN; SET LOCAL hub.user_id = …` in one round trip) and wraps
statements outside one in their own transaction (two extra round trips), so it works behind a
transaction pooler such as PgBouncer and never leaks between clients. Without the setting a
query sees nothing and cannot write. Use a runtime role without `BYPASSRLS` (PlanetScale's
default role has it) and pass the owner as the admin URL; after migrating, the hub grants the
runtime role DML on the schema's tables (read-only on the migration history). The explicit
`user_id` predicates remain the primary isolation; RLS is the backstop. Each hub keeps a pool
of at most four connections, and the Postgres driver is loaded only when a hub database is
configured.

**Import.** `t3 hub import <state-dir>` copies a standalone state directory into the tenant
named by the `T3CODE_HUB_*` environment in one transaction: the database (read-only, paged,
at the current standalone migration), the documents, attachments within the upload limit,
and provider environment secrets re-encrypted with the hub key. Auth sessions, pairing
links, and other secrets stay behind. It refuses a tenant with data unless `--replace`,
which first deletes every row the tenant has in any tenant table (sessions, hub secrets and
thread-machine state included), records repository identities for projects whose checkouts
exist on the machine, and prints counts only. To verify an import, run
`node apps/server/scripts/hub-import-compare.ts <state-dir> [thread-ids]` with the same
environment: it compares every snapshot read of the standalone database and the tenant and
prints only equal/different with counts.

## Composition

`server.ts` builds one runtime for every mode from the `ServerModeLayers` record; standalone
uses the local layers and a hub uses `hub/HubLayers.ts` for the checkout-bound groups
(checkpointing, git, VCS, terminals, workspace, provider instances), the recorded repository
identity (`HubRepositoryIdentityResolver`), and hub-only infrastructure (machine directory,
connection pool, session registry, event delivery, state stores, git status cache) and
background work. `HubDatabase.layerConfig` sits under the whole runtime. Shared code sees hub
mode only through the `serverModeHooks.ts` references (deterministic ingestion ids,
`HubThreadCheckouts`), `CheckoutGitProbe`, and `HubDatabase`, whose defaults are standalone
behavior. `t3 runner` is composed in `runner/RunnerServer.ts` without orchestration,
projections or the client API.

## Web client

The web client decides hub mode per environment, at render time, from
`capabilities.threadMachines` (`apps/web/src/hubMode.ts`); before a managed primary's config
arrives it trusts the managed bootstrap (`serverMode: "hub"`) or the cached environment
descriptor, so a hub never flashes local-checkout controls. On a hub:

- New threads have no local/worktree choice. A draft shows "New machine" and a base branch
  listed from the repository (`vcs.listRefs` on the project root); with none picked it sends
  `prepareWorktree.baseBranch: "HEAD"`. Drafts never ask the hub for status, files,
  terminals or scripts, since their machine does not exist yet. Blank projects send no
  `prepareWorktree`.
- Projects are added as repositories (URL, provider lookup, or the GitHub list) or blank
  projects: `project.create` with `repositoryIdentity` and the virtual root, deduplicated by
  remote. Nothing is cloned by the client.
- The thread shell's `machine` drives a header status pill, the timeline's waking row
  (with the platform's detail), the composer notice (asleep, or failed with a retry that
  re-drives the failed turn), and the sidebar (starting reads as working, failed as failed).
  `thread-machine.*` activities stay out of the work log unless they are errors.
- Surfaces that need a checkout adapt: no Open In, Copy path, t3.json reads or new-thread
  workspace settings; files show "Machine asleep" while the machine sleeps; the diff panel
  opens on the latest captured turn; previews and the machine browser use the bootstrap's
  per-thread templates (`threadPreviewUrlTemplate`, `threadBrowserUrlTemplate`); provider
  sign-in opens the session's `workspaceBrowserUrl` when present. The managed workspace
  status, `/settings/workspace` and the durable wake queue are skipped.

An explicit wake (`threadMachines.wake`) is not wired yet: the client hides that affordance
(`components/hub/threadMachineActions.ts`).

## Gaps

Not available on a hub (typed errors, never the hub's disk): filesystem browsing for the
project picker, repository clone and publish, and workspace-file, media and project-favicon
asset URLs.

Still running where the hub runs, to move to runners or the credential service: previews,
provider sign-in (auth connector), provider maintenance, usage scanning, workflow scripts,
and pull-request listing (which needs provider credentials).

Not built yet:

- Only the web client's add-repository flow and the import (from a checkout) record a
  project's repository identity (`project.create` / `project.meta.update` with
  `repositoryIdentity`). A hub without a database records none.
- A hub behind a runner's `firstRetainedSequence` (more than 200,000 unacknowledged events)
  only logs the gap; resynchronizing from `readThread` is future work.
- Attachment bytes live in `bytea` within the upload limits; object storage can replace the
  table behind the `HubAttachments` helpers.

## Testing

- Unit: `apps/server/src/hub/*.test.ts` (wake semantics with a fake directory and fake
  runner, delivery and reconciliation, routed services, the machine directory contract),
  `apps/server/src/runner/*.test.ts` (outbox, checkout, handler guards),
  `packages/contracts/src/runner.test.ts`, and the thread-machine stores on SQLite.
- Postgres: set `T3_HUB_TEST_DATABASE_URL` to a disposable database the tests may create
  schemas in (for example a private loopback cluster as `postgres`). Each test gets its own
  schema and, when the connecting role bypasses RLS on loopback, a runtime role without
  `BYPASSRLS`, so row-level security is exercised. This enables the persistence tests
  (`persistence/Postgres/*.test.ts`, including the thread-machine stores and migration 050),
  the hub server boot (`server.hub.test.ts`), attachment restore before shipping to a
  runner, and the loopback integration on Postgres. Without the variable they skip, and the
  loopback runs on SQLite.
- Loopback integration: `apps/server/integration/hubRunnerLoopback.integration.test.ts` runs
  `ProviderService` and the reactors on a hub against the real runner handlers.
- End to end with a real provider:
  `node apps/server/scripts/thread-machines-e2e.mjs [--keep] [--model <id>]
[--hub-database-url <url> [--hub-database-admin-url <url>]]` starts a runner (4422) and a
  hub (4421) on loopback and drives the hub's public API. With a database URL the hub runs
  on Postgres for a fresh tenant seeded through `t3 hub import`, and restarts on an empty
  base directory.
