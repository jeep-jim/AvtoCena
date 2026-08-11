import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { catalogSearchProjectionMatches, persistCatalogOffers, readCatalogFacets, resetCatalogReadCachesForTests, searchOffers } from "../apps/web/lib/catalog/storage";
import { getJsonStorage, readDataJson, resetJsonStorageForTests, safeStoragePath } from "../apps/web/lib/data";

test("all catalog filters use the projection when optional categorical shards are absent", async () => {
  const cwd = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avtocena-filter-search-"));
  fs.mkdirSync(path.join(directory, "data"));
  process.chdir(directory);
  process.env.JSON_STORAGE_DRIVER = "local";
  process.env.CATALOG_GROW_ONLY_MARKETS = "";
  resetJsonStorageForTests();

  try {
    const now = new Date().toISOString();
    const image = { id: "filter-image", url: "/api/catalog/images/filter-image", objectKey: "catalog/images/korea/filter.jpg", width: 1_280, height: 960, size: 120_000, checksum: "filter", mimeType: "image/jpeg" };
    await persistCatalogOffers([{
      id: "filter-target", sourceId: "filter-test", sourceOfferId: "FILTER", market: "korea", offerType: "fixed", status: "active",
      make: "Hyundai", model: "Avante (CN7)", year: 2021, sourcePrice: 18_000_000, sourceCurrency: "KRW", priceMode: "fixed", images: [image],
      totalRub: 2_021_912, mileageKm: 61_114, engineCc: 1_598, powerHp: 123, fuel: "petrol", transmission: "automatic", drive: "fwd", bodyType: "sedan",
      calculationStatus: "ready", calculationSnapshot: {
        customs: { status: "ready" },
        breakdown: ["car", "topavto-commission", "broker", "svh", "laboratory", "sbkts", "epts", "rf-delivery", "customs"]
          .map((id) => ({ id, amountRub: 1 })),
      },
      firstSeenAt: now, updatedAt: now, operational: { sourceUrl: "https://example.test/filter-target" },
    } as any]);

    const manifest = await readDataJson<any>("catalog/manifest.json", {});
    const projection = await readDataJson<any>(`catalog/generations/${manifest.generationId}/indexes/projection/korea.json`, {});
    assert.equal(projection.items?.[0]?.bodyType, "sedan");
    fs.rmSync(safeStoragePath(`catalog/generations/${manifest.generationId}/indexes/make/hyundai.json`), { force: true });
    fs.rmSync(safeStoragePath(`catalog/generations/${manifest.generationId}/indexes/model/hyundai-avante-cn7.json`), { force: true });

    const filters = { market: "korea", make: "Hyundai", model: "Avante (CN7)", hasPrice: "yes", budgetFrom: 2_000_000, budgetTo: 2_100_000, yearFrom: 2021, yearTo: 2021, mileageFrom: 60_000, mileageTo: 62_000, engineFrom: 1_500, engineTo: 1_600, powerFrom: 120, powerTo: 160, fuel: "petrol", transmission: "automatic", drive: "fwd", bodyType: "sedan", pageSize: 10 } as const;
    for (const [name, value] of Object.entries(filters)) {
      if (name === "pageSize") continue;
      const isolated = await searchOffers({ market: "korea", [name]: value, pageSize: 10 });
      assert.deepEqual(isolated.items.map((offer) => offer.id), ["filter-target"], `isolated filter failed: ${name}`);
    }
    const filtered = await searchOffers(filters);
    assert.deepEqual(filtered.items.map((offer) => offer.id), ["filter-target"]);

    resetCatalogReadCachesForTests();
    const storage = getJsonStorage() as any;
    const originalRead = storage.readJsonWithMeta.bind(storage);
    let projectionReads = 0;
    storage.readJsonWithMeta = async (relativePath: string, fallback: unknown) => {
      if (relativePath.endsWith("/indexes/projection/korea.json")) projectionReads++;
      return originalRead(relativePath, fallback);
    };
    try {
      await Promise.all([searchOffers(filters), readCatalogFacets(filters)]);
      assert.equal(projectionReads, 1, "parallel result and facets must share one immutable projection read");
    } finally {
      storage.readJsonWithMeta = originalRead;
    }

    fs.rmSync(safeStoragePath(`catalog/generations/${manifest.generationId}/indexes/projection/korea.json`), { force: true });
    resetCatalogReadCachesForTests();
    const legacyFiltered = await searchOffers(filters);
    assert.deepEqual(legacyFiltered.items.map((offer) => offer.id), ["filter-target"], "legacy generations must still apply every filter exactly");
  } finally {
    process.chdir(cwd);
    resetCatalogReadCachesForTests();
    resetJsonStorageForTests();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the 160 hp utilization-fee filter uses certified calculation power", () => {
  const certifiedElectric = {
    id: "certified-electric", market: "china", make: "BYD", model: "Seal", year: 2025,
    powerHp: 530, powerKw: 390, powertrainKind: "electric", power30MinKw: 100, utilizationPowerKw: 100,
  } as any;
  const uncertifiedElectric = {
    id: "uncertified-electric", market: "china", make: "BYD", model: "Seal", year: 2025,
    powerHp: 150, powerKw: 110, powertrainKind: "electric",
  } as any;
  const hybridAboveThreshold = {
    id: "hybrid-above", market: "japan", make: "Toyota", model: "Harrier", year: 2024,
    powerHp: 152, powertrainKind: "other_hybrid", power30MinKw: 35, utilizationPowerKw: 130,
  } as any;

  assert.equal(catalogSearchProjectionMatches(certifiedElectric, { powerTo: 160 }), true);
  assert.equal(catalogSearchProjectionMatches(certifiedElectric, { powerTo: 130 }), false);
  assert.equal(catalogSearchProjectionMatches(uncertifiedElectric, { powerTo: 160 }), false);
  assert.equal(catalogSearchProjectionMatches(hybridAboveThreshold, { powerTo: 160 }), false);
});
