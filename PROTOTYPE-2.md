# Prototype 2: remote provider driver (hub + runner)

Question from `docs/cloud-agents-architecture.md` (remote-dev): does a remote provider
driver preserve T3 behavior?

**Answer: yes for the turn lifecycle.** A checkout-less hub and a runner in separate
processes, with separate state directories, completed real Claude turns. The runs covered
streamed output, approvals, interrupts, checkpoints and diffs, a hub restart during a turn,
and runner restarts between and during turns. No events were lost or duplicated. For the
same prompts, a local-mode control run of the same build produced the same projections
and the same diff bytes.

The cut works at the driver level, as proposed. `ProviderService` (the session directory,
resume cursors and `recoverSessionForThread`) and every orchestration reactor ran
unchanged in the hub, except that two `.git` checks now go through a service. The work
still needed is outside the turn loop: per-thread routing, caches that keep machines
asleep, crash reconciliation, and about 60 other call sites that act on the checkout
(terminals, files, VCS, attachments, MCP and so on). These are listed below.

Branch `prototype/remote-runner` of the T3 fork. It is local only and not pushed. The
runs used Node 22.23 with sources run directly (`node src/bin.ts`), and the model
`claude-haiku-4-5` through the unmodified Claude Code 2.1.282 CLI and T3's
`ClaudeAdapter`, using this VM's existing login. Model usage: 12 short turns and 1 title
generation.

## What was built

```
client ──HTTP/WS──▶ HUB :4411  (T3 server, T3CODE_RUNNER_URL set)
                     orchestration · projections · settings · ProviderService/session directory
                     RemoteProviderDriver ×7 kinds · RemoteCheckpointStore · CheckoutGitProbe
                     RunnerClient ──── WebSocket, Effect RPC (RunnerRpcGroup) ────┐
                                                                                  ▼
                                     RUNNER :4412  (`t3 runner`)
                                     real ClaudeDriver (+CodexDriver) · CheckpointStore/git
                                     WorkspacePaths · RunnerOutbox (NDJSON, fsync)
                                     cwd = /tmp/proto-runner/checkout
```

