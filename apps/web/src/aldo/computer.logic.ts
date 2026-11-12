// The computers each thread asks for: a
// Windows computer (desktop Office) and a GPU computer (rendering, CUDA).
// Aldo's directory reports each on the thread asking for it (status "asked",
// with the agent's reason) and on the thread using it (its status), the one
// to show first first; an older Aldo reports only the Windows computer, as
// `computer`, or nothing, which reads as no computer. It costs credits while it
// runs, so the first time a thread asks, the user answers in the thread. While
// the Windows computer runs, the Desktop view can show its screen instead of
// the thread machine's own, and the user can stop either.

export type AldoComputerStatus =
  | "queued"
  | "asked"
  | "new"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

/** The kinds this client knows; a newer Aldo may report others, named plainly. */
export type AldoComputerKind = "windows" | "gpu";

export interface AldoComputer {
  readonly id?: string;
  readonly disposable?: boolean | undefined;
  readonly concurrentLimit?: number | undefined;
  readonly extraHourlyUsd?: number | undefined;
  readonly kind: AldoComputerKind | (string & {});
  readonly status: AldoComputerStatus;
  readonly position?: number;
  /** The agent's one-line reason, while it asks. */
  readonly why: string | null;
  readonly creditsPerHour: number;
  /** The machine's thread asking for it or using it (an older Aldo leaves it out). */
  readonly t3ThreadId?: string | null;
  /** Why it didn't start, when it failed. */
  readonly error: string | null;
}

/** The thread's computers from a directory entry, the one to show first first (an older Aldo reports one, or none). */
export function aldoComputers(environment: {
  readonly computers?: readonly AldoComputer[] | null;
  readonly computer?: AldoComputer | null;
}): readonly AldoComputer[] {
  if (environment.computers) return environment.computers;
  return environment.computer ? [environment.computer] : [];
}

/** How a computer is named to the user: "Windows computer", "GPU computer". */
export function aldoComputerName(computer: Pick<AldoComputer, "kind"> | null | undefined): string {
  if (computer?.kind === "windows") return "Windows computer";
  if (computer?.kind === "gpu") return "GPU computer";
  return "computer";
}

/** Plain status shared by the thread and Home. Older servers omit the position. */
export function aldoComputerQueueLabel(
  kind: string,
  position?: number,
  concurrentLimit?: number,
): string {
  const name = kind === "windows" ? "Windows" : kind === "gpu" ? "GPU" : kind;
  if (kind === "windows" && concurrentLimit) {
    return `Waiting for a Windows slot${position === undefined ? "" : ` · position ${position}`}`;
  }
  return `Waiting for ${name}${position === undefined ? "" : ` · position ${position}`}`;
}

/** What a thread shows about its computer: the ask, "Starting…", or nothing. */
export type AldoComputerNotice = "ask" | "starting" | "queued" | null;

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
  if (computer?.status === "queued") return "queued";
  return computer?.status === "starting" ? "starting" : null;
}

/** Whether the user can stop the computer: while it starts or runs. */
export function aldoComputerStoppable(computer: AldoComputer | null | undefined): boolean {
  return (
    computer?.status === "starting" ||
    computer?.status === "running" ||
    computer?.status === "queued"
  );
}

/** This tab's answer to an ask, while the directory still reports the ask; once it doesn't, a new ask is asked again. */
export function aldoComputerKeptAnswer(
  computer: AldoComputer | null | undefined,
  answer: boolean | undefined,
): boolean | undefined {
  return computer?.status === "asked" ? answer : undefined;
}

/**
 * How a queued or starting request ended, once the thread no longer shows it:
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
  computer: Pick<
    AldoComputer,
    "why" | "creditsPerHour" | "disposable" | "concurrentLimit" | "extraHourlyUsd"
  >,
): string {
  const why = computer.why?.trim() ?? "";
  const reason = why && !/[.!?…]$/.test(why) ? `${why}.` : why;
  const price =
    computer.extraHourlyUsd === undefined
      ? `${credits(computer.creditsPerHour)} an hour while it runs. `
      : computer.extraHourlyUsd === 0
        ? `Your complimentary account isn't billed for this computer (${credits(computer.creditsPerHour)}/hour of usage). `
        : `$${computer.extraHourlyUsd.toFixed(2)} an hour while it runs (${credits(computer.creditsPerHour)}/hour). Billed separately within your extra usage limit. `;
  const cost =
    price +
    (computer.disposable
      ? "This thread gets a fresh computer. Its computer and files are deleted when the thread is done. No kept-disk charge."
      : "It stops when the thread is done.");
  return reason ? `${reason} ${cost}` : cost;
}

/** The Desktop view's screens: the thread machine's own desktop, or the Windows computer's. */
export type AldoDesktopScreen = "machine" | "windows";

/** The screen the Desktop view shows: Windows only while it's chosen and the Windows computer runs. */
export function aldoDesktopScreen(
  chosen: AldoDesktopScreen,
  computer: AldoComputer | null | undefined,
): AldoDesktopScreen {
  return chosen === "windows" && computer?.kind === "windows" && computer.status === "running"
    ? "windows"
    : "machine";
}

/** The desktop stream's URL for a screen: the Windows computer's is the same one with `screen=windows`. */
export function aldoDesktopScreenUrl(desktopUrl: string, screen: AldoDesktopScreen): string {
  if (screen === "machine") return desktopUrl;
  return `${desktopUrl}${desktopUrl.includes("?") ? "&" : "?"}screen=windows`;
}

/**
 * The thread a computer's toast belongs to: the one asking for it or using it
 * (the user sees its toast there), or, from an older Aldo, the thread open.
 */
export function aldoComputerToastThread(
  computer: AldoComputer | null | undefined,
  openThreadId: string,
): string {
  return computer?.t3ThreadId || openThreadId;
}
