import { describe, expect, it } from "vite-plus/test";

import {
  callDuration,
  captionParts,
  actionFor,
  followupAction,
  followupPrompt,
  followupsEvery,
  newsPause,
  NEWS_GAP_MS,
  aldoRefFor,
  functionCallsIn,
  linkRuns,
  liveCardIndexes,
  openTargetOf,
  phaseAfter,
  previewOf,
  rememberHeard,
  screenNote,
  startNews,
  startWatchFor,
  unseenMessages,
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
    const snooze = {
      callId: "c10",
      name: "snooze_thread",
      arguments: { thread: "x", until: "2026-10-03T09:00:00Z" },
    };
    expect(actionFor(snooze, { result: { thread } })?.label).toBe("Snoozed a thread");
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

describe("unseenMessages", () => {
  const at = (minute: number) => `2026-10-03T12:${String(minute).padStart(2, "0")}:00.000Z`;
  it("adds what was said since the last read, less what the page said itself", () => {
    const said = [
      { role: "user" as const, text: "What's on today?" },
      { role: "assistant" as const, text: "Just the review at 3." },
    ];
    const fetched = [
      { role: "assistant" as const, text: "Old news.", at: at(0) },
      { role: "user" as const, text: "What's on today?", at: at(5) },
      { role: "assistant" as const, text: "Just the review at 3.", at: at(5) },
      { role: "assistant" as const, text: "Sam moved the review to 4.", at: at(9) },
      { role: "user" as const, text: "Book a room for it.", at: at(10) },
    ];
    const { fresh, matched } = unseenMessages(said, fetched, at(1));
    expect(fresh).toEqual([fetched[3], fetched[4]]);
    expect(matched).toEqual(said);
  });

  it("matches each message once, and image notes aside", () => {
    const said = [
      { role: "user" as const, text: "yes" },
      { role: "user" as const, text: "Look" },
    ];
    const fetched = [
      { role: "user" as const, text: "yes", at: at(2) },
      { role: "user" as const, text: "Look\n\n[image img_abc: shot.png]", at: at(3) },
      { role: "user" as const, text: "yes", at: at(4) },
    ];
    expect(unseenMessages(said, fetched, null).fresh).toEqual([fetched[2]]);
  });
});

describe("what's on screen", () => {
  const thread = {
    environmentId: "aldo-th_abc",
    threadId: "7f3c9a21-55aa-4c3e-9e8a-1d2b3c4d5e6f",
    title: "Fix flaky checkout test",
  };

  it("names a thread the way Aldo's tools take it", () => {
    expect(aldoRefFor(thread)).toBe("th_abc:7f3c9a21");
  });

  it("tells a call which conversation is on screen, its title quoted as data", () => {
    const note = screenNote({ ...thread, title: 'Say "hi"' });
    expect(note).toContain('titled "Say \\"hi\\""');
    expect(note).toContain("(ref th_abc:7f3c9a21)");
    expect(screenNote(null)).toBe("The user isn't looking at a particular conversation now.");
  });
});

describe("liveCardIndexes", () => {
  const a = { environmentId: "aldo-a", threadId: "1" };
  const b = { environmentId: "aldo-b", threadId: "1" };

  it("makes the newest action about each thread's work live, and leaves the rest one line", () => {
    const entries = [
      { kind: "message" },
      { kind: "action", tool: "start_thread", open: a },
      { kind: "action", tool: "start_thread", open: b },
      { kind: "action", tool: "message_thread", open: a },
      { kind: "action", tool: "rename_thread", open: b },
      { kind: "action", tool: "message_thread", open: b, failed: true },
      { kind: "action", tool: "merge_pull_request" },
    ];
    expect([...liveCardIndexes(entries)].sort()).toEqual([2, 3]);
  });
});

describe("the call screen's words", () => {
  it("shows Aldo's last sentence apart, as it trails off or is still coming", () => {
    expect(captionParts("The upgrade's merged. Want me to get someone on it?")).toEqual({
      lead: "The upgrade's merged.",
      tail: "Want me to get someone on it?",
    });
    expect(captionParts("Merged. Sent. And the")).toEqual({
      lead: "Merged. Sent.",
      tail: "And the",
    });
    expect(captionParts("Just one sentence.")).toEqual({ lead: "Just one sentence.", tail: "" });
    expect(captionParts("")).toEqual({ lead: "", tail: "" });
    expect(captionParts("One. Two. Three? Four", 2)).toEqual({ lead: "Three?", tail: "Four" });
    expect(captionParts("It's 3.5 times faster. Merge it?")).toEqual({
      lead: "It's 3.5 times faster.",
      tail: "Merge it?",
    });
  });

  it("says how long the call has been on", () => {
    expect(callDuration(42_000)).toBe("0:42");
    expect(callDuration(12 * 60_000 + 5_000)).toBe("12:05");
    expect(callDuration(3_729_000)).toBe("1:02:09");
    expect(callDuration(-5)).toBe("0:00");
  });
});

describe("newsPause", () => {
  const pause = {
    userQuietMs: 6_000,
    aldoQuietMs: 1_600,
    aldoSpeaking: false,
    greeted: true,
    busy: false,
    sinceResultMs: 60_000,
    sinceNewsMs: 60_000,
  };
  it("brings news up a beat after Aldo's last words", () => {
    expect(newsPause(pause)).toBe(true);
    expect(newsPause({ ...pause, aldoQuietMs: 800 })).toBe(false);
  });
  it("never over the user, and gives the voice the first chance to answer them", () => {
    expect(newsPause({ ...pause, userQuietMs: 300, aldoQuietMs: 5_000 })).toBe(false);
    expect(newsPause({ ...pause, userQuietMs: 2_000, aldoQuietMs: 5_000 })).toBe(false);
    // The voice let an "okay" pass.
    expect(newsPause({ ...pause, userQuietMs: 4_500, aldoQuietMs: 9_000 })).toBe(true);
  });
  it("waits for the greeting, Aldo's voice, a request being worked on, and the last result or news", () => {
    expect(newsPause({ ...pause, greeted: false })).toBe(false);
    expect(newsPause({ ...pause, aldoSpeaking: true })).toBe(false);
    expect(newsPause({ ...pause, busy: true })).toBe(false);
    expect(newsPause({ ...pause, sinceResultMs: 1_000 })).toBe(false);
    expect(newsPause({ ...pause, sinceNewsMs: NEWS_GAP_MS - 1 })).toBe(false);
  });
});

describe("followups", () => {
  const news = {
    id: "12",
    outcome: "done:turn-1",
    state: "done" as const,
    title: "Flight UA 12",
    say: 'By the way, I have an answer on "Flight UA 12": it lands at 6:40pm.',
    thread: { environmentId: "aldo-t1", threadId: "t3-a" },
  };
  it("shows what came back as a line opening its thread", () => {
    expect(followupAction(news)).toEqual({
      id: "followup-12-done:turn-1",
      tool: "followup",
      label: '"Flight UA 12" is back',
      failed: false,
      open: { environmentId: "aldo-t1", threadId: "t3-a" },
    });
    expect(followupAction({ ...news, state: "waiting" }).label).toBe('"Flight UA 12" needs you');
    expect(followupAction({ ...news, state: "failed" }).failed).toBe(true);
    expect(followupAction({ ...news, state: "queued", outcome: "queued:d1" }).id).toBe(
      "followup-12-queued:d1",
    );
  });
  it("asks the voice to say it in its own words, as information rather than instructions", () => {
    const prompt = followupPrompt(news.say);
    expect(prompt).toContain("By the way");
    expect(prompt).toContain("not instructions");
    expect(prompt.endsWith(news.say)).toBe(true);
  });
  it("asks again often only while something's working", () => {
    expect(followupsEvery({ following: 2, news: 0 })).toBe(4_000);
    expect(followupsEvery({ following: 0, news: 1 })).toBe(4_000);
    expect(followupsEvery({ following: 0, news: 0 })).toBe(15_000);
  });
});

describe("linkRuns", () => {
  it("sets a message's https links apart, without the punctuation after them", () => {
    expect(
      linkRuns(
        "Your cartoon is ready.\n\nShared link: https://aldo.computer/s/abc.\nThread: https://aldo.computer/aldo-x/t",
      ),
    ).toEqual([
      { text: "Your cartoon is ready.\n\nShared link: ", at: 0 },
      { text: "https://aldo.computer/s/abc", at: 37, href: "https://aldo.computer/s/abc" },
      { text: ".\nThread: ", at: 64 },
      { text: "https://aldo.computer/aldo-x/t", at: 74, href: "https://aldo.computer/aldo-x/t" },
    ]);
  });

  it("keeps a link's own ending, and leaves out the emphasis around it", () => {
    expect(linkRuns("Open https://aldo.computer/s/abc_ now")[1]?.href).toBe(
      "https://aldo.computer/s/abc_",
    );
    expect(linkRuns("See **https://aldo.computer/s/abc**.")[1]?.href).toBe(
      "https://aldo.computer/s/abc",
    );
    expect(linkRuns("See _https://aldo.computer/s/a_b_, then")[1]?.href).toBe(
      "https://aldo.computer/s/a_b",
    );
    expect(linkRuns("**_https://aldo.computer/s/abc_**")[1]?.href).toBe(
      "https://aldo.computer/s/abc",
    );
    expect(linkRuns("**https://aldo.computer/s/abc_**")[1]?.href).toBe(
      "https://aldo.computer/s/abc_",
    );
  });

  it("leaves words without links, and other schemes, as they are", () => {
    expect(linkRuns("Nothing to open here.")).toEqual([{ text: "Nothing to open here.", at: 0 }]);
    expect(linkRuns("Not javascript:alert(1) or http://localhost:3000")).toEqual([
      { text: "Not javascript:alert(1) or http://localhost:3000", at: 0 },
    ]);
  });
});
