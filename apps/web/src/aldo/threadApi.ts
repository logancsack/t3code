// Durable thread transport, cached reads, uploads and machine settings.

import { api, AldoApiError, threadIdForEnvironment } from "./api";
import { type UsageSummaryInput } from "@t3tools/contracts";
import { aldoEnvironmentIdFor } from "./directory";
import {
  aldoHoldAgain,
  type AldoUpload,
  aldoPartsOf,
  aldoMissingParts,
  ALDO_FILE_PART_BYTES,
  aldoHeldFileCommand,
  aldoUploadsOf,
  aldoHeldCommand,
} from "./held.logic";

/** The newest T3 server config Aldo has for the user (see /api/models). */
export async function fetchAldoServerConfig(): Promise<unknown> {
  const { config } = await api<{ config: unknown }>("/api/models");
  return config;
}

export async function reportAldoServerConfig(config: unknown): Promise<void> {
  await api("/api/models", { method: "POST", body: JSON.stringify({ config }) });
}

/**
 * The T3 settings Aldo keeps as the user's and writes into every machine
 * (machineSettings.ts), or null from an Aldo that doesn't keep them.
 */
export async function fetchAldoMachineSettings(): Promise<unknown> {
  const body = await api<{ settings?: unknown }>("/api/machine-settings").catch(
    (error: unknown) => {
      if (error instanceof AldoApiError && error.status === 404) return null;
      throw error;
    },
  );
  // An older Aldo may answer with the web client's page instead of a 404.
  const settings = body?.settings;
  return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : null;
}

/** Saves the ones `settings` names over the ones saved before; answers with all of them. */
export async function saveAldoMachineSettings(settings: Record<string, unknown>): Promise<unknown> {
  const body = await api<{ settings?: unknown }>("/api/machine-settings", {
    method: "POST",
    body: JSON.stringify({ settings }),
  });
  return body.settings;
}

/** The agents whose subagents can have a default model of the user's. */
export type AldoSubagentProvider = "claude" | "codex";

/** What an agent's subagents run on when it names no model: a model id, and (Codex only) a reasoning effort. */
export type AldoSubagentDefault = { readonly model: string; readonly reasoning?: string };

export type AldoSubagents = Partial<Record<AldoSubagentProvider, AldoSubagentDefault>>;

/**
 * Each agent's subagent default the user chose (Settings → Agents), or
 * null from an Aldo that doesn't keep them.
 */
export async function fetchAldoSubagents(): Promise<AldoSubagents | null> {
  const body = await api<{ subagents?: unknown }>("/api/subagents").catch((error: unknown) => {
    if (error instanceof AldoApiError && error.status === 404) return null;
    throw error;
  });
  // An older Aldo may answer with the web client's page instead of a 404.
  const subagents = body?.subagents;
  return subagents && typeof subagents === "object" && !Array.isArray(subagents)
    ? (subagents as AldoSubagents)
    : null;
}

/** Sets the agents `change` names (null: its subagents run on its own model); answers with all of them. */
export async function saveAldoSubagents(
  change: Partial<Record<AldoSubagentProvider, AldoSubagentDefault | null>>,
): Promise<AldoSubagents> {
  const body = await api<{ subagents: AldoSubagents }>("/api/subagents", {
    method: "POST",
    body: JSON.stringify({ subagents: change }),
  });
  return body.subagents;
}

/** Machines' threads (T3 shells) as their aldod last reported them, by thread id. Never wakes one. */
export async function fetchAldoShells(
  threadIds: ReadonlyArray<string>,
): Promise<Record<string, unknown>> {
  const { shells } = await api<{ shells: Record<string, unknown> }>(
    `/api/environments/shells?ids=${threadIds.join(",")}`,
  );
  return shells;
}

/** This browser's copy of a machine's threads, for Aldo to keep until the machine reports its own. */
export async function offerAldoShell(threadId: string, shell: unknown): Promise<void> {
  await api("/api/environments/shells", {
    method: "POST",
    body: JSON.stringify({ threadId, shell }),
  });
}

/**
 * What each machine's agents used in this window, as Aldo answers for it from
 * what the machine last reported (usage.ts), by environment id. A machine
 * that never reported is left out, and an Aldo without these has none. Never
 * wakes one.
 */
