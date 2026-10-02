import { describe, expect, it } from "vite-plus/test";

import {
  actionFor,
  functionCallsIn,
  openTargetOf,
  phaseAfter,
  previewOf,
  rememberHeard,
  startNews,
  startWatchFor,
  withoutImageNotes,
  type AldoStartWatch,
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

  it("links a preview it opened to the app, not the thread", () => {
    const url = "https://aldo.example/p/k3j9x0a1b2/3000";
    const call = { callId: "c6", name: "open_preview", arguments: { thread: "k3j9x0a1b2" } };
    expect(actionFor(call, { result: { preview: { url, port: 3000 }, thread } })).toEqual({
      id: "c6",
      tool: "open_preview",
      label: "Opened a preview",
      failed: false,
      href: url,
    });
    // Several ports to choose from: nothing opened yet.
    expect(actionFor(call, { result: { ports: [{ port: 3000 }, { port: 5173 }] } })).toBeNull();
  });

  it("links a pull request it opened", () => {
    const call = {
      callId: "c7",
      name: "open_pull_request",
      arguments: { thread: "k3j9x0a1b2", title: "Fix login" },
    };
    expect(
      actionFor(call, { result: { thread, number: 12, url: "https://github.com/o/r/pull/12" } }),
    ).toMatchObject({
      label: "Opened a pull request: Fix login",
      href: "https://github.com/o/r/pull/12",
      open: thread,
    });
  });

  it("says what an undoing call did", () => {
    const unpin = { callId: "c8", name: "pin_thread", arguments: { thread: "x", pinned: false } };
    expect(actionFor(unpin, { result: { thread } })?.label).toBe("Unpinned a thread");
    const wake = { callId: "c9", name: "snooze_thread", arguments: { thread: "x" } };
    expect(actionFor(wake, { result: { thread } })?.label).toBe("Brought back a snoozed thread");
  });
});

describe("withoutImageNotes", () => {
  it("shows the words, and the images a kept message names", () => {
    expect(
      withoutImageNotes("What's this?\n\n[image img_ab12: shot.png] [image img_cd34: b.jpg]"),
    ).toEqual({
      text: "What's this?",
      images: [
        { id: "img_ab12", name: "shot.png" },
        { id: "img_cd34", name: "b.jpg" },
      ],
    });
    expect(withoutImageNotes("No images [here].")).toEqual({
      text: "No images [here].",
      images: [],
    });
  });
});

describe("previewOf", () => {
  it("opens only a web address", () => {
    expect(previewOf({ result: { preview: { url: "https://a.example/p/x/3000" } } })).toBe(
      "https://a.example/p/x/3000",
    );
    expect(previewOf({ result: { preview: { url: "javascript:alert(1)" } } })).toBeNull();
    expect(previewOf({ error: "nope" })).toBeNull();
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

describe("startWatchFor", () => {
  const started = {
    result: {
      title: "Fix the login bug",
      thread: { environmentId: "aldo-k3j9x0a1b2", threadId: "t-1" },
    },
  };

  it("follows the thread a start_thread call started", () => {
    const call = { callId: "c1", name: "start_thread", arguments: { brief: "Fix it" } };
    expect(startWatchFor(call, started, 1000)).toEqual({
      environmentId: "aldo-k3j9x0a1b2",
      threadId: "t-1",
      title: "Fix the login bug",
      since: 1000,
      told: [],
    });
  });

  it("follows nothing for other tools, or a start that was refused", () => {
    expect(
      startWatchFor({ callId: "c1", name: "message_thread", arguments: {} }, started, 0),
    ).toBeNull();
    const call = { callId: "c1", name: "start_thread", arguments: {} };
    expect(startWatchFor(call, { error: "Claude isn't signed in." }, 0)).toBeNull();
  });
});

describe("startNews", () => {
  const watch: AldoStartWatch = {
    environmentId: "aldo-k3j9x0a1b2",
    threadId: "t-1",
    title: "Fix the login bug",
    since: 0,
    told: [],
  };
  const directory = (start?: {
    state: "starting" | "queued" | "retrying" | "failed";
    detail?: string;
  }) => [{ environmentId: "aldo-k3j9x0a1b2", starts: start ? { "t-1": start } : {} }];

  it("waits quietly while the thread is starting, or before the directory lists it", () => {
    expect(startNews(watch, directory({ state: "starting" }), 1)).toEqual({
      news: null,
      done: false,
    });
    expect(startNews(watch, [], 1)).toEqual({ news: null, done: false });
    expect(startNews(watch, null, 1)).toEqual({ news: null, done: false });
  });

  it("follows a thread that started until its first turn shows how it's going", () => {
    expect(startNews(watch, directory(), 1)).toEqual({ news: null, done: false });
    const going = [
      {
        environmentId: "aldo-k3j9x0a1b2",
        starts: {},
        attention: { "t-1": { state: "working" as const } },
      },
    ];
    expect(startNews(watch, going, 1)).toEqual({ news: null, done: true });
  });

  it("tells when the thread stopped as soon as it began (an agent signed out)", () => {
    const stopped = [
      {
        environmentId: "aldo-k3j9x0a1b2",
        starts: {},
        attention: { "t-1": { state: "failed" as const, summary: "Your Claude sign-in expired." } },
      },
    ];
    const { news, done } = startNews(watch, stopped, 1);
    expect(done).toBe(true);
    expect(news?.state).toBe("stopped");
    expect(news?.label).toBe('"Fix the login bug" stopped: Your Claude sign-in expired');
  });

  it("stops following after a while", () => {
    expect(startNews(watch, directory({ state: "starting" }), 31 * 60_000)).toEqual({
      news: null,
      done: true,
    });
  });

  it("stops at once when Aldo's directory doesn't say how starts stand", () => {
    expect(startNews(watch, [{ environmentId: "aldo-k3j9x0a1b2" }], 1)).toEqual({
      news: null,
      done: true,
    });
  });

  it("tells of a failure, with why, and stops", () => {
    const { news, done } = startNews(
      watch,
      directory({ state: "failed", detail: "Couldn't start: repository not found." }),
      1,
    );
    expect(done).toBe(true);
    expect(news?.state).toBe("failed");
    expect(news?.label).toBe(
      "Couldn't start \"Fix the login bug\": Couldn't start: repository not found",
    );
    expect(news?.prompt).toContain("repository not found");
  });

  it("tells once that it's waiting for room, and keeps following it", () => {
    const queued = directory({ state: "queued", detail: "Your plan runs 2 cloud agents at once." });
    const first = startNews(watch, queued, 1);
    expect(first.done).toBe(false);
    expect(first.news?.state).toBe("queued");
    expect(startNews({ ...watch, told: ["queued"] }, queued, 2)).toEqual({
      news: null,
      done: false,
    });
    expect(
      startNews({ ...watch, told: ["queued"] }, directory({ state: "failed" }), 3).news?.state,
    ).toBe("failed");
  });
});
