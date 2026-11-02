// A separate entry in the *same release* as the app. Install a closed local
// transport before importing the app; never read the visitor's account or run work.
import type { WorkReplayScript } from "./workReplay";

let frame: { script: WorkReplayScript; at: number } | null = null;
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
window.fetch = async (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method !== "GET") return new Response("{}", { status: 404 });
  const path = new URL(input instanceof Request ? input.url : String(input), location.href)
    .pathname;
  if (path === "/.well-known/t3/environment") return json(workReplayConfig().environment);
  if (path === "/api/assistant/tools")
    return json({
      tools: [],
      images: { max: 5, maxBytes: 20971520, types: ["image/png", "image/jpeg", "image/webp"] },
      files: { max: 10, maxBytes: 20971520 },
    });
  if (path === "/api/account")
    return json({
      id: "replay",
      name: "Logan",
      email: "logan@example.com",
      onboarding: { onboardedAt: "2026-10-01T00:00:00Z", interests: ["code"] },
    });
  if (path === "/api/home") return json(home());
  if (path === "/api/environments")
    return json({
      environments: frame
        ? [
            {
              environmentId: "aldo-browser-demo",
              threadId: "aldo-demo-thread",
              label: frame.script.title,
              repo: `aldo:${frame.script.project}`,
              repos: [`aldo:${frame.script.project}`],
              branch: "main",
              state: "ready",
              shellSequence: 1,
            },
          ]
        : [],
      features: { general: true, projects: true },
    });
  if (path === "/api/environments/shells")
    return json({ shells: { "aldo-demo-thread": workReplaySnapshots().shell } });
  if (path === "/api/assistant/history") return json(workReplayHistory());
  if (path.endsWith("/detail"))
    return json({
      sequence: workReplaySnapshots().detail.snapshotSequence,
      detail: workReplaySnapshots().detail,
    });
  // Unknown reads and all mutations stay local and unavailable. CSP also
  // forbids network connections if a future client adds another transport.
  return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
};

const { workReplaySnapshots, workReplayConfig } = await import("./runtime");
const { homeFor, applyWorkReplay, workReplayHistory } = await import("./workReplay");
const home = () => (frame ? homeFor(frame.script, frame.at) : null);
window.dispatchEvent(new Event("aldo:replay-transport"));
const { startAldoDirectory } = await import("../aldo/directory");
const { installAldoShellSync } = await import("../aldo/shells");
installAldoShellSync();
const playback = document.createElement("style");
document.head.append(playback);
let ready: (() => void) | undefined;
const firstFrame = new Promise<void>((resolve) => {
  ready = resolve;
});
window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== parent || event.data?.type !== "aldo:replay-frame") return;
  frame = event.data.frame;
  if (!frame) return;
  applyWorkReplay(frame.script, frame.at);
  playback.textContent = event.data.running ? "" : "* { animation-play-state: paused !important; }";
  if (ready) startAldoDirectory();
  ready?.();
  ready = undefined;
});
parent.postMessage({ type: "aldo:replay-ready" }, "*");

export function startWorkReplay(): Promise<void> {
  return firstFrame;
}
