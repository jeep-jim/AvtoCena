import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { enrichOfferWithVehicleKnowledge, resolveVehicleModelQuery } from "../apps/web/lib/catalog/vehicle-knowledge";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

const modelDirectory = fs.readFileSync(new URL("../apps/web/lib/catalog/model-directory.ts", import.meta.url), "utf8");
const brandDirectoryUi = fs.readFileSync(new URL("../apps/web/components/catalog/BrandModelDirectory.tsx", import.meta.url), "utf8");
const modelPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/model/[model]/page.tsx", import.meta.url), "utf8");
const productionWorkflow = fs.readFileSync(new URL("../.github/workflows/catalog-v2-production.yml", import.meta.url), "utf8");
const dromEnrichment = fs.readFileSync(new URL("../scripts/catalog-enrich-drom-vehicle-variants.mjs", import.meta.url), "utf8");
const knowledgeAudit = fs.readFileSync(new URL("../scripts/catalog-audit-vehicle-knowledge.mjs", import.meta.url), "utf8");

function offer(overrides: Partial<VehicleOffer> = {}): VehicleOffer {
  return {
    id: "test-offer",
    sourceId: "test",
    sourceOfferId: "1",
    market: "japan",
    offerType: "fixed",
    status: "active",
    make: "HONDA",
    model: "HR-V 1.5 e:HEV Z Black Style",
    year: 2024,
    mileageKm: 1000,
    sourcePrice: 1_000_000,
    sourceCurrency: "JPY",
    priceMode: "fixed",
    images: [],
    calculationStatus: "needs_data",
    firstSeenAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    operational: {},
    ...overrides,
  };
}

test("resolves HRV alias to canonical Honda HR-V", async () => {
  const matches = await resolveVehicleModelQuery("hrv", undefined, 10);
  assert.ok(matches.length > 0);
  assert.equal(matches[0].make, "Honda");
  assert.equal(matches[0].model, "HR-V");
});

test("canonicalizes a long listing model title", async () => {
  const result = await enrichOfferWithVehicleKnowledge(offer());
  assert.equal(result.make, "Honda");
  assert.equal(result.model, "HR-V");
  assert.equal((result.operational.raw as any)?.vehicleKnowledgeModel?.id, "honda/hr-v");
});

test("does not confuse Honda Vezel with HR-V", async () => {
  const result = await enrichOfferWithVehicleKnowledge(offer({ model: "VEZEL e:HEV Z", year: 2023 }));
  assert.equal(result.make, "Honda");
  assert.equal(result.model, "Vezel");
});

test("model directory aggregates variants and power references into public characteristics", () => {
  assert.match(modelDirectory, /readVehicleKnowledgeVariants/);
  assert.match(modelDirectory, /readVehiclePowerKnowledge/);
  assert.match(modelDirectory, /power30MinKw/);
  assert.match(modelDirectory, /utilizationPowerKw/);
  assert.match(modelDirectory, /engineCc/);
  assert.match(modelDirectory, /knowledge: summarizeModel/);
});

test("public brand and model pages render knowledge power, kW and 30-minute fields", () => {
  assert.match(brandDirectoryUi, /Нажмите на модель, чтобы раскрыть характеристики/);
  assert.match(brandDirectoryUi, /aria-controls/);
  assert.match(brandDirectoryUi, /Все характеристики и предложения/);
  assert.match(brandDirectoryUi, /utilizationPowerKw/);
  assert.match(brandDirectoryUi, /power30MinKw/);
  assert.match(brandDirectoryUi, /fuels/);
  assert.match(brandDirectoryUi, /powertrains/);
  assert.match(modelPage, /База знаний АвтоЦена/);
  assert.match(modelPage, /Автосопоставление включено/);
  assert.match(modelPage, /30-минутную мощность/);
  assert.match(modelPage, /utilizationPowerKw/);
  assert.match(modelPage, /readVehicleKnowledgeVariants/);
  assert.match(modelPage, /readVehiclePowerKnowledge/);
});

test("production workflow continuously enriches specifications for the latest ten years", () => {
  assert.match(productionWorkflow, /catalog-enrich-drom-vehicle-variants\.mjs/);
  assert.match(productionWorkflow, /VEHICLE_KNOWLEDGE_RECENT_YEARS: "10"/);
  assert.match(productionWorkflow, /DROM_KNOWLEDGE_LIMIT: "500"/);
  assert.match(productionWorkflow, /Enrich recent model specifications/);
  assert.match(dromEnrichment, /RECENT_YEAR_FLOOR/);
  assert.match(dromEnrichment, /activeModelIds\.has\(model\.id\) \|\| !ONLY_RECENT \|\| modelIsRecent\(model\)/);
  assert.match(dromEnrichment, /status: "blocked"/);
});

test("vehicle knowledge audit reports recent specification coverage", () => {
  assert.match(knowledgeAudit, /recentCoverage/);
  assert.match(knowledgeAudit, /modelsWithAnySpecifications/);
  assert.match(knowledgeAudit, /coreSpecificationCoverage/);
  assert.match(knowledgeAudit, /minimumRecentSpecificationCoverage/);
});
