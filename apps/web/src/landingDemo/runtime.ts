import {
  EnvironmentId,
  EventId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  WS_METHODS,
  type ClientOrchestrationCommand,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
  type ServerConfig,
} from "@t3tools/contracts";
import {
  RpcSessionFactory,
  type RpcSession,
  type WsRpcProtocolClient,
} from "@t3tools/client-runtime/rpc";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  LANDING_DEMO_ENVIRONMENT_ID,
  LANDING_DEMO_PROJECT_ID,
  LANDING_DEMO_THREAD_ID,
} from "./mode";

export const demoEnvironmentId = EnvironmentId.make(LANDING_DEMO_ENVIRONMENT_ID);
export const demoProjectId = ProjectId.make(LANDING_DEMO_PROJECT_ID);
export const demoThreadId = ThreadId.make(LANDING_DEMO_THREAD_ID);
const demoProviderId = ProviderInstanceId.make("codex");
const STARTED_AT = "2026-07-31T12:00:00.000Z";

const initialFiles = {
  "index.html": `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Northstar</title><link rel="stylesheet" href="styles.css" /></head>
  <body>
    <main class="hero">
      <nav><strong>Northstar</strong><a href="#features">Features</a><a href="#about">About</a></nav>
      <section><p class="eyebrow">A SMALL TEAM WITH A BIG IDEA</p><h1>Build what matters.</h1><p class="lede">A focused workspace for turning ambitious ideas into products people love.</p><button>Start building</button></section>
    </main>
  </body>
</html>`,
  "styles.css": `:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui; background: #090b10; color: #f8fafc; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 75% 20%, #243456 0, transparent 33%), #090b10; }
.hero { min-height: 100vh; padding: 32px 7vw; }
nav { display: flex; align-items: center; gap: 28px; color: #aeb7c8; font-size: 14px; }
nav strong { color: white; margin-right: auto; font-size: 18px; }
nav a { color: inherit; text-decoration: none; }
section { max-width: 720px; padding-top: 19vh; }
.eyebrow { color: #8ca8df; font-size: 12px; font-weight: 700; letter-spacing: .18em; }
h1 { margin: 16px 0; font-size: clamp(54px, 9vw, 104px); line-height: .92; letter-spacing: -.07em; }
.lede { max-width: 570px; color: #aeb7c8; font-size: 20px; line-height: 1.6; }
button { margin-top: 22px; border: 0; border-radius: 999px; padding: 14px 24px; font-weight: 700; color: #101522; background: #b9d2ff; }`,
  "package.json": `{"name":"northstar-demo","private":true,"scripts":{"build":"echo Build passed","lint":"echo Lint passed","test":"echo Tests passed"}}`,
} satisfies Record<string, string>;

let files: Record<string, string> = { ...initialFiles };
let snapshotSequence = 1;
let nextId = 1;
const previewListeners = new Set<() => void>();
const threadListeners = new Set<(item: OrchestrationThreadStreamItem) => void>();

const welcomeMessage: OrchestrationMessage = {
  id: MessageId.make("demo-welcome"),
  role: "assistant",
  text: "This is the real Aldo interface running a safe, browser-local project. Ask me to inspect the site, change its design, or add a section—the preview updates as I work.",
  turnId: null,
  streaming: false,
  createdAt: STARTED_AT,
  updatedAt: STARTED_AT,
};

let thread: OrchestrationThread = {
  id: demoThreadId,
  projectId: demoProjectId,
  title: "Make the homepage unforgettable",
  modelSelection: { instanceId: demoProviderId, model: "openai/gpt-oss-20b:free" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt: STARTED_AT,
  updatedAt: STARTED_AT,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [welcomeMessage],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: {
    threadId: demoThreadId,
    status: "ready",
    providerName: "OpenRouter demo",
    providerInstanceId: demoProviderId,
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: STARTED_AT,
  },
};

const project: OrchestrationProjectShell = {
  id: demoProjectId,
  title: "Northstar landing page",
  workspaceRoot: "/demo/northstar",
  repositoryIdentity: null,
  defaultModelSelection: { instanceId: demoProviderId, model: "openai/gpt-oss-20b:free" },
  scripts: [],
  createdAt: STARTED_AT,
  updatedAt: STARTED_AT,
};

function threadShell() {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestTurn: thread.latestTurn,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    settledOverride: thread.settledOverride,
    settledAt: thread.settledAt,
    session: thread.session,
    latestUserMessageAt:
      thread.messages.findLast((message) => message.role === "user")?.createdAt ?? null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as const;
}

function shellSnapshot(): OrchestrationShellSnapshot {
  return {
    snapshotSequence,
    projects: [project],
    threads: [threadShell()],
    updatedAt: thread.updatedAt,
  };
}

function threadSnapshot(): OrchestrationThreadDetailSnapshot {
  return { snapshotSequence, thread };
}

function broadcastThread() {
  snapshotSequence += 1;
  const item: OrchestrationThreadStreamItem = { kind: "snapshot", snapshot: threadSnapshot() };
  for (const listener of threadListeners) listener(item);
}

function callbackStream<T>(listeners: Set<(item: T) => void>) {
  return Stream.callback<T>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const listener = (item: T) => Queue.offerUnsafe(queue, item);
        listeners.add(listener);
        return listener;
      }),
      (listener) => Effect.sync(() => listeners.delete(listener)),
    ).pipe(Effect.asVoid),
  );
}

