// A written message to Aldo on Home, kept on the device from the moment it's
// sent until Aldo has taken it in (assistantSession.ts), so one the page went
// away from first (the app closed, or the phone reclaimed it) isn't lost: it's
// sent when the app is next open, by the id it was given, which Aldo takes
// once however often it's sent. Only a backstop: the page sends a message at
// the moment it's written. Best effort: without IndexedDB (a private window),
// a message is sent as it was before.

import type { AldoFileUpload, AldoImageUpload } from "./assistantApi";

const DATABASE_NAME = "aldo:home-outbox";
const STORE_NAME = "messages";
/** One kept longer than this isn't sent any more: it's no longer what the user is waiting on. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export interface AldoHomeMessage {
  readonly id: string;
  /** The account that sent it: another account on the device never sends it. */
  readonly userId: string | null;
  readonly sessionId: string;
  readonly text: string;
  readonly images: ReadonlyArray<AldoImageUpload>;
  /** Its files, uploaded to Aldo already (a copy kept by an older page has none). */
  readonly files?: ReadonlyArray<AldoFileUpload>;
  readonly viewing: { readonly environmentId: string; readonly threadId: string } | null;
  /** When the user sent it, as it shows in the conversation. */
  readonly at: string;
  readonly keptAt: number;
}

let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
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

/** Keeps a message until Aldo has it. */
export async function keepHomeMessage(message: Omit<AldoHomeMessage, "keptAt">): Promise<void> {
  const entry: AldoHomeMessage = { ...message, keptAt: Date.now() };
  await withStore("readwrite", (store) => store.put(entry)).catch(() => undefined);
}

/** Forgets a message Aldo has now (or won't take). */
export async function dropHomeMessage(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id)).catch(() => undefined);
}

/** The messages still waiting for Aldo, oldest first; one kept too long is forgotten. */
export async function homeMessages(): Promise<AldoHomeMessage[]> {
  const entries =
    ((await withStore("readonly", (store) => store.getAll()).catch(() => [])) as
      | AldoHomeMessage[]
      | undefined) ?? [];
  const now = Date.now();
  await Promise.all(
    entries
      .filter((entry) => now - entry.keptAt > KEEP_MS)
      .map((entry) => dropHomeMessage(entry.id)),
  );
  return entries
    .filter((entry) => now - entry.keptAt <= KEEP_MS)
    .toSorted((a, b) => a.keptAt - b.keptAt);
}
