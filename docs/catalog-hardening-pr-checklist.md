# Catalog hardening verification checklist

- CI green including gallery, power conflict and source outage retention regressions.
- Merge only after typecheck and production build pass.
- Before triggering a market, verify no catalog production writer/crawl is already active.
- Run Japan first after merge because it exercises 2010+, 30-day retention, 30k target and JPAuc gallery changes.
- Inspect post-publish report for actual count, source breakdown, priority count, outage-protected rows and publication errors.
- Never report the Japan 30k target as achieved until the production report confirms it.
