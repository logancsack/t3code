import { setActiveEnvironmentId } from "../state/entities";
import { EventId, MessageId, TurnId, ProviderInstanceId } from "@t3tools/contracts";
import type { AldoHome } from "../aldo/homeApi";
import { useAldoAssistant, type AldoConversationEntry } from "../aldo/assistantSession";
import { useAldoHomeFeed, useAldoHomeReadAt } from "../aldo/homeFeed";
import { useAldoSimple } from "../aldo/simpleMode";
import { demoEnvironmentId, demoThreadId, setWorkReplayThread } from "./runtime";

/** Data only. Layout and styling belong entirely to the production components. */
export interface WorkReplayScript {
  id: string;
  title: string;
  project: string;
  request: string;
  reply: string;
  result: string;
  steps: { at: number; active: string; complete: string; detail: string }[];
  files: { at: number; title: string; type: string; href: string }[];
  timing: {
    sent: number;
    reply: number;
    thread: number;
    result: number;
    home: number;
    end: number;
  };
}
// The app reads a scripted clock too: timestamps stay stable across polls,
// and every loop shows the same native elapsed-time labels.
const wallNow = Date.now;
let replayNow = wallNow();
let clockStarted = false;
let startedAt = new Date(replayNow);
Date.now = () => replayNow;
const iso = (offset: number) => new Date(startedAt.getTime() + offset).toISOString();
const target = { environmentId: demoEnvironmentId, threadId: demoThreadId };
export function homeFor(script: WorkReplayScript, at: number): AldoHome {
  const finished = at >= script.timing.result;
  return {
    at: iso(at),
    conversations:
      at < script.timing.reply
        ? []
        : [
            {
              ref: script.id,
              thread: target,
              title: script.title,
              repos: [`aldo:${script.project}`],
              branch: "main",
              state: finished ? "done" : "working",
              machine: "running",
              at: iso(script.timing.reply),
              startedAt: iso(script.timing.reply),
              summary: finished ? script.result : script.reply,
            },
          ],
    pullRequests: [],
    upcoming: [],
    approvals: [],
    routines: [],
    handoffs: [],
    plans: [],
    actions: [],
    usage: {
      configured: true,
      metered: true,
      plan: null,
      period: null,
      credits: null,
      bill: null,
      alert: "",
      agents: { running: finished ? 0 : 1, limit: null },
    },
    spends: { once: 0, monthly: 0, recent: [] },
    health: {
      providers: [{ id: "codex", name: "Codex", signedIn: true }],
      connected: [],
      environments: [],
    },
    policy: { everywhere: {}, workspaces: [] },
  };
}
const contentType: Record<string, string> = {
  PDF: "application/pdf",
  Document: "text/plain",
  Excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  Slides: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ZIP: "application/zip",
  Image: "image/png",
  JSON: "application/json",
  CSV: "text/csv",
};
let lastSnapshot = "";
export function applyWorkReplay(script: WorkReplayScript, at: number): void {
  if (!clockStarted) {
    startedAt = new Date(wallNow() - at);
    clockStarted = true;
  }
  // Date.now promises integer milliseconds; Effect converts this to BigInt nanoseconds.
  replayNow = Math.round(startedAt.getTime() + at);
  const finished = at >= script.timing.result;
  const inThread = at >= script.timing.thread && at < script.timing.home;
  const step = script.steps.findLastIndex((s) => at >= s.at);
  const fileCount = script.files.filter((f) => at >= f.at).length;
  const key = `${script.id}:${at >= script.timing.sent}:${at >= script.timing.reply}:${inThread}:${finished}:${step}:${fileCount}`;
  // The real composer restores unsent text without sending it.
  const typed =
    at < script.timing.sent
      ? script.request.slice(
          0,
          Math.max(
            0,
            Math.floor(
              (at - 400) / Math.min(55, (script.timing.sent - 800) / script.request.length),
            ),
          ),
        )
      : "";
  useAldoAssistant.setState({ unsent: typed });
  if (key === lastSnapshot) return;
  lastSnapshot = key;
  setActiveEnvironmentId(demoEnvironmentId);
  const entries: AldoConversationEntry[] = [];
  if (at >= script.timing.sent)
    entries.push({ kind: "message", role: "user", text: script.request, at: iso(0) });
  if (at >= script.timing.reply)
    entries.push({
      kind: "message",
      role: "assistant",
      text: finished
        ? `${script.result}\n\nThread: https://aldo.computer/${demoEnvironmentId}/${demoThreadId}`
        : script.reply,
      at: iso(1000),
      artifacts: finished
        ? script.files.slice(0, fileCount).map((f) => ({
            kind: "file",
            url: f.href,
            title: f.title,
            contentType: f.href.endsWith(".docx")
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : (contentType[f.type] ?? "application/octet-stream"),
          }))
        : [],
    });
  useAldoAssistant.setState({ entries, historyLoaded: true, replying: false, phase: "idle" });
  useAldoSimple.setState({ on: false });
  const home = homeFor(script, at);
  useAldoHomeFeed.setState({ home, supported: true, error: null, saved: false });
  useAldoHomeReadAt.setState({ at: Date.now() });
  const turnId = TurnId.make("replay-turn");
  const messages = [
    script.request,
    script.reply,
    ...script.steps
      .filter((s) => at >= s.at)
      .map((s, i) => `${i < step || finished ? s.complete : s.active}\n\n${s.detail}`),
    ...(finished
      ? [
          `${script.result}\n\n${script.files
            .slice(0, fileCount)
            .map((f) => `[${f.title}](${f.href})`)
            .join("\n\n")}`,
        ]
      : []),
  ].map((text, i) => ({
    id: MessageId.make(`replay-${i}`),
    role: i === 0 ? ("user" as const) : ("assistant" as const),
    text,
    turnId,
    streaming: false,
    createdAt: iso(i * 1000),
    updatedAt: iso(i * 1000),
  }));
  setWorkReplayThread(
    {
      title: script.title,
      messages,
      activities: script.steps
        .filter((s) => at >= s.at)
        .map((s, i) => ({
          id: EventId.make(`replay-step-${i}`),
          tone: "tool",
          kind: "tool",
          summary: i < step || finished ? s.complete : s.active,
          payload: {},
          turnId,
          createdAt: iso(i * 1000 + 1500),
        })),
      latestTurn: {
        turnId,
        state: finished ? "completed" : "running",
        requestedAt: iso(0),
        startedAt: iso(0),
        completedAt: finished ? iso(6000) : null,
        assistantMessageId: finished ? messages.at(-1)!.id : null,
      },
      session: {
        threadId: demoThreadId,
        status: finished ? "ready" : "running",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "full-access",
        activeTurnId: finished ? null : turnId,
        lastError: null,
        updatedAt: iso(at),
      },
    },
    script.project,
  );
  const hash = inThread ? `#/${demoEnvironmentId}/${demoThreadId}` : "#/";
  if (location.hash !== hash) location.hash = hash;
  document.documentElement.dataset.replayStage = inThread ? "thread" : finished ? "result" : "home";
}

export function workReplayHistory() {
  return {
    messages: useAldoAssistant
      .getState()
      .entries.filter((e) => e.kind === "message")
      .map(({ role, text, at, artifacts }) => ({ role, text, at, artifacts })),
    calls: true,
  };
}
