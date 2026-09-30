import { describe, expect, it } from "vite-plus/test";

import {
  actionFor,
  functionCallsIn,
  openTargetOf,
  phaseAfter,
  rememberHeard,
} from "./assistant.logic";

describe("functionCallsIn", () => {
  it("reads each function call in a finished response, in order", () => {
    const event = {
      type: "response.done",
      response: {
        output: [
          { type: "message", content: [] },
          { type: "function_call", call_id: "c1", name: "overview", arguments: "{}" },
          {
            type: "function_call",
            call_id: "c2",
            name: "read_thread",
            arguments: '{"thread":"k3j9x0a1b2"}',
          },
        ],
      },
    };
    expect(functionCallsIn(event)).toEqual([
      { callId: "c1", name: "overview", arguments: {} },
      { callId: "c2", name: "read_thread", arguments: { thread: "k3j9x0a1b2" } },
    ]);
  });

  it("runs a malformed call with no arguments rather than dropping it", () => {
    const event = {
      response: {
        output: [{ type: "function_call", call_id: "c1", name: "overview", arguments: "{oops" }],
      },
    };
    expect(functionCallsIn(event)).toEqual([{ callId: "c1", name: "overview", arguments: {} }]);
  });

  it("finds none in anything else", () => {
    expect(functionCallsIn(null)).toEqual([]);
    expect(functionCallsIn({ response: { output: "nope" } })).toEqual([]);
  });
});

describe("openTargetOf", () => {
  it("opens the thread show_thread names", () => {
    expect(
      openTargetOf({ result: { open: { environmentId: "aldo-k3j9x0a1b2", threadId: "t-1" } } }),
    ).toEqual({
      environmentId: "aldo-k3j9x0a1b2",
      threadId: "t-1",
    });
  });

  it("opens nothing for other results or errors", () => {
    expect(openTargetOf({ result: { status: "archived" } })).toBeNull();
    expect(openTargetOf({ error: "There's no thread" })).toBeNull();
  });
});

describe("actionFor", () => {
  const thread = { environmentId: "aldo-k3j9x0a1b2", threadId: "t-1" };

  it("shows a thread started, with its title and a link", () => {
    const call = {
      callId: "c1",
      name: "start_thread",
      arguments: { brief: "Fix the login bug", title: "Login bug" },
    };
    expect(actionFor(call, { result: { ref: "k3j9x0a1b2", thread } })).toEqual({
      id: "c1",
      tool: "start_thread",
      label: "Started a thread: Login bug",
      failed: false,
      open: thread,
    });
  });

  it("shows what went wrong when an action was refused", () => {
    const call = { callId: "c2", name: "archive_thread", arguments: { thread: "x" } };
    expect(actionFor(call, { error: 'There\'s no thread "x".' })).toMatchObject({
      failed: true,
      label: "Couldn't: There's no thread \"x\".",
    });
  });

  it("doesn't link to a thread it deleted", () => {
    const call = { callId: "c3", name: "delete_thread", arguments: { thread: "k3j9x0a1b2" } };
    expect(actionFor(call, { result: { status: "deleted", thread } })?.open).toBeUndefined();
  });

  it("shows nothing for reads", () => {
    expect(actionFor({ callId: "c4", name: "overview", arguments: {} }, { result: {} })).toBeNull();
    expect(
      actionFor({ callId: "c5", name: "show_thread", arguments: {} }, { result: {} }),
    ).toBeNull();
  });
});

describe("rememberHeard", () => {
  it("keeps the newest 80 things the user said", () => {
    let heard: ReadonlyArray<string> = [];
    for (let i = 0; i < 100; i++) heard = rememberHeard(heard, `line ${i}`);
    expect(heard).toHaveLength(80);
    expect(heard[0]).toBe("line 20");
    expect(rememberHeard(heard, "   ")).toBe(heard);
  });
});

describe("phaseAfter", () => {
  it("follows a turn: hearing, thinking, speaking, back to listening", () => {
    expect(phaseAfter("listening", "input_audio_buffer.speech_started")).toBe("hearing");
    expect(phaseAfter("hearing", "input_audio_buffer.speech_stopped")).toBe("thinking");
    expect(phaseAfter("thinking", "output_audio_buffer.started")).toBe("speaking");
    expect(phaseAfter("speaking", "output_audio_buffer.stopped")).toBe("listening");
  });

  it("leaves a conversation that isn't live alone", () => {
    expect(phaseAfter("idle", "response.created")).toBeNull();
    expect(phaseAfter("connecting", "output_audio_buffer.started")).toBeNull();
    expect(phaseAfter("listening", "session.updated")).toBeNull();
  });
});
