# Managed Aldo Agent integration

Managed builds expose Aldo Agent in the workspace sidebar. The conversation iframe is
served by the managed gateway at `/_aldo/agent`; T3 does not hold voice-provider keys or
run the coordinator model. The shell (`ManagedDevPcAgent.tsx`) renders it as a one-row bar
(`AldoAgentBar`, 52 px plus the bottom safe area) at the bottom of the main content column
in `AppSidebarLayout`, on desktop and mobile alike, so the workspace above stays fully
visible and usable while talking: a waveform, one line of captions, and controls for
typing, push-to-talk, the memory editor and closing. Nothing takes over the screen. The
provider sits above the responsive sidebar so navigation does not unmount an opened
session. Closing unmounts the frame and disconnects voice; delegated T3 work remains
independent. `Mod+Shift+A` shows Aldo and starts (or ends) a conversation; with
push-to-talk on, holding Space anywhere in the shell opens the microphone.

## Frame protocol (same-origin `postMessage`)

Page to shell:

- `aldo-agent:ready` when the page mounts; the shell replies with the layout and queued
  commands.
- `aldo-agent:state` `{ phase, live, said, heard, pushToTalk, pressed, error }` on every
  change; the sidebar entry and the dock header mirror it.
- `aldo-agent:event` `{ event }` relayed from the coordinator's `aldo.events` data topic:
  `{ type: "action", tool, threadId?, title? }` after a workspace change, or
  `{ type: "navigate", target: "thread" | "diff" | "approvals", threadId }` when Aldo
  wants the user to see something. Actions become toasts with the thread's model,
  reasoning and permissions, an Open action, and Approve/Decline buttons when the thread
  is waiting on an approval; navigation opens the thread (and its diff panel).
- `aldo-agent:close` when the page asks the shell to hide the bar (its close control).
- `aldo-agent:memory` when the page asks the shell to open the memory editor.

Shell to page, as `{ type: "aldo-agent:command", command, ... }`:

- `layout` `{ layout: "bar" | "full" }` (the shell always sends `bar`)
- `connect` / `disconnect`
- `push-to-talk` `{ enabled }` and `press` `{ pressed }`
- `text` `{ text }` sends typed input; `discuss` `{ threadId, title }` opens a
  conversation about one thread ("Talk about it" on a nudge).

Threads the coordinator starts have ids prefixed `aldo-` and carry an "Aldo" badge in
the sidebar. The shell nudges with a toast when any thread starts waiting on an approval
or a question, and when an Aldo-started thread finishes or fails, unless that thread is
already open. The memory editor at `/_aldo/agent/memory` opens over the app from the
bar's book control.

## Server routes

`GET /api/_devpc/agent/snapshot` returns the current shell projection to the workspace
coordinator. With `?threadId=...`, it returns that thread's detail snapshot bounded to
three turns. `GET /api/_devpc/agent/providers` returns enabled provider instances with
their models and each model's selectable options, so the coordinator can start threads on
a named provider, model and reasoning level. All require managed mode and
`x-devpc-gateway-token`; absent or invalid capabilities receive 404. Responses are
private and uncacheable. These routes use the same workspace-local capability as managed
dispatch and are not a new public agent authorization mechanism.

The coordinator sends work through the existing durable managed dispatch endpoint.
Task creation therefore retains T3's ordinary command receipts, bootstrap transaction,
worktree preparation, provider execution, and approval behavior.
