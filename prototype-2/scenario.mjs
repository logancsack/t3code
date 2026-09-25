#!/usr/bin/env node
// Prototype 2 scenario driver. Talks only to the hub (:4411) over its public
// HTTP API and WebSocket RPC, exactly as a client would.
//
//   node scenario.mjs setup
//   node scenario.mjs turn "<prompt>" [--approve] [--interrupt-after-tool] [--timeout 180]
//   node scenario.mjs watch [--timeout 180]        # follow the running turn without dispatching
//   node scenario.mjs diff <fromTurnCount> <toTurnCount>
//   node scenario.mjs show
import * as fs from "node:fs";
import * as crypto from "node:crypto";

const HUB = process.env.HUB_URL ?? "http://127.0.0.1:4411";
const STATE_PATH = process.env.SCENARIO_STATE ?? "/tmp/proto-runner/scenario-state.json";
const TOKEN = fs
  .readFileSync(process.env.HUB_TOKEN_PATH ?? "/tmp/proto-runner/hub-token", "utf8")
  .trim();
const MODEL = { instanceId: "claudeAgent", model: "claude-haiku-4-5" };

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const stamp = () => new Date().toISOString().slice(11, 23);
const log = (...args) => console.log(`[${stamp()}]`, ...args);
const loadState = () =>
  fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) : {};
const saveState = (state) => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function http(method, path, body) {
  const response = await fetch(`${HUB}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 400)}`);
  return text.length > 0 ? JSON.parse(text) : null;
}

const dispatch = (command) => http("POST", "/api/orchestration/dispatch", command);
const threadSnapshot = (threadId) => http("GET", `/api/orchestration/threads/${threadId}`);

/** One Effect RPC call over the hub's /ws endpoint using the JSON wire format. */
async function rpc(tag, payload) {
  const { ticket } = await http("POST", "/api/auth/websocket-ticket");
  const url = `${HUB.replace(/^http/, "ws")}/ws?wsTicket=${encodeURIComponent(ticket)}`;
  const socket = new WebSocket(url);
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`rpc ${tag} timed out`)), 30_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] }));
    });
    socket.addEventListener("message", (message) => {
      const decoded = JSON.parse(String(message.data));
      const messages = Array.isArray(decoded) ? decoded : [decoded];
      for (const entry of messages) {
        if (entry._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
        if (entry._tag === "Exit" && String(entry.requestId) === "1") {
          clearTimeout(timer);
          socket.close();
          if (entry.exit._tag === "Success") resolve(entry.exit.value);
          else reject(new Error(`rpc ${tag} failed: ${JSON.stringify(entry.exit).slice(0, 600)}`));
        }
      }
    });
    socket.addEventListener("error", (error) => reject(error.error ?? new Error("socket error")));
  });
}

function summarize(thread) {
  const pending = new Map();
  for (const activity of thread.activities) {
    const requestId = activity.payload?.requestId;
    if (activity.kind === "approval.requested") pending.set(requestId, activity);
    if (activity.kind === "approval.resolved") pending.delete(requestId);
  }
  return {
    latestTurn: thread.latestTurn,
    session: thread.session
      ? {
          status: thread.session.status,
          activeTurnId: thread.session.activeTurnId,
          lastError: thread.session.lastError,
        }
      : null,
    messageCount: thread.messages.length,
    activityCount: thread.activities.length,
    checkpoints: thread.checkpoints.map((c) => ({
      turnCount: c.checkpointTurnCount,
      status: c.status,
      ref: c.checkpointRef,
      files: c.files.map((f) => `${f.path} +${f.additions}/-${f.deletions}`),
    })),
    pendingApprovals: [...pending.values()].map((a) => ({
      requestId: a.payload.requestId,
      summary: a.summary,
      detail: a.payload.detail,
    })),
  };
}

