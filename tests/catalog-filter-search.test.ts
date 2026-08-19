import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { catalogSearchProjectionMatches, catalogSearchProjectionSort, persistCatalogOffers, readCatalogFacets, resetCatalogReadCachesForTests, searchOffers } from "../apps/web/lib/catalog/storage";
import { getJsonStorage, readDataJson, resetJsonStorageForTests, safeStoragePath } from "../apps/web/lib/data";

const modelRoute = fs.readFileSync(new URL("../apps/web/app/api/catalog/models/route.ts", import.meta.url), "utf8");

test("model suggestions merge the live catalog with the curated knowledge base", () => {
  assert.match(modelRoute, /readCatalogFacets\(modelFilters\)/);
  assert.match(modelRoute, /mergeSuggestions\(knowledgeMatches, catalogFacets\.models, query, limit\)/);
});

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
    const images = Array.from({ length: 5 }, (_, index) => ({
      id: `filter-image-${index + 1}`,
      url: `/api/catalog/images/filter-image-${index + 1}`,
      objectKey: `catalog/images/korea/filter-${index + 1}.jpg`,
      width: 1_280,
      height: 960,
      size: 120_000,
      checksum: `filter-${index + 1}`,
      mimeType: "image/jpeg",
    }));
    await persistCatalogOffers([{
      id: "filter-target", sourceId: "filter-test", sourceOfferId: "FILTER", market: "korea", offerType: "fixed", status: "active",
      make: "Hyundai", model: "Avante (CN7)", year: 2021, sourcePrice: 18_000_000, sourceCurrency: "KRW", priceMode: "fixed", images,
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
    const allProjection = await readDataJson<any>("catalog/public/projection/all.json", {});
    assert.deepEqual(allProjection.items?.map((item: any) => item.id), ["filter-target"]);
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
      if (relativePath === "catalog/public/projection/korea.json") projectionReads++;
      return originalRead(relativePath, fallback);
    };
    try {
      await Promise.all([searchOffers(filters), readCatalogFacets(filters)]);
      assert.equal(projectionReads, 1, "parallel result and facets must share one current projection read");
    } finally {
      storage.readJsonWithMeta = originalRead;
    }

    resetCatalogReadCachesForTests();
    let allProjectionReads = 0;
    let manifestReads = 0;
    storage.readJsonWithMeta = async (relativePath: string, fallback: unknown) => {
      if (relativePath === "catalog/public/projection/all.json") allProjectionReads++;
      if (relativePath === "catalog/manifest.json") manifestReads++;
      return originalRead(relativePath, fallback);
    };
    try {
      const globalFilters = { ...filters, market: "any" } as const;
      const [globalResults, globalFacets] = await Promise.all([searchOffers(globalFilters), readCatalogFacets(globalFilters)]);
      assert.deepEqual(globalResults.items.map((offer) => offer.id), ["filter-target"]);
      assert.deepEqual(globalFacets.models, [{ make: "Hyundai", model: "Avante (CN7)" }]);
      assert.equal(allProjectionReads, 1, "global results and filtered facets must share one all-market projection read");
      assert.equal(manifestReads, 1, "the current all-market projection must validate the active manifest generation once");
    } finally {
      storage.readJsonWithMeta = originalRead;
    }

    fs.rmSync(safeStoragePath(`catalog/generations/${manifest.generationId}/indexes/projection/korea.json`), { force: true });
    fs.rmSync(safeStoragePath("catalog/public/projection/korea.json"), { force: true });
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

test("catalog make filter accepts several selected brands as OR", () => {
  const audi = { id: "audi", market: "europe", make: "Audi", model: "A4", year: 2024 } as any;
  const bmw = { id: "bmw", market: "europe", make: "BMW", model: "3 Series", year: 2024 } as any;
  const kia = { id: "kia", market: "korea", make: "Kia", model: "K5", year: 2024 } as any;
  assert.equal(catalogSearchProjectionMatches(audi, { make: "Audi,BMW" }), true);
  assert.equal(catalogSearchProjectionMatches(bmw, { make: "Audi,BMW" }), true);
  assert.equal(catalogSearchProjectionMatches(kia, { make: "Audi,BMW" }), false);
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

test("catalog sort directions used by the filter UI reach the search projection", () => {
  const rows = [
    { id: "middle", totalRub: 2_000_000, year: 2023 },
    { id: "new-expensive", totalRub: 3_000_000, year: 2025 },
    { id: "old-cheap", totalRub: 1_000_000, year: 2021 },
  ] as any[];
  assert.deepEqual(catalogSearchProjectionSort([...rows], "totalRubDesc").map((row) => row.id), ["new-expensive", "middle", "old-cheap"]);
  assert.deepEqual(catalogSearchProjectionSort([...rows], "yearAsc").map((row) => row.id), ["old-cheap", "middle", "new-expensive"]);
});
