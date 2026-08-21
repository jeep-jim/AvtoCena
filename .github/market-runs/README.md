# Catalog market run markers

These files are operator triggers only. Automatic catalog timing is owned by `.github/workflows/catalog-v3-sequential-queue.yml` so production markets do not crawl concurrently.

Updating a market marker intentionally triggers only that market workflow from `main` after the related catalog code has passed CI and been merged.
