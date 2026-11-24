# Managed workspaces and generation-1 machines

Aldo runs one T3 server per cloud machine and keeps machines on the server they were created
with. Machines from before Orchestration V2 ("generation 1", wire protocol 1) therefore coexist
with current ones, and two pieces of code exist only to bridge them.

## `/api/_devpc` keeps the first model's shapes

Aldo's control plane and the coordinator beside the server reach a managed workspace through
[`/api/_devpc/*`](../../apps/server/src/managedDevPc/http.ts): activity, drain, dispatch, the
shell or one thread's snapshot, and the provider list. One Aldo client reads every machine, so
these routes accept and answer in the shapes of T3's first orchestration model on both
generations. [`legacyCommands.ts`](../../apps/server/src/managedDevPc/legacyCommands.ts) and
[`legacyProjection.ts`](../../apps/server/src/managedDevPc/legacyProjection.ts) translate at the
edge; nothing V1-shaped reaches orchestration. Change a shape only together with Aldo.

A thread read answers `x-devpc-paged: 1` because only the current server honours `turnLimit` and
`beforeCursor`; a generation-1 machine ignores both and returns the whole thread.

The routes answer 404 unless the server runs with `T3CODE_MANAGED_DEVPC` and the caller sends the
gateway token in `x-devpc-gateway-token`. The server takes that token out of its environment as it
starts ([`managedGatewayToken.ts`](../../apps/server/src/managedGatewayToken.ts)), so the agents and
terminals it spawns never inherit it.

## The client's generation-1 adapter

[`packages/client-runtime/src/legacyV1/`](../../packages/client-runtime/src/legacyV1) lets the
current client talk to a protocol-1 server by mapping its commands, snapshots and events to and
from V2. It is off unless the host provides `LegacyOrchestrationSupport`, which only the Aldo
cloud build does; everywhere else an older server is refused as before. Features that exist only
in V2 are listed beside `isLegacyOrchestration` in
[`compatibility.ts`](../../packages/client-runtime/src/connection/compatibility.ts) and are unavailable
on such a machine.

Both the adapter and the `x-devpc-paged` distinction can be deleted once Aldo has no generation-1
machine left. The V1 shapes of `/api/_devpc` stay until Aldo's own client moves to V2.

## Turns nobody is watching

A managed workspace has no one to notice a silent provider, so
[`TurnLivenessWatchdog.ts`](../../apps/server/src/managedDevPc/TurnLivenessWatchdog.ts) interrupts
a stalled turn and continues it a bounded number of times. `T3CODE_TURN_WATCHDOG=0` turns it off;
`T3CODE_TURN_STALL_SECONDS`, `T3CODE_TURN_RECOVERY_GRACE_SECONDS` and `T3CODE_TURN_AUTO_RETRIES`
tune it.
