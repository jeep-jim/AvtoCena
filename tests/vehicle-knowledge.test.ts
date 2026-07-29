import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readBrandModelDirectory } from "../apps/web/lib/catalog/model-directory";
import { enrichOfferWithVehicleKnowledge, resolveVehicleModelQuery } from "../apps/web/lib/catalog/vehicle-knowledge";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

const brandDirectoryUi = fs.readFileSync(new URL("../apps/web/components/catalog/BrandModelDirectory.tsx", import.meta.url), "utf8");
const modelPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/brand/[slug]/model/[model]/page.tsx", import.meta.url), "utf8");

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

test("brand directory exposes known model power without reading raw JSON in the UI", async () => {
  const models = await readBrandModelDirectory("Toyota");
  const rav4 = models.find((model) => model.id === "toyota/rav4");
  assert.ok(rav4);
  assert.equal(rav4.knowledge.powerHp?.min, 203);
  assert.equal(rav4.knowledge.powerHp?.max, 203);
  assert.equal(rav4.knowledge.powerKw?.min, 149.5);
  assert.equal(rav4.knowledge.engineCc?.min, 2487);
});

test("public brand and model pages render knowledge power, kW and 30-minute fields", () => {
  assert.match(brandDirectoryUi, /Мощность и другие характеристики берутся из базы знаний АвтоЦена/);
  assert.match(brandDirectoryUi, /power30MinKw/);
  assert.match(modelPage, /База знаний АвтоЦена/);
  assert.match(modelPage, /Автосопоставление включено/);
  assert.match(modelPage, /30-минутную мощность/);
  assert.match(modelPage, /utilizationPowerKw/);
  assert.match(modelPage, /readVehicleKnowledgeVariants/);
  assert.match(modelPage, /readVehiclePowerKnowledge/);
});