async function follow(state, options) {
  const deadline = Date.now() + (options.timeoutSec ?? 180) * 1000;
  const seenActivities = new Set(options.preSeenActivities ?? []);
  const seenMessages = new Map(options.preSeenMessages ?? []);
  let commandApprovedAt = null;
  const approved = new Set();
  let interrupted = false;
  let toolSeenAt = null;
  const startedAt = Date.now();
  let firstAssistantAt = null;
  let lastSummary = null;
  while (Date.now() < deadline) {
    let snapshot;
    try {
      snapshot = await threadSnapshot(state.threadId);
    } catch (error) {
      log("hub unreachable:", String(error.message ?? error).slice(0, 120));
      await sleep(1000);
      continue;
    }
    const thread = snapshot.thread;
    for (const activity of thread.activities) {
      if (seenActivities.has(activity.id)) continue;
      seenActivities.add(activity.id);
      log(`activity ${activity.kind}: ${activity.summary}`);
      if (activity.tone === "tool" && toolSeenAt === null) toolSeenAt = Date.now();
    }
    for (const message of thread.messages) {
      const previous = seenMessages.get(message.id);
      if (previous !== message.text) {
        seenMessages.set(message.id, message.text);
        if (message.role === "assistant" && firstAssistantAt === null)
          firstAssistantAt = Date.now();
        if (
          previous === undefined ||
          !message.streaming ||
          message.text.length - (previous?.length ?? 0) > 200
        ) {
          log(
            `message ${message.role}${message.streaming ? " (streaming)" : ""}: ${JSON.stringify(message.text.slice(0, 160))}`,
          );
        }
      }
    }
    const summary = summarize(thread);
    lastSummary = summary;
    if (options.approve) {
      for (const pending of summary.pendingApprovals) {
        if (approved.has(pending.requestId)) continue;
        approved.add(pending.requestId);
        log(
          `approving ${pending.requestId} (${pending.summary}: ${String(pending.detail ?? "").slice(0, 80)})`,
        );
        const approvalStart = Date.now();
        const sent = await dispatch({
          type: "thread.approval.respond",
          commandId: id(),
          threadId: state.threadId,
          requestId: pending.requestId,
          decision: "accept",
          createdAt: now(),
        }).then(
          () => true,
          (error) => {
            log(
              "approval dispatch failed, will retry:",
              String(error.message ?? error).slice(0, 120),
            );
            approved.delete(pending.requestId);
            return false;
          },
        );
        if (!sent) continue;
        log(`approval dispatched in ${Date.now() - approvalStart} ms`);
        if (/command/i.test(pending.summary)) commandApprovedAt = Date.now();
      }
    }
    // Interrupt once the approved command has been running for 3 s (or 15 s
    // after the tool call streamed if no approval was needed).
    const commandRunning =
      (commandApprovedAt !== null && Date.now() - commandApprovedAt > 3000) ||
      (toolSeenAt !== null && Date.now() - toolSeenAt > 15000);
    const textStreaming =
      (firstAssistantAt !== null && Date.now() - firstAssistantAt > 2000) ||
      (options.interruptAfterMs !== undefined && Date.now() - startedAt > options.interruptAfterMs);
    if (
      !interrupted &&
      ((options.interruptAfterTool && commandRunning) ||
        (options.interruptAfterText && textStreaming))
    ) {
      interrupted = true;
      const turnId = summary.latestTurn?.turnId;
      log(`interrupting turn ${turnId}`);
      await dispatch({
        type: "thread.turn.interrupt",
        commandId: id(),
        threadId: state.threadId,
        ...(turnId ? { turnId } : {}),
        createdAt: now(),
      });
    }
    const latest = summary.latestTurn;
    if (latest && options.turnMessageId !== undefined) {
      // wait until the turn for this message exists
    }
    if (
      latest &&
      latest.state !== "running" &&
      (options.expectNewTurn === undefined || latest.turnId !== options.expectNewTurn)
    ) {
      if (
        summary.pendingApprovals.length === 0 &&
        (thread.session?.activeTurnId ?? null) === null
      ) {
        log(
          `turn ${latest.turnId} settled: ${latest.state} after ${Date.now() - startedAt} ms (first assistant text after ${firstAssistantAt ? firstAssistantAt - startedAt : "n/a"} ms)`,
        );
        // Give the checkpoint reactor a moment, then report.
        await sleep(1500);
        const final = summarize((await threadSnapshot(state.threadId)).thread);
        console.log(JSON.stringify(final, null, 2));
        return final;
      }
    }
    await sleep(400);
  }
  log("timed out following the turn");
  console.log(JSON.stringify(lastSummary, null, 2));
  return lastSummary;
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const flagValue = (name, fallback) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : fallback;
};

