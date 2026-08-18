import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  readEncyclopediaKnowledgeModels,
  readEncyclopediaKnowledgeVariants,
  readVerifiedEncyclopediaCorpus,
} from "../apps/web/lib/catalog/encyclopedia";
import {
  enrichOfferWithVehicleKnowledge,
  findVehicleModel,
  readVehicleKnowledgeModels,
  readVehicleKnowledgeVariants,
  resetVehicleKnowledgeCache,
  resolveVehicleModelQuery,
} from "../apps/web/lib/catalog/vehicle-knowledge";
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

test("does not join adjacent trim tokens into a false model match", async () => {
  const match = await findVehicleModel(offer({
    make: "Chevrolet",
    model: "2.0 Turbo LT",
    trim: "2.0 Turbo LT",
    year: 2021,
  }));
  assert.notEqual(match?.model.id, "chevrolet/bolt");
});

test("does not use a make token as Mercedes-Benz model evidence", async () => {
  const vito = await enrichOfferWithVehicleKnowledge(offer({
    market: "europe",
    make: "Mercedes-Benz",
    model: "Vito",
    trim: "114 CDI",
    year: 2020,
    sourceCurrency: "EUR",
  }));
  assert.equal(vito.model, "Vito");
  assert.notEqual(vito.model, "Benz");

  const sprinter = await enrichOfferWithVehicleKnowledge(offer({
    market: "europe",
    make: "Mercedes-Benz",
    model: "Sprinter",
    trim: "316 CDI",
    year: 2020,
    sourceCurrency: "EUR",
  }));
  assert.equal(sprinter.model, "Sprinter");
  assert.notEqual(sprinter.model, "Benz");
});

test("verified encyclopedia corpus is intact and complete", async () => {
  const corpus = await readVerifiedEncyclopediaCorpus();
  assert.equal(corpus.sourceCheckpoint, "4a145d3e");
  assert.equal(corpus.models.length, 62);
  assert.equal(corpus.variants.length, 740);
  assert.equal(corpus.totals.models, 62);
  assert.equal(corpus.totals.variants, 740);
  assert.ok(corpus.models.some((row) => row.id === "toyota/premio"));
  assert.ok(corpus.models.some((row) => row.id === "toyota/regiusace"));
  assert.ok(corpus.models.some((row) => row.id === "toyota/crown-sport"));
  assert.ok(corpus.variants.some((row) => row.id === "toyota/premio/second-generation/f-2016"));
  assert.ok(corpus.variants.some((row) => row.id === "toyota/crown-sport/sixteenth-generation/sport-rs-phev-2023" && row.powerKw === 225));
});

test("full verified corpus remains read-only and cannot expand calculator runtime", async () => {
  resetVehicleKnowledgeCache();
  const [runtimeModels, runtimeVariants, publicModels, publicVariants] = await Promise.all([
    readVehicleKnowledgeModels(),
    readVehicleKnowledgeVariants(),
    readEncyclopediaKnowledgeModels(),
    readEncyclopediaKnowledgeVariants(),
  ]);

  assert.equal(runtimeModels.length, 4_905);
  assert.equal(runtimeVariants.length, 15_744);
  assert.ok(!runtimeModels.some((row) => row.id === "toyota/premio"));
  assert.ok(!runtimeVariants.some((row) => row.id === "toyota/premio/second-generation/f-2016"));

  assert.ok(publicModels.length > runtimeModels.length);
  assert.ok(publicVariants.length > runtimeVariants.length);
  assert.ok(publicModels.some((row) => row.id === "toyota/premio"));
  assert.ok(publicModels.some((row) => row.id === "toyota/regiusace"));
  assert.ok(publicVariants.some((row) => row.id === "toyota/premio/second-generation/f-2016"));
});

