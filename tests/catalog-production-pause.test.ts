import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { persistCatalogOffers, isCatalogProductionRefreshAllowed } from "../apps/web/lib/catalog/storage";

test("legacy production writers remain paused while approved storage maintenance is scheduled", () => {
  const queue = fs.readFileSync(".github/workflows/catalog-v3-sequential-queue.yml", "utf8");
  const cleanup = fs.readFileSync(".github/workflows/catalog-storage-cleanup.yml", "utf8");
  const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
  const reusable = fs.readFileSync(".github/workflows/catalog-v3-market-10k-reusable.yml", "utf8");

  assert.doesNotMatch(queue, /^\s*schedule:\s*$/m);
  assert.match(cleanup, /^\s*schedule:\s*$/m);
  assert.match(cleanup, /catalog-storage-maintenance\.mjs/);
  assert.match(storage, /export const CATALOG_PRODUCTION_WRITES_PAUSED = true/);
  assert.match(storage, /CATALOG_PRODUCTION_WRITES_PAUSED && process\.env\.JSON_STORAGE_DRIVER === "object"/);
  assert.match(storage, /catalog_production_writes_paused/);
  assert.match(reusable, /validate:[\s\S]*CATALOG_PRODUCTION_REFRESH_MARKETS\.includes\(process\.env\.REQUESTED_CATALOG_MARKET\)[\s\S]*process\.exit\(1\)/);
  assert.match(reusable, /collect:\s*\n\s*needs: validate/);
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

test("future five-market refreshes retain listings for fourteen days", () => {
  const queue = fs.readFileSync(".github/workflows/catalog-v3-sequential-queue.yml", "utf8");
  const retentionValues = [...queue.matchAll(/retention_ms:\s*"(\d+)"/g)].map((match) => match[1]);

  assert.deepEqual(retentionValues, [
    "1209600000",
    "1209600000",
    "1209600000",
    "1209600000",
    "1209600000",
  ]);
});


test("revoked V3 restart rejects every market even with preservation and both validation gates", async () => {
  const options: any = { productionRefreshMarket: "korea", preservePublicOffersByMarket: {
    china: [], japan: [], uae: [], europe: [], georgia: []
  }, beforePersistValidate() {}, beforePublishValidate() {} };
  for (const market of ["korea", "china", "uae", "europe", "georgia", "japan", "kyrgyzstan", "", undefined]) {
    assert.equal(isCatalogProductionRefreshAllowed({ ...options, productionRefreshMarket: market }), false);
  }
  const previousDriver = process.env.JSON_STORAGE_DRIVER;
  process.env.JSON_STORAGE_DRIVER = "object";
  try {
    await assert.rejects(() => persistCatalogOffers([], options), /catalog_production_writes_paused/);
  } finally {
    if (previousDriver === undefined) delete process.env.JSON_STORAGE_DRIVER;
    else process.env.JSON_STORAGE_DRIVER = previousDriver;
  }
  for (const key of ["beforePersistValidate", "beforePublishValidate", "preservePublicOffersByMarket"]) {
    assert.equal(isCatalogProductionRefreshAllowed({ ...options, [key]: undefined }), false);
  }
  assert.equal(isCatalogProductionRefreshAllowed({ ...options, modificationRecovery: true }), false);
  assert.equal(isCatalogProductionRefreshAllowed({ ...options, appendPublicOffersByMarket: {} }), false);
  const missingJapan = { ...options.preservePublicOffersByMarket }; delete missingJapan.japan;
  assert.equal(isCatalogProductionRefreshAllowed({ ...options, preservePublicOffersByMarket: missingJapan }), false);
});