if (command === "setup") {
  const state = { projectId: `proj-${id()}`, threadId: `thread-${id()}` };
  const t0 = Date.now();
  await dispatch({
    type: "project.create",
    commandId: id(),
    projectId: state.projectId,
    title: "Proto runner checkout",
    workspaceRoot: process.env.WORKSPACE_ROOT ?? "/tmp/proto-runner/checkout",
    defaultModelSelection: MODEL,
    createdAt: now(),
  });
  log(`project.create accepted in ${Date.now() - t0} ms`);
  const t1 = Date.now();
  await dispatch({
    type: "thread.create",
    commandId: id(),
    threadId: state.threadId,
    projectId: state.projectId,
    title: "Remote runner thread",
    modelSelection: MODEL,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: now(),
  });
  log(`thread.create accepted in ${Date.now() - t1} ms`);
  saveState(state);
  console.log(JSON.stringify(state));
} else if (command === "turn") {
  const state = loadState();
  const prompt = rest[0];
  const beforeThread = (await threadSnapshot(state.threadId)).thread;
  const before = beforeThread.latestTurn?.turnId;
  const t0 = Date.now();
  await dispatch({
    type: "thread.turn.start",
    commandId: id(),
    threadId: state.threadId,
    message: { messageId: `msg-${id()}`, role: "user", text: prompt, attachments: [] },
    runtimeMode: "approval-required",
    interactionMode: "default",
    createdAt: now(),
  });
  log(`thread.turn.start accepted in ${Date.now() - t0} ms`);
  await follow(state, {
    approve: flag("--approve"),
    interruptAfterTool: flag("--interrupt-after-tool"),
    interruptAfterText:
      flag("--interrupt-after-text") || flagValue("--interrupt-after-ms") !== undefined,
    interruptAfterMs:
      flagValue("--interrupt-after-ms") !== undefined
        ? Number(flagValue("--interrupt-after-ms"))
        : undefined,
    timeoutSec: Number(flagValue("--timeout", "180")),
    expectNewTurn: before,
    preSeenActivities: beforeThread.activities.map((activity) => activity.id),
    preSeenMessages: beforeThread.messages.map((message) => [message.id, message.text]),
  });
} else if (command === "watch") {
  const state = loadState();
  const beforeThread = (await threadSnapshot(state.threadId)).thread;
  await follow(state, {
    approve: flag("--approve"),
    interruptAfterTool: flag("--interrupt-after-tool"),
    timeoutSec: Number(flagValue("--timeout", "180")),
    preSeenActivities: flag("--all") ? [] : beforeThread.activities.map((activity) => activity.id),
    preSeenMessages: flag("--all")
      ? []
      : beforeThread.messages.map((message) => [message.id, message.text]),
  });
} else if (command === "diff") {
  const state = loadState();
  const t0 = Date.now();
  const result = await rpc("orchestration.getTurnDiff", {
    threadId: state.threadId,
    fromTurnCount: Number(rest[0]),
    toTurnCount: Number(rest[1]),
  });
  log(`getTurnDiff via hub in ${Date.now() - t0} ms`);
  console.log(JSON.stringify(result, null, 2));
} else if (command === "show") {
  const state = loadState();
  const snapshot = await threadSnapshot(state.threadId);
  console.log(JSON.stringify(summarize(snapshot.thread), null, 2));
  for (const message of snapshot.thread.messages)
    console.log(`${message.role}: ${JSON.stringify(message.text.slice(0, 300))}`);
} else {
  console.error("usage: scenario.mjs setup|turn|watch|diff|show");
  process.exit(2);
}
