// What the stand-ins in aldo/deferred/ are made of: components and hosts whose code loads when
// they are first needed rather than with the home screen (vite/aldoDeferred.ts).

import { lazy, Suspense, useSyncExternalStore, type ComponentType } from "react";

const warmable: Array<() => Promise<unknown>> = [];

/** A component whose code loads when it first renders; nothing shows until it has. */
export function deferred<P extends object>(
  load: () => Promise<ComponentType<P>>,
  options: { readonly warm?: boolean } = {},
): ComponentType<P> {
  if (options.warm) warmable.push(load);
  const Loaded = lazy(async () => ({ default: (await load()) as ComponentType<object> }));
  return function Deferred(props: P) {
    return (
      <Suspense fallback={null}>
        <Loaded {...props} />
      </Suspense>
    );
  };
}

/**
 * A host that mounts once something has asked for its module: `use` loads the module for a
 * caller (to open the dialog the host renders), and the host shows from then on.
 */
export function deferredHost<M>(load: () => Promise<M>, host: (module: M) => ComponentType) {
  let wanted = false;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const Loaded = deferred(async () => host(await load()));
  return {
    use: (): Promise<M> => {
      if (!wanted) {
        wanted = true;
        for (const listener of listeners) listener();
      }
      return load();
    },
    Host: function DeferredHost() {
      return useSyncExternalStore(subscribe, () => wanted) ? <Loaded /> : null;
    },
  };
}

/** Fetches the deferred parts the next click most likely needs (chunkPrefetch.ts). */
export function warmDeferred(): ReadonlyArray<() => Promise<unknown>> {
  return warmable;
}
