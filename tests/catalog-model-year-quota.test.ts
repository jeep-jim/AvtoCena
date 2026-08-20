import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CATALOG_MAX_OFFERS_PER_MODEL_YEAR,
  catalogExactModelKey,
  catalogModelYearQuotaKey,
  enforceCatalogModelYearQuota,
  selectCatalogShowcaseDiversity,
  selectCatalogModelYearCoverageFirst,
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

test("homepage showcase prefers different makes and exact models without losing freshness order", () => {
  const rows = [
    { ...offer("japan", "Honda", "WR-V", 2026), id: "wrv-new" },
    { ...offer("japan", "Honda", "WR-V", 2025), id: "wrv-old" },
    { ...offer("japan", "Honda", "Accord", 2025), id: "accord" },
    { ...offer("japan", "Toyota", "Sienta", 2025), id: "sienta" },
    { ...offer("japan", "Nissan", "Serena", 2024), id: "serena" },
    { ...offer("japan", "Mazda", "CX-5", 2024), id: "cx5" },
  ];
  const selected = selectCatalogShowcaseDiversity(rows, 4);
  assert.deepEqual(selected.map((row: any) => row.id), ["wrv-new", "sienta", "serena", "cx5"]);
  assert.equal(new Set(selected.map((row: any) => catalogExactModelKey(row))).size, 4);
});

test("homepage showcase uses different models of the same make before duplicate models", () => {
  const rows = [
    { ...offer("japan", "Honda", "WR-V", 2026), id: "wrv-new" },
    { ...offer("japan", "Honda", "WR-V", 2025), id: "wrv-old" },
    { ...offer("japan", "Honda", "Accord", 2025), id: "accord" },
    { ...offer("japan", "Honda", "Stepwgn", 2023), id: "stepwgn" },
  ];
  assert.deepEqual(selectCatalogShowcaseDiversity(rows, 3).map((row: any) => row.id), ["wrv-new", "accord", "stepwgn"]);
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

test("canonical publication caps normalized model-year buckets and preserves quality order", () => {
  const rows = [
    ...Array.from({ length: 25 }, (_, index) => ({ ...offer("china", "Toyota", "Hiace", 2025), id: `hiace-${index}` })),
    ...Array.from({ length: 3 }, (_, index) => ({ ...offer("china", "Toyota", "Hiace", 2024), id: `hiace-old-${index}` })),
  ];
  const result = enforceCatalogModelYearQuota(rows);
  assert.equal(result.rows.length, 23);
  assert.equal(result.removed.length, 5);
  assert.deepEqual(result.rows.slice(0, 3).map((row: any) => row.id), ["hiace-0", "hiace-1", "hiace-2"]);
  assert.equal(result.rows.filter((row: any) => row.year === 2025).length, 20);
  assert.equal(result.rows.filter((row: any) => row.year === 2024).length, 3);
});

test("coverage-first bounded output represents every discovered model-year before taking seconds", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => ({ ...offer("korea", "Hyundai", "Casper", 2025), id: `25-${index}`, score: 100 - index })),
    ...Array.from({ length: 20 }, (_, index) => ({ ...offer("korea", "Hyundai", "Casper", 2024), id: `24-${index}`, score: 80 - index })),
    ...Array.from({ length: 20 }, (_, index) => ({ ...offer("korea", "Hyundai", "Casper", 2022), id: `22-${index}`, score: 60 - index })),
    ...Array.from({ length: 20 }, (_, index) => ({ ...offer("korea", "Kia", "Morning", 2021), id: `m21-${index}`, score: 40 - index })),
  ];
  const selected = selectCatalogModelYearCoverageFirst(rows, 8, (a: any, b: any) => b.score - a.score);
  const counts = new Map<string, number>();
  for (const row of selected) {
    const key = catalogModelYearQuotaKey(row);
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  assert.equal(counts.size, 4);
  assert.deepEqual([...counts.values()].sort((a, b) => a - b), [2, 2, 2, 2]);
  assert.equal(selected.filter((row) => row.model === "Casper" && row.year === 2022).length, 2);
});

