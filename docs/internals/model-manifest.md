# Model manifest

The [bundled manifest](../../apps/server/src/provider/model-manifest.json) allows
offline startup; fetching it from `main` lets model metadata change between
releases. Failed fetches or invalid data preserve the last usable manifest.
Remote data must pass both catalog-reference validation and the owning provider's
adapter validation before replacing the cache.

A newer bundle outranks the cached remote manifest by `updatedAt`, so a release can
correct model data before the next successful fetch. Bump `updatedAt` whenever the
file changes. Fetch time cannot establish which copy contains the newer edit.

Generic catalog data describes presentation and capabilities. Each provider owns
its adapter schema and dispatch mappings. Codex and Claude discover models and
capabilities from their account's runtime; the manifest supplies offline catalogs
and adapter mappings where discovery is unavailable.

`currentModels.claudeAgent` is the current-model classification overlay for
releases that predate catalog discovery; it does not add models to their catalogs.
Catalog-aware releases classify models as legacy only when their
`providers.<driver>.models[].status` explicitly says `legacy`. A newly discovered
model remains visible when the manifest has no entry for it. The manifest's chat
default is applied separately, so discovering a model does not replace it.

Model data is schema-validated configuration. Tests should cover resolver, cache,
and adapter semantics with synthetic model names, so adding a model never requires
tests that repeat the configuration.
