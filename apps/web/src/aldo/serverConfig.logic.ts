// Which providers a machine's server config lists. A machine whose T3 started
// before a provider shipped (Muse Code, say) lists fewer, and gets the rest
// when its T3 starts again.

type ListsProviders = { readonly providers: ReadonlyArray<{ readonly instanceId?: unknown }> };

/** The provider instances a config lists, sorted. */
export function providerInstances(config: ListsProviders): string[] {
  return config.providers.map((provider) => String(provider.instanceId)).sort();
}

/** Whether `cached` lacks a provider instance `given` lists. */
export function lacksProviders(cached: ListsProviders, given: ListsProviders): boolean {
  const listed = new Set(providerInstances(cached));
  return providerInstances(given).some((instanceId) => !listed.has(instanceId));
}
