// Which providers a machine's server config lists. A machine whose T3 started
// before a provider shipped (Muse Code, say) lists fewer, and gets the rest
// when its T3 starts again.

type Provider = { readonly instanceId?: unknown; readonly driver?: unknown };
type ListsProviders<P extends Provider = Provider> = { readonly providers: ReadonlyArray<P> };

/** The provider instances a config lists, sorted. */
export function providerInstances(config: ListsProviders): string[] {
  return config.providers.map((provider) => String(provider.instanceId)).sort();
}

/**
 * How many kinds of agent a config lists: a T3 that started after one shipped
 * lists more (instances the user added of one kind don't count).
 */
export function providerKinds(config: ListsProviders): number {
  return new Set(config.providers.map((provider) => String(provider.driver))).size;
}

/** The providers `given` lists that `cached` doesn't, in `given`'s order. */
export function missingProviders<P extends Provider>(
  cached: ListsProviders,
  given: ListsProviders<P>,
): P[] {
  const listed = new Set(providerInstances(cached));
  return given.providers.filter((provider) => !listed.has(String(provider.instanceId)));
}

/**
 * A stored server config with the providers of `given` (stored the same way)
 * that it lacks added after its own, or null if it lacks none or can't be read.
 */
export function withMissingProviders(raw: unknown, given: string): string | null {
  if (typeof raw !== "string") return null;
  try {
    type Stored = { config?: { providers?: unknown } };
    const stored = JSON.parse(raw) as Stored;
    const providers = stored.config?.providers;
    const offered = (JSON.parse(given) as Stored).config?.providers;
    if (!Array.isArray(providers) || !Array.isArray(offered)) return null;
    const missing = missingProviders({ providers }, { providers: offered });
    if (missing.length === 0) return null;
    return JSON.stringify({
      ...stored,
      config: { ...stored.config, providers: [...providers, ...missing] },
    });
  } catch {
    return null;
  }
}

/**
 * A stored server config brought up to the template (`given`, stored the same
 * way, or its providers): the providers it lacks (withMissingProviders), and
 * `settings`, the user's that Aldo keeps (machineSettings.logic.ts), over its
 * own, as the machine gets them when it next runs. Null if it lacks neither,
 * or can't be read. It reads the stored config once: Aldo checks a few hundred.
 */
export function withAldoTemplate(
  raw: unknown,
  given: string | { readonly providers: ReadonlyArray<unknown> },
  settings: Readonly<Record<string, unknown>>,
): string | null {
  if (typeof raw !== "string") return null;
  try {
    type Config = { providers?: unknown; settings?: Record<string, unknown> };
    type Stored = { config?: Config };
    const stored = JSON.parse(raw) as Stored | null;
    if (!stored || typeof stored !== "object") return null;
    let config = stored.config;
    let changed = false;
    const offered =
      typeof given === "string" ? (JSON.parse(given) as Stored).config?.providers : given.providers;
    const providers = config?.providers;
    if (config && Array.isArray(providers) && Array.isArray(offered)) {
      const missing = missingProviders({ providers }, { providers: offered as Provider[] });
      if (missing.length > 0) {
        config = { ...config, providers: [...providers, ...missing] };
        changed = true;
      }
    }
    const own = config?.settings;
    if (config && own && typeof own === "object") {
      const differ = Object.entries(settings).filter(
        ([key, value]) => JSON.stringify(own[key]) !== JSON.stringify(value),
      );
      if (differ.length > 0) {
        config = { ...config, settings: { ...own, ...Object.fromEntries(differ) } };
        changed = true;
      }
    }
    return changed ? JSON.stringify({ ...stored, config }) : null;
  } catch {
    return null;
  }
}