function subscribeThread(): Stream.Stream<OrchestrationThreadStreamItem> {
  return Stream.concat(
    Stream.fromIterable<OrchestrationThreadStreamItem>([
      { kind: "snapshot", snapshot: threadSnapshot() },
      { kind: "synchronized" },
    ]),
    callbackStream(threadListeners),
  );
}

function subscribeShell(): Stream.Stream<OrchestrationShellStreamItem> {
  return Stream.concat(
    Stream.fromIterable<OrchestrationShellStreamItem>([
      { kind: "snapshot", snapshot: shellSnapshot() },
      { kind: "synchronized" },
    ]),
    Stream.never,
  );
}

export const demoServerConfig = {
  environment: {
    id: demoEnvironmentId,
    label: "Aldo browser demo",
    serverVersion: "0.0.28",
    capabilities: { connectionProbe: false },
  },
  auth: { mode: "none" },
  cwd: "/demo/northstar",
  keybindingsConfigPath: "/demo/keybindings.json",
  keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
  issues: [],
  providers: [
    {
      instanceId: demoProviderId,
      driver: "codex",
      displayName: "OpenRouter demo",
      badgeLabel: "Free demo",
      enabled: true,
      installed: true,
      version: "browser",
      status: "ready",
      auth: { status: "authenticated", label: "Provided by Aldo" },
      checkedAt: STARTED_AT,
      availability: "available",
      models: [
        {
          slug: "openai/gpt-oss-20b:free",
          name: "OpenRouter demo",
          shortName: "Demo",
          isCustom: true,
          isDefault: true,
          capabilities: null,
        },
      ],
      slashCommands: [],
      skills: [],
    },
  ],
  availableEditors: [],
  observability: {
    logsDirectoryPath: "/demo/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
  shellResumeCompletionMarker: true,
  threadResumeCompletionMarker: true,
} as unknown as ServerConfig;

type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: DemoToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type DemoToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function safePath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const normalized = path.replace(/^\.\//, "").replace(/^\/+/, "");
  return normalized in files ? normalized : null;
}

function runTool(call: DemoToolCall): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return "Invalid tool arguments.";
  }
  switch (call.function.name) {
    case "list_files":
      return Object.keys(files).sort().join("\n");
    case "read_file": {
      const path = safePath(args.path);
      return path ? files[path]! : "File not found.";
    }
    case "search_files": {
      const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
      return (
        Object.entries(files)
          .filter(([, content]) => content.toLowerCase().includes(query))
          .map(([path]) => path)
          .join("\n") || "No matches."
      );
    }
    case "write_file": {
      const path = safePath(args.path);
      if (!path || typeof args.content !== "string")
        return "Only existing demo files can be edited.";
      files = { ...files, [path]: args.content };
      for (const listener of previewListeners) listener();
      return `Updated ${path}.`;
    }
    case "run_command":
      return ["npm test", "npm run build", "npm run lint"].includes(String(args.command))
        ? `${String(args.command)} completed successfully.`
        : "That command is not available in the browser demo.";
    default:
      return "Unknown tool.";
  }
}

