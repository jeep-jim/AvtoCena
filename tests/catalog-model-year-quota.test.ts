import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CATALOG_MAX_OFFERS_PER_MODEL_YEAR,
  catalogExactModelKey,
  catalogModelYearQuotaKey,
} from "../apps/web/lib/catalog/inventory-quota";
import { catalogMinYearForMarket, isCatalogYearAllowed } from "../apps/web/lib/catalog/offer-quality";

function offer(market: string, make: string, model: string, year: number) {
  return { market, make, model, year } as any;
}

test("inventory quota is twenty per market + exact model + year", () => {
  assert.equal(CATALOG_MAX_OFFERS_PER_MODEL_YEAR, 20);
  assert.equal(catalogModelYearQuotaKey(offer("korea", "Hyundai", "Casper", 2022)), "korea|hyundai|casper|2022");
  assert.equal(catalogModelYearQuotaKey(offer("korea", "Hyundai", "Casper", 2025)), "korea|hyundai|casper|2025");
  assert.notEqual(
    catalogModelYearQuotaKey(offer("korea", "Hyundai", "Casper", 2022)),
    catalogModelYearQuotaKey(offer("korea", "Hyundai", "Casper", 2025)),
  );
  assert.notEqual(
    catalogModelYearQuotaKey(offer("korea", "Hyundai", "Casper", 2022)),
    catalogModelYearQuotaKey(offer("europe", "Hyundai", "Casper", 2022)),
  );
  assert.equal(catalogExactModelKey(offer("korea", "Hyundai", "Casper", 2022)), "korea|hyundai|casper");
});

test("different years can each retain twenty cards for the same model", () => {
  const rows = [
    ...Array.from({ length: 25 }, (_, index) => ({ ...offer("korea", "Hyundai", "Casper", 2022), id: `22-${index}` })),
    ...Array.from({ length: 25 }, (_, index) => ({ ...offer("korea", "Hyundai", "Casper", 2025), id: `25-${index}` })),
  ];
  const counts = new Map<string, number>();
  const selected = [];
  for (const row of rows) {
    const key = catalogModelYearQuotaKey(row);
    const count = counts.get(key) || 0;
    if (count >= CATALOG_MAX_OFFERS_PER_MODEL_YEAR) continue;
    counts.set(key, count + 1);
    selected.push(row);
  }
  assert.equal(selected.filter((row) => row.year === 2022).length, 20);
  assert.equal(selected.filter((row) => row.year === 2025).length, 20);
  assert.equal(selected.length, 40);
});

test("market age gates stay unchanged while quota changes", () => {
  const currentYear = new Date().getFullYear();
  assert.equal(catalogMinYearForMarket("korea"), 2020);
  assert.equal(catalogMinYearForMarket("china"), 2020);
  assert.equal(catalogMinYearForMarket("uae"), 2020);
  assert.equal(catalogMinYearForMarket("europe"), 2020);
  assert.equal(catalogMinYearForMarket("georgia"), 2020);
  assert.equal(catalogMinYearForMarket("kyrgyzstan"), 2020);
  assert.equal(catalogMinYearForMarket("japan"), currentYear - 15);
  assert.equal(isCatalogYearAllowed(2019, "korea"), false);
  assert.equal(isCatalogYearAllowed(2020, "korea"), true);
  assert.equal(isCatalogYearAllowed(currentYear - 15, "japan"), true);
});

test("all active quota paths use the shared model-year identity", () => {
  for (const path of [
    "scripts/catalog-live-recovery-market.mjs",
    "scripts/catalog-live-recovery-publish.mjs",
    "scripts/catalog-enforce-global-model-cap.mjs",
    "scripts/catalog-japan-strict-merge-publish.mjs",
    "scripts/catalog-replace-georgia-atomic.mjs",
    "scripts/catalog-live-postpersist-audit.mjs",
  ]) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /catalogModelYearQuotaKey/, `${path} must use model-year quota identity`);
  }
});

test("scheduled daily collection cannot reintroduce banned Georgia sources", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-live-daily-working-markets.yml", "utf8");
  assert.match(workflow, /market: georgia, source: myauto_georgia_list/);
  assert.match(workflow, /market: georgia, source: autopapa_georgia_open/);
  assert.doesNotMatch(workflow, /market: georgia, source: auto_georgia_open/);
  assert.doesNotMatch(workflow, /market: georgia, source: ss_georgia_open/);
  assert.doesNotMatch(workflow, /market: georgia, source: mymarket_georgia_open/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR:\s*"20"/);
  assert.doesNotMatch(workflow, /CATALOG_MAX_OFFERS_PER_MODEL:(?!_YEAR)/);
});

test("direct UAE Georgia publisher audits the model-year quota", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-live-recovery-uae-georgia-direct.yml", "utf8");
  assert.match(workflow, /RECOVERY_SOURCE_IDS="myauto_georgia_list,autopapa_georgia_open"/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR:\s*"20"/);
  assert.match(workflow, /CATALOG_AUDIT_MAX_PER_MODEL_YEAR:\s*"20"/);
  assert.match(workflow, /maxPerExactModelYear/);
  assert.doesNotMatch(workflow, /CATALOG_MAX_OFFERS_PER_MODEL:(?!_YEAR)/);
  assert.doesNotMatch(workflow, /CATALOG_AUDIT_MAX_PER_MODEL:(?!_YEAR)/);
});