| File                                                                                           |      Lines | Role                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/runner/RunnerProtocol.ts`                                                     |        317 | Hub↔runner RPC group. Payloads are `@t3tools/contracts` schemas; errors are the adapter/VCS error classes                            |
| `apps/server/src/runner/RunnerServer.ts`                                                       |        360 | Runner build: registry of real drivers, event pump into the outbox, RPC handlers, token-checked WS route, and a shutdown drain       |
| `apps/server/src/runner/RunnerOutbox.ts` (+ `.test.ts`)                                        | 240 (+115) | Durable, replayable event log                                                                                                        |
| `apps/server/src/runner/hub/RunnerClient.ts`                                                   |        313 | Supervised connection with reconnect, bounded wait for calls, cursor-based subscription, dedup, fan-out, cursor file                 |
| `apps/server/src/runner/hub/RemoteProviderDriver.ts`                                           |        314 | Wraps each built-in driver's kind, schema and defaults. The adapter, snapshot and title/branch text generation forward to the runner |
| `apps/server/src/runner/hub/HubLayers.ts`                                                      |        225 | Hub replacements for services that touch the checkout (delegated or stubbed; table below)                                            |
| `apps/server/src/runner/hub/RunnerDelivery.ts`                                                 |         50 | Starts delivery after activation. Every 500 ms it drains ingestion, then acknowledges                                                |
| `apps/server/src/git/CheckoutGitProbe.ts`                                                      |         18 | `Context.Reference` that replaces the synchronous `isGitRepository` in two reactors. The default keeps the local behavior            |
| edits: `server.ts`, `ProviderInstanceRegistryHydration.ts`, `config.ts`, `cli/*`, two reactors |   +163/−33 | `byRunnerMode(local, hub)` layer switches; driver-list hydration; `T3CODE_RUNNER_URL`/`T3CODE_RUNNER_TOKEN`; `t3 runner` subcommand  |
| `prototype-2/`                                                                                 |            | Scenario driver (client over the hub's public API), launch and stop scripts, evidence                                                |

Checks: `pnpm typecheck` (apps/server) is clean. `vp lint` and `vp fmt --check` pass on
the changed files. `vp test run` passes for `RunnerOutbox.test.ts` (2 tests) and for the
touched suites `CheckpointReactor.test.ts`, `ProviderRuntimeIngestion.test.ts` and
`ProviderInstanceRegistryHydration.test.ts` (68 tests). Repo-wide suites were not run, per
AGENTS.md.

### Running it

```bash
# layout: /tmp/proto-runner/{checkout,hub,runner,logs}, settings.json with
# enableProviderUpdateChecks=false (no manifest/npm fetches), telemetry off.
cp prototype-2/{start-hub.sh,start-runner.sh,ctl.sh} /tmp/proto-runner/
/tmp/proto-runner/ctl.sh start-runner      # node src/bin.ts runner --base-dir /tmp/proto-runner/runner --port 4412
/tmp/proto-runner/ctl.sh start-hub         # T3CODE_RUNNER_URL=ws://127.0.0.1:4412/runner/ws node src/bin.ts --base-dir /tmp/proto-runner/hub --port 4411
node apps/server/src/bin.ts auth session issue --base-dir /tmp/proto-runner/hub --token-only > /tmp/proto-runner/hub-token
node prototype-2/scenario.mjs setup
node prototype-2/scenario.mjs turn "<prompt>" --approve [--interrupt-after-ms 4000]
node prototype-2/scenario.mjs diff 0 1
prototype-2/hub-restart-test.sh ; prototype-2/runner-restart-midturn-test.sh
```

**How we show the hub never touches the checkout.** `start-hub.sh` runs the hub inside
`bwrap --dev-bind / / --tmpfs /tmp/proto-runner/checkout --chmod 0000 …`. In the hub's
mount namespace the checkout path is an empty directory with mode 000, so any stat, read,
`chdir` or git call on it fails with EACCES. The hub also runs under
`strace -f --seccomp-bpf -e trace=%file,%process,chdir,fchdir -P /tmp/proto-runner/checkout`,
which records every syscall, in the hub or any child process, that names that path.
**Result: across 4 hub lifetimes, 0 such syscalls.** The only lines recorded are 4
SIGTERMs from `ctl.sh` and 28 SIGCHLDs from short-lived child processes
(`prototype-2/evidence/hub-strace-all-lifetimes.txt`). Everything the hub knows about the
checkout came from the runner.

## Evidence

Timestamps are from one VM clock. The raw output is in `prototype-2/evidence/`.

### a) Turn runs on the runner and streams into hub projections

`project.create` for `workspaceRoot=/tmp/proto-runner/checkout` was accepted in 89 ms. The
hub cannot stat that path; the runner validated it through
`runner.workspace.normalizeRoot`. `thread.create` took 21 ms. Turn 1, "append a line to
notes.txt", used runtime mode `approval-required`:

```
19:17:17.733 thread.turn.start accepted in 40 ms
19:17:21.057 activity tool.started / 21.468 tool.completed        (first tool call)
19:17:22.695 activity tool.started: File change started
19:17:23.513 activity approval.requested: File-change approval requested
19:17:23.532 approval dispatched in 19 ms
19:17:23.941 activity approval.resolved / tool.completed: File change
19:17:24.782 message assistant: "done"
19:17:25.194 activity checkpoint.captured → turn completed after 7460 ms
checkpoints: turn 1 ready, notes.txt +1/-0
```

On the runner, `claude` ran with `--add-dir /tmp/proto-runner/checkout --session-id 202a75b8…`
and `notes.txt` gained the line. Streaming: the "count to 1500" turn moved 117
`content.delta` events through the outbox in 3.1 s, and the "count to 300" turn moved 151
in 4.0 s. Hub ingestion buffered them into the message, as T3 does by default
(`enableLegacyTokenStreaming=false`).

### b) Approval round trip

Approvals are produced on the runner as `request.opened`, projected by the hub as
`approval.requested`, answered by the client with `thread.approval.respond`, and routed by
`ProviderCommandReactor` → `ProviderService` → the remote adapter → the runner's
`respondToRequest`. From the client's dispatch (19:27:40.447) to the runner handling
`respondToRequest` (19:27:40.470) took **23 ms**. In the control run the dispatch alone took
13 ms, against 17–46 ms remote. Case e1 below answered an approval that was created while
the hub was down.

### c) Interrupt a running turn

"Count from 1 to 1500" was interrupted 4 s in (`turn6-interrupt.out`):

```
client 19:24:27.260 thread.turn.interrupt
runner 19:24:27.277 rpc interruptTurn ok (2 ms)       ← 17 ms end to end
outbox  #365 item.completed · #367 turn.completed {state: interrupted, "Session stopped."} · #368 session.exited
hub    turn settled 19:24:27.685, partial assistant text kept, session "stopped"
```

The local control run had the identical outcome: latestTurn `completed`, session
`stopped`, 2× `checkpoint.captured`. The Claude adapter implements interrupt as stop
session, so this is T3 behavior, not something the split introduced.

### d) Checkpoint captured on the runner; diff served through the hub

Refs `refs/t3/checkpoints/<thread>/turn/{0,1,…}` exist only in the runner's checkout.
Runner-side `checkpoint.capture` took 42–74 ms. `orchestration.getTurnDiff` over the hub's
`/ws` returned the real patch in 121 ms, including the ws-ticket request and the socket
connect (control: 91 ms):

```
diff --git a/notes.txt b/notes.txt
index f31bc06..77957df 100644
@@ -1 +1,2 @@
 hello from the runner
+edited by the remote runner
```

This is byte-identical to the control run, blob hashes included. After later turns the
per-turn summaries were still computed through the runner, for example turn 8
`notes.txt +1/-0` after the hub restart.

### e1) Hub restarted mid-turn; approval produced while the hub was down

`prototype-2/hub-restart-test.sh`, prompt "sleep 20 in the foreground, then append 'after
hub restart'":

```
19:24:56.968 command running on runner → stop hub (SIGTERM, 107 ms). Outbox head 379, acked 379.
             runner keeps working; events 380..395 appended with no hub attached
19:25:20.148 #395 request.opened file_change_approval   ← approval requested while hub down
19:25:20.590 hub start (bwrap+strace, sources via type stripping)
19:25:27.725 hub: "runner event subscription opened { afterSequence: 379 }"
19:25:28.306 client sees approval.requested → approves (46 ms) → runner respondToRequest 19:25:28.372
19:25:30.482 turn completed; notes.txt has 'after hub restart'; checkpoint turn 8 notes.txt +1/-0
hub: throughSequence 405, deliveredCount 26, duplicateCount 0
```

On restart the hub did not mark the session orphaned. `reconcileProviderSessions` asked
the remote adapters' `listSessions`, the runner reported the live session, and the session
was adopted. In the local architecture a hub restart kills the turn; here the turn
survived. The remote `stopAll` is a no-op, so hub shutdown does not stop sessions that
another machine hosts.

### e2) Runner restarted between turns; resumed through the persisted `resumeCursor`

```
19:25:51.248 stop runner (107 ms) → hub: "runner connection ended" (retries every 1 s)
19:25:56.639 runner listening: outbox loaded head 405 / acked 405, same runnerId, new bootId
19:25:57.311 hub reconnected (0.67 s) → subscription afterSequence 405
turn "which lines did you add to notes.txt earlier?":
  runner rpc startSession {resumeCursor: {resume: '202a75b8…', resumeSessionAt: '3c54100f…'}} ok 110 ms
  runner rpc sendTurn ok 1045 ms
  assistant: "edited by the remote runner\nafter hub restart"   ← memory from before both restarts
```

The runner no longer listed the session, so `hasSession` returned false and
`ProviderService.recoverSessionForThread` restarted it from the hub's
`provider_session_runtime.resume_cursor_json`. No recovery code was added. The first
restart of both processes, at 19:20, also resumed the same way.

### e3) Runner restarted mid-turn

`prototype-2/runner-restart-midturn-test.sh`. On graceful stop the runner stops its
sessions while the event pumps are still alive, so the exit events are persisted before
the process exits:

```
19:27:29.383 command running → stop runner (412 ms incl. drain)
             outbox #432 item.completed(command, failed) #434 turn.completed {interrupted} #435 session.exited
19:27:31.860 runner restarted → hub reconnected 19:27:34.44 → turn settled in hub at 19:27:34.66
follow-up turn "finish the cut-off task": startSession(resumeCursor) → approval → notes.txt 'after runner restart' ✓
```

A runner crash (SIGKILL) would lose these exit events; see the gaps below.

### Title generation through the runner

For a second thread titled "New thread", `ProviderCommandReactor` called the remote
instance's `generateThreadTitle`. The runner ran it (`runner rpc text.generateThreadTitle`
took 14.2 s, spawning a fresh Claude CLI) and the hub renamed the thread to "Capital of
France". This also showed two threads sharing one runner and the session directory.

### Totals

| Measure                               | Value                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Runner events delivered to the hub    | 478 (sequences 1–478), **0 duplicates**, 0 schema rejects, 0 runner warnings                       |
| Process lifetimes                     | 6 runner boots, 4 hub boots, 0 lost events (every head equaled the acked sequence after reconnect) |
| Outbox cost                           | ~1.05 KB per event (NDJSON), one `fsync` per append; compacted to empty once acked                 |
| Turn 1, dispatch → settled            | 7.46 s remote vs 7.89 s local control (model variance dominates)                                   |
| Added hub hops                        | approval 23 ms and interrupt 17 ms client→runner; `getTurnDiff` +30 ms vs local                    |
| Runner reconnect after restart        | 0.67 s (1 s retry loop)                                                                            |
| Hub boot to replayed approval visible | 7.7 s (Node type stripping + strace; not tuned)                                                    |

## Runner protocol (`RunnerRpcGroup`, protocol version 1)

Transport: one WebSocket to `/runner/ws`, JSON serialization, runner token in the `token`
query parameter (prototype only). Each provider call names `instanceId`; each checkpoint
call names `cwd`. Provider errors carry the original tags
(`ProviderAdapter{Validation,SessionNotFound,SessionClosed,Request,Process}Error`), and
checkpoint errors are the contracts `VcsError` union. On the hub, transport failures
(`RunnerUnavailableError`, `RpcClientError`) become `ProviderAdapterRequestError` or
`VcsRepositoryDetectionError`, so upstream error handling is unchanged.

| RPC                                                                                            | Payload → success                                                                  |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `runner.hello`                                                                                 | {} → `{protocolVersion, runnerId, bootId, headSequence, ackedSequence, instances}` |
| `runner.provider.startSession`                                                                 | `{instanceId, input: ProviderSessionStartInput}` → `ProviderSession`               |
| `runner.provider.sendTurn`                                                                     | `{instanceId, input: ProviderSendTurnInput}` → `ProviderTurnStartResult`           |
| `runner.provider.interruptTurn` / `stopSession`                                                | `{instanceId, threadId, turnId?}` → void                                           |
| `runner.provider.respondToRequest` / `respondToUserInput`                                      | `{instanceId, threadId, requestId, decision \| answers}` → void                    |
| `runner.provider.listSessions`                                                                 | `{instanceId}` → `ProviderSession[]` (answers `hasSession` too)                    |
| `runner.provider.readThread` / `rollbackThread`                                                | `{instanceId, threadId, numTurns?}` → `{threadId, turns[]}`                        |
| `runner.provider.getCapabilities`                                                              | `{instanceId, refresh?}` → `{snapshot: ServerProvider, sessionModelSwitch}`        |
| `runner.text.generateThreadTitle` / `generateBranchName`                                       | title/branch input + `instanceId` → `{title}` / `{branch}`                         |
| `runner.events.subscribe` (stream)                                                             | `{afterSequence}` → stream of `{sequence, bootId, event: ProviderRuntimeEvent}`    |
| `runner.events.ack`                                                                            | `{throughSequence}` → `{ackedSequence, retained}`                                  |
| `runner.checkpoint.isGitRepository` / `capture` / `hasRef` / `restore` / `diff` / `deleteRefs` | `CheckpointStore` inputs → bool / void / bool / bool / patch / void                |
| `runner.workspace.normalizeRoot`                                                               | `{workspaceRoot, createIfMissing?}` → normalized path \| `RunnerWorkspaceError`    |

The hub keeps `ProviderService` unchanged. It still persists resume cursors and cwd,
mints MCP credentials, holds the per-thread lifecycle locks, and runs recovery. The runner
stamps `providerInstanceId` on every event before appending it, so the hub fans events
out by instance.

## Event outbox

**Prototype** (`RunnerOutbox.ts`):

- Every adapter's `streamEvents` is piped into `append`. Each event is schema-encoded as
  one NDJSON line with `sequence = head + 1` and the current `bootId`, written with
  `writeSync`, `fsync`ed, and only then published to live subscribers. An event that fails
  the wire schema is counted and dropped, so it cannot poison every subscription. None
  were dropped in this run.
- `subscribe(after)` subscribes to the live PubSub first, then replays retained entries
  with `sequence > after`, then tails live entries past the replay point. There is no gap
  and no overlap.
- `ack(n)` persists `outbox-ack.json`, drops acknowledged entries, and rewrites the file
  when it is empty or when 500 acknowledged lines have accumulated. It is atomic
  (tmp + rename, fd reopened).
- On load, unparseable (torn) lines are discarded, and `head = max(file, acked)`, so
  sequences keep increasing across restarts. `runner-id` is stable; `bootId` changes on
  every start.
- Hub (`RunnerClient` + `RunnerDelivery`): it subscribes from its persisted cursor
  (`runner-client-cursor.json`, reset if `runnerId` changes) and drops any
  `sequence <= delivered`. Every 500 ms it drains `ProviderRuntimeIngestion`, then writes
  the cursor and acks. Delivery waits for server activation plus 500 ms, so ingestion is
  subscribed before replay starts.
- Guarantee: at-least-once, in order, per runner. After a hub crash, events ingested
  inside the last ack window (≤ 500 ms) could be ingested again, because ingestion command
  ids are random.

**Production design:**

1. Runner outbox in the machine's SQLite, in the checkout's state disk that survives
   pause and recreation: `(sequence PK, boot_id, event_json, created_at)`, with an ack
   watermark and size- and time-based retention. If an event past retention is still
   unacknowledged, the hub must resynchronize from `readThread`.
2. The hub stores `runner_cursor(thread_machine_id, acked_sequence)` in the same Postgres
   transaction as the orchestration events that ingestion produced. Ingestion also dedups
   on `(machine, sequence)`, so replay is exactly-once in effect, and ack becomes a
   notification rather than a correctness step.
3. The hub consumes through the control-plane tunnel, one subscription per awake thread
   machine. Sequence and `bootId` gaps are explicit signals (see crash reconciliation
   below).
4. Backpressure: the runner keeps writing while the hub is away, and the outbox is the
   buffer. The hub bounds the replay batch and paces delivery against the ingestion
   queue depth.

## Hub-side call sites that touch the checkout, and how each was handled

A read-only survey by a subagent found about 60 call sites. The hot path is marked 🔥.
This table covers the ones that matter for the split.

| Call site                                                                                                                                             | What it does                                        | Handling in this prototype                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 🔥 `CheckpointReactor` `resolveCheckpointCwd` and the revert check (was sync `isGitRepository`)                                                       | `.git` existence                                    | **Delegated** through `CheckoutGitProbe` → `runner.checkpoint.isGitRepository` (same `.git` rule)                            |
| 🔥 `ProviderRuntimeIngestion` `turn.diff.updated` placeholder (sync `isGitRepository`)                                                                | `.git` existence                                    | **Delegated** (same probe)                                                                                                   |
| 🔥 `CheckpointStore` capture/hasRef/restore/diff/deleteRefs (CheckpointReactor, CheckpointDiffQuery)                                                  | git plumbing in cwd                                 | **Delegated** (`RemoteCheckpointStore`, cwd-keyed)                                                                           |
| 🔥 `Normalizer` `project.create`/`meta.update` → `WorkspacePaths.normalizeWorkspaceRoot`                                                              | stat / mkdir -p                                     | **Delegated** (`runner.workspace.normalizeRoot`); relative-path resolution stays pure on the hub                             |
| 🔥 `ProviderService` → adapters (`startSession` cwd, turns, approvals, interrupt, rollback, readThread)                                               | spawn provider CLI in cwd                           | **Delegated** (remote driver)                                                                                                |
| 🔥 `ProviderCommandReactor` first-turn title / branch-name generation                                                                                 | provider CLI in cwd                                 | **Delegated** (remote `textGeneration`); commit/PR/structured generation **fail** with "not delegated"                       |
| 🔥 `ProjectionSnapshotQuery` via `RepositoryIdentityResolver` (every shell snapshot, project lookups, reactors, watchdog seed)                        | `git rev-parse` + `git remote -v`                   | **Stubbed** (identity `null`). Production: persist identity on the project, reported by the runner                           |
| 🔥 `CheckpointReactor` → `WorkspaceEntries.refresh` after capture                                                                                     | stat + file-index rescan                            | **Stubbed** (no-op); search/list/browse return empty                                                                         |
| 🔥 `CheckpointReactor.refreshLocalGitStatusFromTurnCompletion`, CommandDispatcher bootstrap, `vcs*` RPCs → `VcsStatusBroadcaster`                     | realpath + git status/fetch                         | **Stubbed** (fails with "not delegated"; logged once per turn). Branch-drift following is off. The sidebar has no git status |
| `ProviderCommandReactor.ensureThreadWorktree` (turn start when the thread has a worktree)                                                             | `fs.exists(worktreePath)`, `git worktree prune/add` | **Still broken** (not exercised; local-mode threads have no worktree). It would stat the hub's disk and then run git locally |
| `ProviderCommandReactor` worktree branch rename (`git branch -m`) + `refreshStatus`                                                                   | git in worktree                                     | **Still broken** (worktree mode only)                                                                                        |
| `CommandDispatcher` bootstrap: `git fetch`, `worktree add`, setup script → `ProjectSetupScriptRunner` → terminal PTY                                  | git + PTY in the checkout                           | **Still broken** (the prototype uses `/api/orchestration/dispatch`, which bypasses bootstrap)                                |
| `ThreadSettlementReactor` sweep → `GitManager.branchPullRequest({cwd: workspaceRoot})` (every minute, threads with branches)                          | git remote/for-each-ref + gh                        | **Still broken** (not exercised; the test threads have `branch: null`)                                                       |
| `ws.ts`: file search/read/write, `filesystemBrowse`, terminals, VCS/git/PR actions, review diff preview, open in editor, source-control clone/publish | FS, PTY, git, gh in cwd                             | **Still local**, so they fail on a hub. Need routed runner RPCs                                                              |
| `http.ts` asset routes (project favicon, workspace/media files), `ProjectFaviconResolver`, `T3ProjectFileLoader` (`t3.json`)                          | stat/read files in the checkout                     | **Still local** (UI only). Proxy to the runner or persist on the hub                                                         |
| `workflowScriptQuery` (reads `~/.claude/projects/...`)                                                                                                | provider home on the machine                        | **Still local**; belongs on the runner                                                                                       |
| Server cwd fallbacks (`?? process.cwd()` for title cwd, OpenCode `directory: serverConfig.cwd`, probes)                                               | provider work in the server cwd                     | Harmless on the hub because nothing spawns there. Runner probes use the runner cwd                                           |

## What breaks or is missing

- **Terminals.** `TerminalManager` still runs on the hub. The RPCs are already keyed by
  `threadId`, so they need a routed streaming runner service (PTY data, resize, restart,
  port scanning for previews).
- **Workspace file RPCs.** Search, read and write, `@`-mention indexing (the hub stub
  returns empty lists), and filesystem browse for the project picker. Browse must target
  the machine that will own the project.
- **VCS status.** Stubbed, so the sidebar has no git status, branch-drift following is
  off, and there is no PR and branch lookup. Production needs the runner to push status
  into a hub cache (the design's "caches that keep machines asleep"), and routed RPCs for
  pull, commit, push and create PR.
- **Attachments.** The hub writes uploads to its own `attachmentsDir`, but the runner's
  adapter reads `<runner attachmentsDir>/<id>`. A turn with an image fails or loses the
  image. Uploads need to be copied to the runner with each turn and the paths rewritten.
  The `ChatAttachment` ids already carry through `sendTurn`.
- **MCP endpoint.** `ProviderService.prepareMcpSession` mints the credential in the hub
  and stores it in the hub process's `McpProviderSession` global. The runner's
  `ClaudeAdapter` reads its own global and finds nothing, so agents get no `t3-code` MCP
  tools (browser, review). The credential and the hub's public MCP URL have to travel in
  `startSession`, which means extending `ProviderSessionStartInput` or adding an MCP field
  to the protocol.
- **Text generation.** Title and branch generation are delegated and work (14 s, same
  path as local). Commit message, PR content and `generateStructured` fail; the schema is
  not serializable, so the runner needs to own those callers (git actions) instead.
- **Auth connector and provider sign-in.** `authConnector` still runs CLI logins where the
  hub is. It must run on the runner, or be replaced by the credential service.
  Provider maintenance (update CLI) and usage scanning are runner or host concerns too.
- **Provider settings sync.** The runner reads its own `settings.json`. The hub's provider
  instance config (binary path, env, custom instances, enabled flags) is not pushed; the
  hub's remote instance only mirrors id, kind, display name and enabled. The runner hosts
  only `claudeAgent` and `codex` (`T3CODE_RUNNER_DRIVERS`), and the other kinds show as
  unavailable. The snapshot and model list are fetched once at hub boot and on `refresh`,
  with no push from the runner. `continuationIdentity` uses the default key rather than
  Claude's HOME-based group key. `sessionModelSwitch` is hard-coded to `in-session` on the
  hub. `uploadFeedback` is not forwarded.
- **Runner crash (SIGKILL) mid-turn.** No exit events are written, so the hub turn stays
  `running` until `TurnLivenessWatchdog` fires (10 min silence). Fix: when a reconnect
  shows a new `bootId`, the hub diffs its active bindings against the runner's
  `listSessions` and synthesizes `session.exited` and an interrupted `turn.completed` for
  the missing sessions. The graceful path is covered by the shutdown drain (e3).
- **`hasSession`/`listSessions` go to the runner on every routed call**, and startup
  reconcile calls every runner. With sleeping machines this wakes them. The hub should
  answer from the session directory plus runner-pushed lifecycle events, and treat
  "machine asleep" as "session resumable", as the design says.
- **Hub shutdown semantics.** `ProviderService`'s finalizer still marks every binding
  `stopped` on hub exit, even though the runner keeps the session. It is harmless here
  because routing asks the runner, but the directory is wrong until the next event.
- **Routing.** There is one runner URL per hub. Adapter calls are keyed by `threadId` and
  route easily. `listSessions`, `stopAll` and the cwd-keyed `CheckpointStore` need to
  become thread-keyed, or resolve thread by cwd, to pick a machine.
- **Security.** A static shared token sits in the query string. Production uses the
  control-plane execution token over the machine's outbound tunnel. The hub never dials
  machines directly.

Provider behavior seen in these runs; the split did not cause it, and the control run
matches:

- Claude interrupt stops the session, and T3 projects an interrupted turn as `completed`.
- The user's Claude settings (`--setting-sources=user,…`) auto-allow `Bash`, so only file
  edits asked for approval.
- The model backgrounded a `sleep 45`. After resume, Claude reported the stopped
  background task as a separate short turn.

## Productionization plan (rough size)

| Step | Work                                                                                                                                                                                                         | Size (files / lines)  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| 1    | Move `RunnerRpcGroup` into contracts with versioning. Hub and runner become separate compositions (`hub.ts`, `runner.ts`) instead of `byRunnerMode` switches, and host layers are dropped from the hub build | 6 / ~700              |
| 2    | Per-thread routing: a `ThreadMachineDirectory` (thread → machine, connection pool, wake through the control plane); thread-keyed `CheckpointStore`/`CheckpointDiffQuery` API                                 | 8 / ~900              |
| 3    | Durable delivery: SQLite outbox on the runner, cursor stored in the same transaction as projection writes plus `(machine, sequence)` dedup, `bootId` crash reconciliation                                    | 6 / ~800 + migration  |
| 4    | Session state on the hub: `hasSession`/`listSessions` from the directory plus pushed lifecycle, "asleep = resumable", remote-aware `stopAll`/finalizer                                                       | 4 / ~350              |
| 5    | Hub caches: persisted repository identity, pushed VCS status, per-turn diffs in `checkpoint_diff_blobs`, so history and diffs never wake a machine                                                           | 8 / ~900 + migrations |
| 6    | Routed runner services for `ws.ts`: terminals (streaming), workspace files and search, VCS/git/PR/review, assets and favicon, worktree/bootstrap/setup scripts                                               | 15 / ~2,500           |
| 7    | Attachments shipped with turns; MCP credential and URL in `startSession`; provider settings push and credential-service login; auth connector on the runner                                                  | 8 / ~1,000            |
| 8    | Contract tests that run the existing adapter/reactor suites through a loopback runner, plus a hub and runner e2e in CI                                                                                       | 6 / ~800              |

That totals about 60 files and ~8,000 lines. Steps 1–4 are the milestone-1 core, about
2,700 lines. Steps 5–7 are needed before the product loses its always-on machine.

**Risks:**

- **Fork divergence.** `server.ts` composition, `ProviderService` session semantics, the
  reactors and `ws.ts` routing are hot upstream files, so every upstream merge touches
  them. Keep the seams narrow: driver, `CheckpointStore`, probes, routed services.
- **Resume fidelity.** Resume depends on the provider's own session files on the machine
  (`~/.claude/projects/<cwd-slug>/<session>.jsonl`) and on the checkout living at an
  identical absolute path. Recreate from snapshot must preserve both, and prototype 3
  should verify it.
- **Wake latency.** Every uncached hub read or `hasSession` call becomes a machine wake.
  Missing a cache turns a fast UI into a spinner.
- **Exactly-once ingestion.** This needs the cursor and projection write in one
  transaction. Without it, crash windows duplicate deltas and activities.
- **Security surface.** The runner executes whatever the hub sends. Its authentication
  must be per-machine, scoped and short-lived.
- **Provider-specific behavior.** Background tasks and synthetic turns after resume show
  up more often when machines restart freely. The UI must handle them gracefully.

## Cleanup

Every process started for this prototype has been stopped (hub, runner, local control).
`/tmp/proto-runner` holds the throwaway checkouts, state directories and logs. Claude
Code wrote its normal session files under
`~/.claude/projects/-tmp-proto-runner-{checkout,control-checkout}` (about 0.5 MB). No
credential file was read, copied or modified by this work.
