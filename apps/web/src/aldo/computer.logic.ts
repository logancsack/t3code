// The user's Windows computer: one per user (a cloud computer with desktop
// Office) that agents ask for. Aldo's directory reports it on the thread
// asking for it (status "asked", with the agent's reason) and on the thread
// using it (its status); an older Aldo leaves the field out, which reads as no
// computer. It costs credits while it runs, so the first time a thread asks,
// the user answers in the thread. While it runs, the Desktop view can show its
// screen instead of the thread machine's own, and the user can stop it.

export type AldoComputerStatus =
  | "asked"
  | "new"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface AldoComputer {
  readonly kind: "windows";
  readonly status: AldoComputerStatus;
  /** The agent's one-line reason, while it asks. */
  readonly why: string | null;
  readonly creditsPerHour: number;
  /** Why it didn't start, when it failed. */
  readonly error: string | null;
}

/** What a thread shows about its computer: the ask, "Starting…", or nothing. */
export type AldoComputerNotice = "ask" | "starting" | null;

/**
 * What a thread shows about its computer. `answer` is this tab's answer to the
 * ask (true: start it), kept until the directory stops reporting the ask
 * (aldoComputerKeptAnswer), so an answered ask isn't offered again while the
 * directory catches up, and agreeing shows "Starting…" at once.
 */
export function aldoComputerNotice(
  computer: AldoComputer | null | undefined,
  answer: boolean | undefined,
): AldoComputerNotice {
  if (computer?.status === "asked") {
    if (answer === undefined) return "ask";
    return answer ? "starting" : null;
  }
  return computer?.status === "starting" ? "starting" : null;
}

/** Whether the user can stop the computer: while it starts or runs. */
export function aldoComputerStoppable(computer: AldoComputer | null | undefined): boolean {
  return computer?.status === "starting" || computer?.status === "running";
}

/** This tab's answer to an ask, while the directory still reports the ask; once it doesn't, a new ask is asked again. */
export function aldoComputerKeptAnswer(
  computer: AldoComputer | null | undefined,
  answer: boolean | undefined,
): boolean | undefined {
  return computer?.status === "asked" ? answer : undefined;
}

/**
 * How a start shown as "Starting…" ended, once the thread no longer shows it:
 * ready, failed, or neither (it stopped, it asks again).
 */
export function aldoComputerStartOutcome(
  computer: AldoComputer | null | undefined,
): "ready" | "failed" | null {
  if (computer?.status === "running") return "ready";
  if (computer?.status === "failed") return "failed";
  return null;
}

function credits(perHour: number): string {
  const amount = Math.round(perHour * 100) / 100;
  return `${amount} ${amount === 1 ? "credit" : "credits"}`;
}

/** The ask's body: the agent's reason, then what it costs. */
export function aldoComputerAskDescription(
  computer: Pick<AldoComputer, "why" | "creditsPerHour">,
): string {
  const why = computer.why?.trim() ?? "";
  const reason = why && !/[.!?…]$/.test(why) ? `${why}.` : why;
  const cost = `${credits(computer.creditsPerHour)} an hour while it runs. It stops when the thread is done.`;
  return reason ? `${reason} ${cost}` : cost;
}

/** The Desktop view's screens: the thread machine's own desktop, or the Windows computer's. */
export type AldoDesktopScreen = "machine" | "windows";

/** The screen the Desktop view shows: Windows only while it's chosen and the computer runs. */
export function aldoDesktopScreen(
  chosen: AldoDesktopScreen,
  computer: AldoComputer | null | undefined,
): AldoDesktopScreen {
  return chosen === "windows" && computer?.status === "running" ? "windows" : "machine";
}

/** The desktop stream's URL for a screen: the Windows computer's is the same one with `screen=windows`. */
export function aldoDesktopScreenUrl(desktopUrl: string, screen: AldoDesktopScreen): string {
  if (screen === "machine") return desktopUrl;
  return `${desktopUrl}${desktopUrl.includes("?") ? "&" : "?"}screen=windows`;
}
