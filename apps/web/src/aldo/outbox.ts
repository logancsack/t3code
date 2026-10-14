// A message for a machine this page isn't connected to, or one with files,
// kept on the device from the moment it's sent until Aldo holds it
// (dispatch.ts), its files with it: one the page went away from before Aldo
// had it (the app closed, or the phone reclaimed it) goes when the app is next
// open, comes back to the screen, or is back online, sending only what Aldo
// doesn't have yet. Aldo holds a command once, however often it's handed over,
// so handing one over again is harmless. Best effort: without IndexedDB (a
// private window), a message goes as it did before.

const DATABASE_NAME = "aldo:outbox";
const DATABASE_VERSION = 1;
const STORE_NAME = "messages";
/** One kept longer than this isn't sent any more: it's no longer what the user is waiting on. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export interface AldoOutgoing {
  readonly commandId: string;
  readonly environmentId: string;
  readonly command: unknown;
  /** The files it hands Aldo (files.ts), by the id its attachments name each by. */
  readonly files?: ReadonlyMap<string, Blob>;
  readonly keptAt: number;
}

let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "commandId" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () => reject(new Error("Aldo's outbox is blocked.")));
  }));
}

async function withStore<A>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<A> | void,
): Promise<A | undefined> {
  const transaction = (await openDatabase()).transaction(STORE_NAME, mode);
  const request = use(transaction.objectStore(STORE_NAME));
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  return request?.result;
}

/** Keeps a message, and the files it hands Aldo, until Aldo holds it. */
export async function keepOutgoing(
  environmentId: string,
  command: { readonly commandId: string },
  files: ReadonlyMap<string, Blob> | null = null,
): Promise<void> {
  const entry: AldoOutgoing = {
    commandId: command.commandId,
    environmentId,
    command,
    ...(files ? { files } : {}),
    keptAt: Date.now(),
  };
  await withStore("readwrite", (store) => store.put(entry)).catch(() => undefined);
}

/** Forgets a message Aldo holds now (or won't). */
export async function dropOutgoing(commandId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(commandId)).catch(() => undefined);
}

/** The messages still waiting for Aldo, oldest first; one kept too long is forgotten. */
export async function outgoing(): Promise<AldoOutgoing[]> {
  const entries =
    ((await withStore("readonly", (store) => store.getAll()).catch(() => [])) as
      | AldoOutgoing[]
      | undefined) ?? [];
  const now = Date.now();
  const stale = entries.filter((entry) => now - entry.keptAt > KEEP_MS);
  await Promise.all(stale.map((entry) => dropOutgoing(entry.commandId)));
  return entries
    .filter((entry) => now - entry.keptAt <= KEEP_MS)
    .toSorted((a, b) => a.keptAt - b.keptAt);
}