test("coverage-first does not let newer Casper rows crowd out Casper 2022 at a small target", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => ({ ...offer("korea", "Hyundai", "Casper", 2025), id: `25-${index}` })),
    ...Array.from({ length: 20 }, (_, index) => ({ ...offer("korea", "Hyundai", "Casper", 2022), id: `22-${index}` })),
  ];
  const selected = selectCatalogModelYearCoverageFirst(rows, 2);
  assert.equal(selected.length, 2);
  assert.equal(selected.filter((row) => row.year === 2022).length, 1);
  assert.equal(selected.filter((row) => row.year === 2025).length, 1);
});

test("market age gates keep Japan at the agreed 2015 floor", () => {
  assert.equal(catalogMinYearForMarket("korea"), 2020);
  assert.equal(catalogMinYearForMarket("europe"), 2020);
  assert.equal(catalogMinYearForMarket("georgia"), 2020);
  assert.equal(catalogMinYearForMarket("japan"), 2015);
  assert.equal(isCatalogYearAllowed(2019, "korea"), false);
  assert.equal(isCatalogYearAllowed(2020, "korea"), true);
  assert.equal(isCatalogYearAllowed(2014, "japan"), false);
  assert.equal(isCatalogYearAllowed(2015, "japan"), true);
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

test("generic collector scans beyond the output target and selects model-year coverage first", () => {
  const source = fs.readFileSync("scripts/catalog-live-recovery-market.mjs", "utf8");
  assert.match(source, /selectCatalogModelYearCoverageFirst/);
  assert.match(source, /while \(pages < maxPages && Date\.now\(\) < deadline\)/);
  assert.doesNotMatch(source, /while \(pages < maxPages && accepted\.size < target/);
  assert.doesNotMatch(source, /sort\(qualityOrder\)\.slice\(0, target\)/);
});

test("generic recovery retains source-bound combustion offers as explicit preliminary power-pending instead of dropping them", () => {
  const source = fs.readFileSync("scripts/catalog-live-recovery-market.mjs", "utf8");
  assert.match(source, /calculateOfferWithPreliminaryPowerPricing/);
  assert.match(source, /isPreliminaryPowerPendingCalculation/);
  assert.doesNotMatch(source, /isPreliminaryElectrifiedCalculation/);
  assert.match(source, /recoveryPreliminaryPowerPending:\s*isPreliminaryPowerPendingCalculation/);
  assert.match(source, /preliminaryCount:\s*offers\.filter\(isPreliminaryPowerPendingCalculation\)/);
});

test("daily and legacy recovery workflows expose only model-year quota and canonical Georgia sources", () => {
  for (const path of [
    ".github/workflows/catalog-live-daily-working-markets.yml",
    ".github/workflows/catalog-live-recovery-6-markets.yml",
    ".github/workflows/catalog-live-recovery-uae-georgia-direct.yml",
  ]) {
    const workflow = fs.readFileSync(path, "utf8");
    assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/, `${path} must expose model-year quota`);
    assert.match(workflow, /CATALOG_AUDIT_MAX_PER_MODEL_YEAR: "20"/, `${path} must audit model-year quota`);
    assert.doesNotMatch(workflow, /CATALOG_MAX_OFFERS_PER_MODEL: "20"/, `${path} must not expose model-only quota`);
    assert.doesNotMatch(workflow, /CATALOG_AUDIT_MAX_PER_MODEL: "20"/, `${path} must not audit model-only quota`);
  }

  const daily = fs.readFileSync(".github/workflows/catalog-live-daily-working-markets.yml", "utf8");
  assert.doesNotMatch(daily, /myauto_georgia_list|autopapa_georgia_open/);

  const georgiaV2 = fs.readFileSync(".github/workflows/catalog-live-recovery-georgia-yandex-v2.yml", "utf8");
  assert.match(georgiaV2, /myauto_georgia_list/);
  assert.match(georgiaV2, /autopapa_georgia_open/);
  assert.doesNotMatch(georgiaV2, /auto_georgia_open|www\.auto\.ge/i);

  const legacy = fs.readFileSync(".github/workflows/catalog-live-recovery-6-markets.yml", "utf8");
  assert.match(legacy, /sources: "myauto_georgia_list,autopapa_georgia_open"/);
  assert.doesNotMatch(legacy, /auto_georgia_open|www\.auto\.ge/i);
});