export async function fetchAldoUsage(input: UsageSummaryInput): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    sinceDay: input.sinceDay,
    untilDay: input.untilDay,
    timeZone: input.timeZone,
  });
  if (input.resolution) query.set("resolution", input.resolution);
  if (input.sinceTime) query.set("sinceTime", input.sinceTime);
  if (input.untilTime) query.set("untilTime", input.untilTime);
  const { usage } = await api<{ usage?: Record<string, unknown> }>(
    `/api/environments/usage?${query}`,
  ).catch((error: unknown) => {
    if (error instanceof AldoApiError && (error.status === 404 || error.status === 405)) {
      return { usage: {} };
    }
    throw error;
  });
  return Object.fromEntries(
    Object.entries(usage ?? {}).map(([threadId, summary]) => [
      aldoEnvironmentIdFor(threadId),
      summary,
    ]),
  );
}

/**
 * A T3 thread's detail as its machine last reported it (threadDetails.ts):
 * `sequence` is Aldo's copy's, null when it has none, and `detail` comes only
 * when it's newer than `after`, this browser's own.
 */
export async function fetchAldoThreadDetail(
  environmentId: string,
  t3ThreadId: string,
  after: number | null,
  signal?: AbortSignal,
): Promise<{ readonly sequence: number | null; readonly detail: unknown }> {
  const query = new URLSearchParams({ t3ThreadId });
  if (after !== null) query.set("after", String(after));
  const threadId = threadIdForEnvironment(environmentId);
  return api(`/api/environments/${threadId}/detail?${query}`, signal ? { signal } : {});
}

/**
 * One of T3's commands for a thread on a machine this browser isn't
 * connected to, with what it changes in the thread's shell entry
 * (threadCommands.ts), made from this browser's copy of the shell at
 * sequence `base`: Aldo sends it now if the machine runs, else when it next
 * starts. Returns the sequence of Aldo's copy of the shell with the change,
 * null if it has none; a 412 if Aldo's copy is newer than `base`.
 */
export async function sendAldoThreadCommand(
  environmentId: string,
  command: unknown,
  patch: unknown,
  base: number,
): Promise<{ readonly sequence: number | null }> {
  const threadId = threadIdForEnvironment(environmentId);
  return api(`/api/environments/${threadId}/commands`, {
    method: "POST",
    body: JSON.stringify({ command, patch, base }),
  });
}

/** How long one try at handing Aldo a message waits for its answer. */
const HOLD_TIMEOUT_MS = 20_000;

/** How long one part of an image waits for Aldo's answer: a few MB from a phone. */
const UPLOAD_TIMEOUT_MS = 120_000;

/** A held message this small goes as a keepalive request, which outlives the page. */
const KEEPALIVE_MAX_BYTES = 60_000;

/** Runs `request` again while it gets no answer or Aldo is in trouble (aldoHoldAgain), for as long as that lasts. */
async function untilAnswered<A>(request: () => Promise<A>): Promise<A> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (cause) {
      // fetch rejects with a TypeError when nothing answered; a timeout with a DOMException.
      const status =
        cause instanceof AldoApiError
          ? cause.status
          : cause instanceof TypeError || cause instanceof DOMException
            ? null
            : undefined;
      if (status === undefined || !aldoHoldAgain(status)) throw cause;
      await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 1_000 * 2 ** attempt)));
    }
  }
}

/** Sends one of a message's images to Aldo, in parts; false when this Aldo takes no uploads. */
async function uploadAldoImage(threadId: string, upload: AldoUpload): Promise<boolean> {
  for (const [part, text] of aldoPartsOf(upload.dataUrl).entries()) {
    try {
      await untilAnswered(() =>
        api(
          `/api/environments/${threadId}/uploads?upload=${encodeURIComponent(upload.id)}&part=${part}`,
          {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: text,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
          },
        ),
      );
    } catch (cause) {
      if (cause instanceof AldoApiError && (cause.status === 404 || cause.status === 405)) {
        return false;
      }
      throw cause;
    }
  }
  return true;
}

/** Each file's upload to Aldo under way, by id: another for the same file goes after it. */
const fileUploads = new Map<string, Promise<void>>();

/**
 * Sends Aldo the parts of a file a message carries that it doesn't have yet
 * (`id`: the attachment's, aldoAttachmentId), so an upload begun as the file
 * was attached, or one a page went away from, carries on where it stopped.
 * One already under way for the file finishes first. Tries again while Aldo
 * doesn't answer.
 */
export function uploadAldoFile(environmentId: string, id: string, file: Blob): Promise<void> {
  const threadId = threadIdForEnvironment(environmentId);
  return uploadInTurn(
    id,
    `/api/environments/${threadId}/files?upload=${encodeURIComponent(id)}`,
    file,
  );
}