test("model directory aggregates verified encyclopedia variants and power references into public characteristics", () => {
  assert.match(modelDirectory, /readEncyclopediaKnowledgeModels/);
  assert.match(modelDirectory, /readEncyclopediaKnowledgeVariants/);
  assert.match(modelDirectory, /readVehiclePowerKnowledge/);
  assert.match(modelDirectory, /power30MinKw/);
  assert.match(modelDirectory, /utilizationPowerKw/);
  assert.match(modelDirectory, /engineCc/);
  assert.match(modelDirectory, /knowledge: summarizeModel/);
});

test("public brand and model pages render encyclopedia power, kW and 30-minute fields", () => {
  assert.match(brandDirectoryUi, /Нажмите на модель, чтобы раскрыть характеристики/);
  assert.match(brandDirectoryUi, /aria-controls/);
  assert.match(brandDirectoryUi, /Все характеристики и предложения/);
  assert.match(brandDirectoryUi, /utilizationPowerKw/);
  assert.match(brandDirectoryUi, /power30MinKw/);
  assert.match(brandDirectoryUi, /fuels/);
  assert.match(brandDirectoryUi, /powertrains/);
  assert.match(modelPage, /Энциклопедия АвтоЦена/);
  assert.match(modelPage, /Автосопоставление включено/);
  assert.match(modelPage, /30-минутную мощность/);
  assert.match(modelPage, /utilizationPowerKw/);
  assert.match(modelPage, /readEncyclopediaKnowledgeVariants/);
  assert.match(modelPage, /readVehiclePowerKnowledge/);
});

test("verified V2 cards stay visible without fabricated power", () => {
  assert.match(modelPage, /const powerHp = positive\(variant\.powerHp, 2_500\)/);
  assert.doesNotMatch(modelPage, /const powerHp = (?:Number|positive)\(variant\.powerHp[^;]*;\s*if \(!powerHp\) continue/);
  assert.match(modelPage, /variantName/);
  assert.match(modelPage, /Серия \/ период/);
  assert.match(modelPage, /эл\.мотор peak/);
  assert.match(modelPage, /система max/);
  assert.match(modelPage, /variant\.sourceType !== "encyclopedia_v2"/);
});

test("Drom enrichment remains available but is not a two-hour production prerequisite", () => {
  assert.match(productionWorkflow, /scripts\/catalog-enrich-drom-vehicle-variants\.mjs/);
  assert.match(productionWorkflow, /Audit current encyclopedia snapshot/);
  assert.doesNotMatch(productionWorkflow, /Enrich recent model specifications/);
  assert.doesNotMatch(productionWorkflow, /DROM_KNOWLEDGE_LIMIT: "500"/);
  assert.match(dromEnrichment, /RECENT_YEAR_FLOOR/);
  assert.match(dromEnrichment, /activeModelIds\.has\(model\.id\) \|\| !ONLY_RECENT \|\| modelIsRecent\(model\)/);
  assert.match(dromEnrichment, /status: "blocked"/);
});

test("vehicle knowledge is restricted to the rolling 15-year import window", () => {
  assert.match(knowledgeAudit, /const KNOWLEDGE_WINDOW_YEARS = 15/);
  assert.match(knowledgeAudit, /new Date\(\)\.getFullYear\(\) - KNOWLEDGE_WINDOW_YEARS/);
  assert.doesNotMatch(knowledgeAudit, /KNOWLEDGE_WINDOW_YEARS \+ 1/);
  assert.match(knowledgeAudit, /filter\(withinKnowledgeWindow\)/);
  assert.match(knowledgeAudit, /excludedOldModels/);
  assert.match(knowledgeAudit, /excludedOldVariants/);
  assert.match(knowledgeAudit, /knowledgeYearFloor/);
});

test("vehicle knowledge audit reports recent specification coverage", () => {
  assert.match(knowledgeAudit, /recentCoverage/);
  assert.match(knowledgeAudit, /modelsWithAnySpecifications/);
  assert.match(knowledgeAudit, /coreSpecificationCoverage/);
  assert.match(knowledgeAudit, /minimumRecentSpecificationCoverage/);
});
