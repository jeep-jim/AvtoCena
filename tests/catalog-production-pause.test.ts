import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { persistCatalogOffers } from "../apps/web/lib/catalog/storage";

test("catalog production collection, cleanup and publication remain paused during specification repair", () => {
  const queue = fs.readFileSync(".github/workflows/catalog-v3-sequential-queue.yml", "utf8");
  const cleanup = fs.readFileSync(".github/workflows/catalog-storage-cleanup.yml", "utf8");
  const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");

  assert.doesNotMatch(queue, /^\s*schedule:\s*$/m);
  assert.doesNotMatch(cleanup, /^\s*schedule:\s*$/m);
  assert.match(storage, /export const CATALOG_PRODUCTION_WRITES_PAUSED = true/);
  assert.match(storage, /CATALOG_PRODUCTION_WRITES_PAUSED && process\.env\.JSON_STORAGE_DRIVER === "object"/);
  assert.match(storage, /catalog_production_writes_paused/);
});

test("Object Storage publication fails before any catalog write", async () => {
  const previousDriver = process.env.JSON_STORAGE_DRIVER;
  process.env.JSON_STORAGE_DRIVER = "object";
  try {
    await assert.rejects(() => persistCatalogOffers([]), /catalog_production_writes_paused/);
  } finally {
    if (previousDriver === undefined) delete process.env.JSON_STORAGE_DRIVER;
    else process.env.JSON_STORAGE_DRIVER = previousDriver;
  }
});

test("future six-market refreshes retain non-Japan listings for fourteen days", () => {
  const queue = fs.readFileSync(".github/workflows/catalog-v3-sequential-queue.yml", "utf8");
  const retentionValues = [...queue.matchAll(/retention_ms:\s*"(\d+)"/g)].map((match) => match[1]);

  assert.deepEqual(retentionValues, [
    "2592000000",
    "1209600000",
    "1209600000",
    "1209600000",
    "1209600000",
    "1209600000",
  ]);
});