/** Sends Aldo a file attached to a message to it on Home, as uploadAldoFile does a thread's (`id`: the one the message names it by). */
export function uploadAldoHomeFile(id: string, file: Blob): Promise<void> {
  return uploadInTurn(id, `/api/assistant/files?upload=${encodeURIComponent(id)}`, file);
}

function uploadInTurn(id: string, path: string, file: Blob): Promise<void> {
  const run = (fileUploads.get(id) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => sendAldoFileParts(path, file));
  fileUploads.set(id, run);
  const forget = () => {
    if (fileUploads.get(id) === run) fileUploads.delete(id);
  };
  run.then(forget, forget);
  return run;
}

async function sendAldoFileParts(path: string, file: Blob): Promise<void> {
  const { parts } = await untilAnswered(() =>
    api<{ parts: Array<{ part: number; bytes: number }> }>(path, {
      signal: AbortSignal.timeout(HOLD_TIMEOUT_MS),
    }),
  );
  for (const part of aldoMissingParts(file.size, parts)) {
    const body = file.slice(part * ALDO_FILE_PART_BYTES, (part + 1) * ALDO_FILE_PART_BYTES);
    await untilAnswered(() =>
      api(`${path}&part=${part}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      }),
    );
  }
}

/**
 * Hands Aldo a message (T3's `thread.turn.start`) for a machine this browser
 * isn't connected to, or one with `files` (its attachments' files, by the id
 * each is named by) however the machine is. Aldo brings the machine up and
 * sends it, even if this page goes away; this page sends one without files
 * too once connected, and T3 runs it once. Files go first, the parts Aldo
 * doesn't have yet (uploadAldoFile); without them, images too big to go with
 * the message go first, in parts (held.logic.ts). `now`: sent from a page
 * connected to the machine, it goes at once. Tries again for as long as Aldo
 * doesn't answer (the message waits on the device meanwhile: outbox.ts).
 * "held" once Aldo has it; "refused" when Aldo won't hold one without files
 * (an older Aldo's limit, a thread that's gone): the page sends it itself, as
 * before. One with files Aldo won't hold throws Aldo's reason.
 */
export async function holdAldoTurn(
  environmentId: string,
  command: unknown,
  files: ReadonlyMap<string, Blob> | null = null,
  now = false,
): Promise<"held" | "refused"> {
  const threadId = threadIdForEnvironment(environmentId);
  for (let tries = 0; ; tries++) {
    let held = command;
    if (files) {
      for (const [id, file] of files) await uploadAldoFile(environmentId, id, file);
      held = aldoHeldFileCommand(command, files, now);
    } else {
      const uploads = aldoUploadsOf(command);
      if (uploads.length > 0) {
        let uploaded = true;
        for (const upload of uploads) {
          if (!(uploaded = await uploadAldoImage(threadId, upload))) break;
        }
        // An Aldo that takes no uploads holds images inline, as before.
        if (uploaded) held = aldoHeldCommand(command, uploads);
      }
    }
    const body = JSON.stringify({ command: held });
    try {
      await untilAnswered(() =>
        api(`/api/environments/${threadId}/turns`, {
          method: "POST",
          body,
          keepalive: new TextEncoder().encode(body).length < KEEPALIVE_MAX_BYTES,
          signal: AbortSignal.timeout(HOLD_TIMEOUT_MS),
        }),
      );
      return "held";
    } catch (cause) {
      if (!(cause instanceof AldoApiError) || cause.status === 401) throw cause;
      // Its uploads' parts were gone by the time Aldo held it (kept a day unnamed): sent again, once.
      if (cause.status === 409 && held !== command && tries === 0) continue;
      if (files || (command as { aldoModelExplicit?: unknown }).aldoModelExplicit !== undefined)
        throw cause;
      return "refused";
    }
  }
}

type ThreadDetailSource = (
  environmentId: string,
  threadId: string,
  cachedSequence: number | null,
) => Promise<unknown>;

let threadDetailSource: ThreadDetailSource | null = null;

/** Where T3's thread cache finds Aldo's copy of a thread (threadDetails.ts). */
export function setAldoThreadDetailSource(source: ThreadDetailSource): void {
  threadDetailSource = source;
}

/**
 * Aldo's copy of a thread whose machine isn't connected, when it's newer than
 * this browser's cached one (`cachedSequence`), for T3's thread cache to open
 * it with (connection/storage.ts). Null otherwise; never fails.
 */
export async function aldoThreadDetail(
  environmentId: string,
  threadId: string,
  cachedSequence: number | null,
): Promise<unknown> {
  if (!threadDetailSource) return null;
  return threadDetailSource(environmentId, threadId, cachedSequence).catch(() => null);
}
