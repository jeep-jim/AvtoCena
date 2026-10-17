import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { persistCatalogOffers, readMarketOffers, resetCatalogReadCachesForTests } from "../apps/web/lib/catalog/storage";
import { resetJsonStorageForTests } from "../apps/web/lib/data";

test("publication does not resurrect omitted, sold or expired Korea rows from internal storage", async () => {
  const cwd = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avtocena-withdrawal-"));
  const before = { driver: process.env.JSON_STORAGE_DRIVER, grow: process.env.CATALOG_GROW_ONLY_MARKETS };
  fs.mkdirSync(path.join(directory, "data"));
  process.chdir(directory);
  process.env.JSON_STORAGE_DRIVER = "local";
  delete process.env.CATALOG_GROW_ONLY_MARKETS;
  resetJsonStorageForTests();
  resetCatalogReadCachesForTests();
  const now = new Date().toISOString();
  const offer: any = {
    id: "withdrawal-target", sourceId: "encar_direct", sourceOfferId: "FILTER", market: "korea", offerType: "fixed", status: "active",
    make: "Hyundai", model: "Avante (CN7)", year: 2021, sourcePrice: 18_000_000, sourceCurrency: "KRW", priceMode: "fixed",
    images: Array.from({ length: 5 }, (_, index) => ({ id: `w-${index}`, url: `https://ci.encar.com/carpicture/2026/09/07/12345678/${String(index + 1).padStart(3, '0')}.jpg`, objectKey: "", checksum: "", size: 0, mimeType: "image/jpeg" })),
    totalRub: 2_021_912, mileageKm: 61_114, engineCc: 1_598, powerHp: 123, fuel: "petrol", transmission: "automatic", drive: "fwd", bodyType: "sedan",
    calculationStatus: "ready", calculationSnapshot: { customs: { status: "ready" },
      breakdown: ["car", "topavto-commission", "broker", "svh", "laboratory", "sbkts", "epts", "rf-delivery", "customs"].map(id => ({ id, amountRub: 1 })) },
    firstSeenAt: now, updatedAt: now, operational: { sourceUrl: "https://www.encar.com/dc/dc_cardetailview.do?carid=FILTER", photoIdentityVerified: true, lastSeenAt: now },
  };
  try {
    await persistCatalogOffers([offer]);
    assert.equal((await readMarketOffers("korea")).length, 1);
    await persistCatalogOffers([]);
    assert.equal((await readMarketOffers("korea")).length, 0, "the default writer must respect the publisher's withdrawal selection");
    process.env.CATALOG_GROW_ONLY_MARKETS = "korea";
    await persistCatalogOffers([offer]);
    await persistCatalogOffers([{ ...offer, status: "sold" }]);
    assert.equal((await readMarketOffers("korea")).length, 0, "even explicit legacy grow mode must respect a sold row");
    const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
    await persistCatalogOffers([{ ...offer, operational: { ...offer.operational, lastSeenAt: old } }]);
    await persistCatalogOffers([]);
    assert.equal((await readMarketOffers("korea")).length, 0, "legacy grow mode must not restore a row beyond fourteen days");
  } finally {
    process.chdir(cwd);
    for (const [key, value] of [["JSON_STORAGE_DRIVER", before.driver], ["CATALOG_GROW_ONLY_MARKETS", before.grow]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    resetJsonStorageForTests();
    resetCatalogReadCachesForTests();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
