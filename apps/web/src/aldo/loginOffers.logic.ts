// When the user signs in in the thread's browser, Aldo's agent on the machine
// offers to save the login to the vault (Aldo's sandbox-agent/browser/logins.ts)
// with a `loginOffers` message. The Browser panel shows one at a time and saves
// it as the user; sites the user said never to are skipped.

export interface AldoLoginOffer {
  readonly id: string;
  readonly origin: string;
  readonly username: string;
  readonly password: string;
  /** The saved login it would update: the same site and username, another password. */
  readonly saved?: { readonly id: string; readonly label: string; readonly scope: string };
}

const text = (value: unknown): value is string => typeof value === "string";

/** The offers in a `loginOffers` message, skipping any that aren't whole. */
export function parseAldoLoginOffers(value: unknown): AldoLoginOffer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AldoLoginOffer[] => {
    const offer = entry as Record<string, unknown> | null;
    if (
      !offer ||
      !text(offer.id) ||
      !text(offer.origin) ||
      !text(offer.username) ||
      !text(offer.password)
    ) {
      return [];
    }
    if (!offer.password) return [];
    const saved = offer.saved as Record<string, unknown> | undefined;
    const update =
      saved && text(saved.id) && text(saved.label) && text(saved.scope)
        ? { id: saved.id, label: saved.label, scope: saved.scope }
        : undefined;
    return [
      {
        id: offer.id,
        origin: offer.origin,
        username: offer.username,
        password: offer.password,
        ...(update ? { saved: update } : {}),
      },
    ];
  });
}

/** The site a login is for, as people say it: github.com for https://www.github.com. */
export function aldoLoginSite(origin: string): string {
  try {
    const url = new URL(origin);
    return url.port ? url.host : url.hostname.replace(/^www\./, "");
  } catch {
    return origin;
  }
}

/** The offer to show: the first one the user hasn't answered, for a site they didn't say never to. */
export function nextAldoLoginOffer(
  offers: ReadonlyArray<AldoLoginOffer>,
  never: ReadonlySet<string>,
  answered: ReadonlyMap<string, boolean> = new Map(),
): AldoLoginOffer | null {
  return offers.find((offer) => !answered.has(offer.id) && !never.has(offer.origin)) ?? null;
}

/**
 * The user's answers (offer id → saved) that the machine hasn't taken yet:
 * those whose offer it still sends. They're sent again after a reconnect,
 * since an answer given while the connection was down never arrived.
 */
export function pendingAldoLoginAnswers(
  answered: ReadonlyMap<string, boolean>,
  offers: ReadonlyArray<AldoLoginOffer>,
): Map<string, boolean> {
  const offered = new Set(offers.map((offer) => offer.id));
  return new Map([...answered].filter(([id]) => offered.has(id)));
}

/** What saving an offer sends to the vault: an update keeps the saved login's name and threads. */
export function aldoLoginToSave(offer: AldoLoginOffer, scope: string) {
  return {
    ...(offer.saved ? { id: offer.saved.id } : {}),
    label: offer.saved?.label ?? aldoLoginSite(offer.origin),
    origin: offer.origin,
    username: offer.username,
    password: offer.password,
    scope: offer.saved?.scope ?? scope,
  };
}
