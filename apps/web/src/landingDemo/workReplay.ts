import { openAldoShare, closeAldoShare } from "../aldo/shareViewer";
import { setActiveEnvironmentId } from "../state/entities";
import { EventId, MessageId, TurnId, ProviderInstanceId } from "@t3tools/contracts";
import type { AldoHome } from "../aldo/homeApi";
import { useAldoAssistant, type AldoConversationEntry } from "../aldo/assistantSession";
import { useAldoHomeFeed, useAldoHomeReadAt } from "../aldo/homeFeed";
import { useAldoSimple } from "../aldo/simpleMode";
import {
  demoEnvironmentId,
  demoThreadId,
  setWorkReplayThread,
  setWorkReplayHomeThreads,
} from "./runtime";

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
  session?: { script: WorkReplayScript; start: number; sourceStart: string; sourceEnd: string }[];
  elapsed?: { at: number; ms: number }[];
  preview?: { card: string; full: string; title: string };
  viewers?: { at: number; end: number; task: string }[];
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
  if (script.session) return sessionHome(script, at);
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
  if (script.session) {
    applyHomeSession(script, at);
    return;
  }
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

/** Playback and source time are separate: all native timers use the source clock. */
export function sourceTime(script: WorkReplayScript, at: number): number {
  const points = script.elapsed;
  if (!points?.length) return at;
  const next = points.findIndex((p) => p.at > at);
  if (next === 0) return points[0]!.ms;
  if (next === -1) return points.at(-1)!.ms;
  const a = points[next - 1]!;
  const b = points[next]!;
  return Math.round(a.ms + ((at - a.at) / (b.at - a.at)) * (b.ms - a.ms));
}

function sessionHome(script: WorkReplayScript, at: number): AldoHome {
  const { session, ...single } = script;
  const home = homeFor(single, 0);
  const time = sourceTime(script, at);
  const conversations: AldoHome["conversations"] = session!.flatMap(({ script: task, start }) => {
    const local = time - start;
    if (local < task.timing.reply) return [];
    const done = local >= task.timing.result;
    const step = task.steps.findLast((s) => local >= s.at);
    return [
      {
        ref: task.id,
        thread: { environmentId: demoEnvironmentId, threadId: `replay-${task.id}` },
        title: task.title,
        repos: [task.project],
        branch: "main",
        state: done ? ("done" as const) : ("working" as const),
        machine: "running",
        at: iso(start + (done ? task.timing.result : (step?.at ?? task.timing.reply))),
        stateAt: iso(start + (done ? task.timing.result : task.timing.reply)),
        startedAt: iso(start + task.timing.reply),
        summary: done ? task.result : step ? `${step.active}. ${step.detail}` : task.reply,
      },
    ];
  });
  return {
    ...home,
    at: iso(time),
    conversations,
    usage: {
      ...home.usage,
      agents: {
        ...home.usage.agents,
        running: conversations.filter((c) => c.state === "working").length,
      },
    },
  };
}

let lastViewer = "";

function applyHomeSession(script: WorkReplayScript, at: number): void {
  if (!clockStarted) {
    startedAt = new Date(wallNow());
    clockStarted = true;
  }
  const viewer = script.viewers?.find((v) => at >= v.at && at < v.end);
  const preview = script.session!.find((t) => t.script.id === viewer?.task)?.script.preview;
  const viewerKey = preview?.full ?? "";
  if (viewerKey !== lastViewer) {
    lastViewer = viewerKey;
    if (preview)
      openAldoShare({
        id: null,
        url: preview.full,
        title: preview.title,
        contentType: "image/png",
        share: null,
        fullScreen: true,
      });
    else closeAldoShare();
  }
  const time = sourceTime(script, at);
  replayNow = Math.round(startedAt.getTime() + time);
  document.documentElement.dataset.replayStage = viewer
    ? "viewer"
    : time >= script.session!.reduce((end, t) => Math.max(end, t.start + t.script.timing.result), 0)
      ? "result"
      : "home";
  const entries: Extract<AldoConversationEntry, { kind: "message" }>[] = [];
  let typed = "";
  for (const { script: task, start } of script.session!) {
    const local = time - start;
    if (local >= 0 && local < task.timing.sent)
      typed = task.request.slice(0, Math.max(0, Math.floor((local - 400) / 38)));
    if (local >= task.timing.sent)
      entries.push({
        kind: "message",
        role: "user",
        text: task.request,
        at: iso(start + task.timing.sent),
      });
    if (local >= task.timing.reply)
      entries.push({
        kind: "message",
        role: "assistant",
        text: task.reply,
        at: iso(start + task.timing.reply - 1),
      });
    // The native Home feed supplies the live card. Progress arrives as normal
    // Home messages, without opening a thread or maintaining a second UI.
    for (const step of task.steps)
      if (local >= step.at)
        entries.push({
          kind: "message",
          role: "assistant",
          text: `${task.title}: ${step.active}.\n\n${step.detail}`,
          at: iso(start + step.at),
        });
    if (local >= task.timing.result)
      entries.push({
        kind: "message",
        role: "assistant",
        text: `${task.title}\n\n${task.result}`,
        at: iso(start + task.timing.result),
        artifacts: [
          ...(task.preview
            ? [
                {
                  kind: "file" as const,
                  url: task.preview.card,
                  width: 1920,
                  height: 800,
                  title: task.preview.title,
                  contentType: "image/png",
                },
              ]
            : []),
          ...task.files
            .filter((f) => !task.preview || f.type !== "Image")
            .map((f) => ({
              kind: "file" as const,
              url: f.href,
              title: f.title,
              contentType: f.href.endsWith(".docx")
                ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                : (contentType[f.type] ?? "application/octet-stream"),
            })),
        ],
      });
  }
  entries.sort((a, b) => a.at.localeCompare(b.at));
  const key = `${script.id}:${entries.length}:${Math.floor(time / 1000)}`;
  useAldoAssistant.setState({ unsent: typed });
  if (key === lastSnapshot) return;
  lastSnapshot = key;
  useAldoAssistant.setState({ entries, historyLoaded: true, replying: false, phase: "idle" });
  useAldoSimple.setState({ on: false });
  const home = homeFor(script, at);
  setWorkReplayHomeThreads(
    home.conversations.map((c) => ({
      id: c.ref,
      title: c.title,
      startedAt: c.startedAt!,
      finishedAt: c.state === "done" ? c.at : null,
    })),
  );
  useAldoHomeFeed.setState({
    home,
    supported: true,
    error: null,
    saved: false,
  });
  useAldoHomeReadAt.setState({ at: replayNow });
  if (location.hash !== "#/") location.hash = "#/";
}