function appendActivity(summary: string, turnId: ReturnType<typeof TurnId.make>) {
  thread = {
    ...thread,
    activities: [
      ...thread.activities,
      {
        id: EventId.make(`demo-activity-${nextId++}`),
        tone: "tool",
        kind: "tool",
        summary,
        payload: {},
        turnId,
        createdAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  broadcastThread();
}

async function runAgent(userText: string, turnId: ReturnType<typeof TurnId.make>) {
  const history: AgentMessage[] = thread.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.text }));
  if (history.at(-1)?.role !== "user") history.push({ role: "user", content: userText });

  try {
    for (let round = 0; round < 8; round += 1) {
      const response = await fetch("/api/demo/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: { content?: string | null; tool_calls?: DemoToolCall[] };
      };
      if (!response.ok || !payload.message)
        throw new Error(payload.error || "The demo model is unavailable.");
      history.push({ role: "assistant", ...payload.message });
      if (payload.message.tool_calls?.length) {
        for (const call of payload.message.tool_calls) {
          appendActivity(`${call.function.name.replaceAll("_", " ")}…`, turnId);
          const result = runTool(call);
          history.push({ role: "tool", tool_call_id: call.id, content: result });
        }
        continue;
      }
      const text = payload.message.content?.trim() || "I finished the browser-local update.";
      const now = new Date().toISOString();
      const assistantId = MessageId.make(`demo-assistant-${nextId++}`);
      thread = {
        ...thread,
        messages: [
          ...thread.messages,
          {
            id: assistantId,
            role: "assistant",
            text,
            turnId,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        latestTurn: thread.latestTurn
          ? {
              ...thread.latestTurn,
              state: "completed",
              completedAt: now,
              assistantMessageId: assistantId,
            }
          : null,
        session: thread.session
          ? { ...thread.session, status: "ready", activeTurnId: null, updatedAt: now }
          : null,
        updatedAt: now,
      };
      broadcastThread();
      return;
    }
    throw new Error("The demo reached its tool-use limit.");
  } catch (error) {
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : "The demo model is unavailable.";
    thread = {
      ...thread,
      messages: [
        ...thread.messages,
        {
          id: MessageId.make(`demo-error-${nextId++}`),
          role: "assistant",
          text: message,
          turnId,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      latestTurn: thread.latestTurn
        ? { ...thread.latestTurn, state: "error", completedAt: now }
        : null,
      session: thread.session
        ? {
            ...thread.session,
            status: "error",
            activeTurnId: null,
            lastError: message,
            updatedAt: now,
          }
        : null,
      updatedAt: now,
    };
    broadcastThread();
  }
}

function dispatchCommand(command: ClientOrchestrationCommand) {
  return Effect.sync(() => {
    if (command.type !== "thread.turn.start") return { sequence: snapshotSequence };
    const now = command.createdAt;
    const turnId = TurnId.make(`demo-turn-${nextId++}`);
    thread = {
      ...thread,
      messages: [
        ...thread.messages,
        {
          id: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: [],
          turnId,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        assistantMessageId: null,
      },
      session: {
        threadId: demoThreadId,
        status: "running",
        providerName: "OpenRouter demo",
        providerInstanceId: demoProviderId,
        runtimeMode: "full-access",
        activeTurnId: turnId,
        lastError: null,
        updatedAt: now,
      },
      updatedAt: now,
    };
    broadcastThread();
    void runAgent(command.message.text, turnId);
    return { sequence: snapshotSequence };
  });
}

const streamingMethods = new Set<string>([
  WS_METHODS.subscribeVcsStatus,
  WS_METHODS.subscribeTerminalEvents,
  WS_METHODS.subscribeTerminalMetadata,
  WS_METHODS.subscribePreviewEvents,
  WS_METHODS.subscribeDiscoveredLocalServers,
  WS_METHODS.subscribeAuthAccess,
]);

const client = new Proxy(
  {
    [WS_METHODS.serverGetConfig]: () => Effect.succeed(demoServerConfig),
    [WS_METHODS.serverProbe]: () => Effect.succeed({}),
    [WS_METHODS.assetsCreateUrl]: () =>
      Effect.succeed({ relativeUrl: "/favicon.ico", expiresAt: 4_102_444_800_000 }),
    [WS_METHODS.subscribeServerConfig]: () =>
      Stream.concat(
        Stream.make({ version: 1 as const, type: "snapshot" as const, config: demoServerConfig }),
        Stream.never,
      ),
    [WS_METHODS.subscribeServerLifecycle]: () =>
      Stream.concat(
        Stream.make(
          {
            version: 1 as const,
            sequence: 1,
            type: "welcome" as const,
            payload: {
              environment: demoServerConfig.environment,
              cwd: demoServerConfig.cwd,
              projectName: project.title,
              bootstrapProjectId: demoProjectId,
              bootstrapThreadId: demoThreadId,
            },
          },
          {
            version: 1 as const,
            sequence: 2,
            type: "ready" as const,
            payload: { at: STARTED_AT, environment: demoServerConfig.environment },
          },
        ),
        Stream.never,
      ),
    [ORCHESTRATION_WS_METHODS.subscribeShell]: subscribeShell,
    [ORCHESTRATION_WS_METHODS.subscribeThread]: subscribeThread,
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: dispatchCommand,
    [WS_METHODS.vcsListRefs]: () =>
      Effect.succeed({
        refs: [],
        isRepo: true,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 0,
      }),
    [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: () => Effect.succeed({ patch: "", files: [] }),
    [ORCHESTRATION_WS_METHODS.getTurnDiff]: () => Effect.succeed({ patch: "", files: [] }),
  } as Record<string, unknown>,
  {
    get(target, property) {
      if (typeof property !== "string") return Reflect.get(target, property);
      if (property in target) return target[property];
      if (streamingMethods.has(property) || property.startsWith("subscribe"))
        return () => Stream.never;
      return () => Effect.succeed({});
    },
  },
) as unknown as WsRpcProtocolClient;

const session: RpcSession = {
  client,
  initialConfig: Effect.succeed(demoServerConfig),
  ready: Effect.void,
  probe: Effect.void,
  closed: Effect.never,
};

export const landingDemoRpcSessionLayer = Layer.succeed(
  RpcSessionFactory,
  RpcSessionFactory.of({ connect: () => Effect.succeed(session) }),
);

export function subscribeDemoPreview(listener: () => void) {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

export function getDemoPreviewDocument() {
  const html = files["index.html"] ?? "";
  const css = files["styles.css"] ?? "";
  return html.replace(/<link[^>]+href=["']styles\.css["'][^>]*>/i, `<style>${css}</style>`);
}

export function resetDemoFiles() {
  files = { ...initialFiles };
  for (const listener of previewListeners) listener();
}
