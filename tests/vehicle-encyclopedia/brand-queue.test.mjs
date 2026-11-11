import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const report = await readJson(path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2/reports/brand-queue.json"));

test("brand queue covers the production baseline and official expansion exactly once", () => {
  assert.equal(report.totals.productionBrands, 185);
  assert.equal(report.totals.officialPortfolioExpansionBrands, 70);
  assert.equal(report.totals.denominatorBrands, 255);
  assert.equal(report.queue.length, 255);
  assert.equal(new Set(report.queue.map((row) => row.brand)).size, 255);
  assert.equal(report.totals.complete, 0);
  assert.equal(report.totals.verifiedRecords, 9);
  assert.equal(report.totals.inProgress, 255);
  assert.equal(report.totals.queued, 0);
  assert.deepEqual(report.brandRegistryExpansion.map((row) => row.brand), [
    "AION", "Aiways", "Alpine", "AMBERAUTO", "AMBERTRUCK", "ARCFOX", "AUDI China", "Brabus", "Bugatti", "Caterham", "Changan NEVO",
    "CIIMO", "Cirelli", "Dallara", "DFSK", "Dongfeng Aeolus", "Dongfeng eπ", "Dongfeng Nammi", "Donkervoort",
    "DR", "DS Automobiles", "e.GO", "EBRO", "Elaris", "EMC", "EONYX", "EVO", "EVOLUTE", "Exlantix",
    "FANGCHENGBAO", "Farizon", "firefly", "Geely Galaxy", "HEDMOS", "HYPTEC", "iCAUR", "INEOS",
    "JAC Yiwei", "JMEV", "KTM", "Kuayue", "Lada", "LEPAS", "LEVC", "LUXEED", "Mahindra", "MAN", "Micro", "Mobilize", "Moke", "Nordcross", "ONVO",
    "RADAR", "RUF", "SECMA", "SHANGJIE", "Skyworth", "Solaris", "Sollers", "Sportequipe",
    "SRM Shineray", "STELATO", "Suda", "TENET", "Togg", "VinFast", "XCITE", "YANGWANG", "Yudo", "Zhidou",
  ]);
});

test("legacy records remain candidates and checkpoint queues stay bounded", () => {
  assert.equal(report.productionModified, false);
  assert.equal(report.totals.legacyCandidateModels, 4899);
  assert.equal(report.totals.legacyCandidateVariants, 15735);
  assert.equal(report.totals.canonicalModels, 1619);
  assert.equal(report.totals.canonicalGenerations, 1293);
  assert.equal(report.totals.canonicalFacelifts, 105);
  assert.equal(report.totals.canonicalVariants, 19240);
  assert.equal(report.activeCheckpoint, "checkpoint-05");
  assert.equal(report.nextCheckpoint.length, 15);
  assert.equal(report.checkpoints["checkpoint-02"].length, 15);
  assert.equal(report.checkpoints["checkpoint-03"].length, 15);
  assert.equal(report.checkpoints["checkpoint-05"].length, 15);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-02" && row.status === "in-progress").length, 15);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-02" && row.status === "queued").length, 0);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-03" && row.status === "in-progress").length, 15);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-03" && row.status === "queued").length, 0);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-05" && row.status === "in-progress").length, 15);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-05" && row.status === "queued").length, 0);
  const citroen = report.queue.find((row) => row.brand === "Citroen");
  assert.equal(citroen.v2BrandId, "citroen");
  assert.equal(citroen.legacyCandidateModels, 97);
  assert.equal(citroen.legacyCandidateVariants, 219);
});

test("priority queue is demand-led and exposes honest legacy coverage limits", () => {
  assert.equal(report.activePriorityBatch, "mass-market-01");
  assert.deepEqual(report.queue.slice(0, 15).map((row) => row.brand), report.nextPriorityBrands);
  assert.deepEqual(report.nextPriorityBrands, [
    "Toyota", "Honda", "Nissan", "Suzuki", "Mazda",
    "Subaru", "Mitsubishi", "Daihatsu", "Hyundai", "Kia",
    "Volkswagen", "Audi", "BMW", "Mercedes-Benz", "BYD",
  ]);
  assert.deepEqual(report.coverageWindows.map(({ market, yearFrom, yearTo }) => ({ market, yearFrom, yearTo })), [
    { market: "Japan", yearFrom: 2015, yearTo: 2026 },
    { market: "All other active AvtoCena markets", yearFrom: 2020, yearTo: 2026 },
  ]);
  assert.equal(report.legacyInventory.variantsWithoutProductionYears, 11027);
  assert.deepEqual(report.legacyInventory.datedWindows.japanPriorityProxy, {
    yearFrom: 2015,
    yearTo: 2026,
    candidateVariants: 3939,
    uniqueCandidateConfigurations: 3700,
    candidateBrands: 33,
    candidateModels: 139,
    candidateGenerations: 340,
  });
  assert.deepEqual(report.legacyInventory.datedWindows.otherMarketsPriorityProxy, {
    yearFrom: 2020,
    yearTo: 2026,
    candidateVariants: 2098,
    uniqueCandidateConfigurations: 1991,
    candidateBrands: 30,
    candidateModels: 117,
    candidateGenerations: 225,
  });
});
