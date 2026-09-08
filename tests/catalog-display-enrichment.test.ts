import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDubizzleStoredRangeMetrics } from "../apps/web/lib/catalog/dubizzle-exact-source";
import { catalogOfferVisibleRub } from "../apps/web/lib/catalog/public-priority";
import { catalogPricingSpecificationsChanged, enrichOfferForDisplay } from "../apps/web/lib/catalog/display-enrichment";

test("a knowledge power correction invalidates the stored customs price", () => {
  const stored = { powerHp: 100, powerKw: 73.55, powerDataSource: "power_scenario:fallback_100", powertrainKind: "combustion", engineCc: 1984 } as any;
  const enriched = { ...stored, powerHp: 190, powerKw: 139.74, utilizationPowerKw: 139.74, powerDataSource: "encyclopedia_v2:audi-a6-45-tfsi" } as any;
  assert.equal(catalogPricingSpecificationsChanged(stored, enriched), true);
  assert.equal(catalogPricingSpecificationsChanged(enriched, { ...enriched }), false);
});

test("fills known BMW i3 eDrive display fields instead of showing unresolved placeholders", async () => {
  const offer = {
    id: "bmw-i3-edrive-40l",
    sourceId: "dubicars_uae_exact",
    sourceOfferId: "bmw-1",
    market: "uae",
    offerType: "fixed",
    status: "active",
    make: "BMW",
    model: "i3 eDrive 40L",
    trim: "Law Mileage (32,000 Km) 340 Hp",
    year: 2023,
    mileageKm: 32_000,
    powerHp: 340,
    powertrainKind: "unknown",
    sourcePrice: 120_000,
    sourceCurrency: "AED",
    images: [],
    totalRub: 3_172_025,
    firstSeenAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    operational: {
      sourceUrl: "https://example.com/bmw-i3",
      raw: { title: "BMW i3 eDrive 40L Law Mileage 32,000 Km 340 Hp" },
    },
  } as any;

  const enriched = await enrichOfferForDisplay(offer);

  assert.equal(enriched.powertrainKind, "electric");
  assert.equal(enriched.fuel, "electric");
  assert.equal(enriched.transmission, "automatic");
  assert.equal(enriched.drive, "rwd");
  assert.equal(enriched.engineCc, undefined);
});

test("offer detail enrichment uses the same canonical China identity as catalog cards", async () => {
  const offer = {
    id: "china-xiaoao-vito-detail",
    sourceId: "autohome_used_china_open",
    sourceOfferId: "xiaoao-1",
    market: "china",
    offerType: "fixed",
    status: "active",
    make: "AM晓澳汽车",
    model: "晓澳汽车 VITO",
    year: 2025,
    mileageKm: 1_000,
    powerHp: 231,
    engineCc: 1991,
    powertrainKind: "combustion",
    sourcePrice: 680_000,
    sourceCurrency: "CNY",
    images: [],
    totalRub: 15_000_000,
    firstSeenAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    operational: {
      sourceUrl: "https://example.com/xiaoao-vito",
      raw: { title: "AM晓澳汽车 晓澳汽车 VITO" },
    },
  } as any;

  const enriched = await enrichOfferForDisplay(offer);
  assert.equal(enriched.make, "Mercedes-Benz");
  assert.equal(enriched.model, "Vito");
  assert.equal(enriched.totalRub, offer.totalRub);
  assert.equal(enriched.powerHp, offer.powerHp);
});

test("display enrichment does not invent Toyota Raize pricing specs from model-wide data", async () => {
  const offer = {
    id: "dubizzle-raize-range",
    sourceId: "dubizzle_uae_open",
    sourceOfferId: "range-only",
    market: "uae",
    offerType: "fixed",
    status: "active",
    make: "Toyota",
    model: "Raize",
    trim: "TURBO G",
    year: 2023,
    mileageKm: 77_000,
    sourcePrice: 32_000,
    sourceCurrency: "AED",
    images: [],
    totalRub: null,
    calculationStatus: "needs_data",
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    operational: { sourceUrl: "https://dubai.dubizzle.com/example" },
  } as any;

  const enriched = await enrichOfferForDisplay(offer);
  assert.equal(enriched.engineCc, undefined);
  assert.equal(enriched.powerHp, undefined);
  assert.notEqual(enriched.calculationStatus, "ready");
});

test("frozen Dubizzle bucket boundaries are removed only with retained range evidence", async () => {
  const hit = {
    details: {
      "Engine Capacity (cc)": { en: { value: "0 - 1,499 cc" } },
      Horsepower: { en: { value: "50 - 99 HP" } },
    },
  };
  const offer = {
    id: "dubizzle-stored-raize",
    sourceId: "dubizzle_uae_open",
    sourceOfferId: "stored-range",
    market: "uae",
    offerType: "fixed",
    status: "active",
    make: "Toyota",
    model: "Raize",
    trim: "TURBO G",
    year: 2023,
    mileageKm: 77_000,
    engineCc: 1499,
    powerHp: 99,
    powerDataConfidence: "source_exact",
    powerDataSource: "Dubizzle Algolia",
    sourcePrice: 32_000,
    sourceCurrency: "AED",
    images: [],
    totalRub: 2_138_248,
    calculationStatus: "ready",
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    operational: { raw: { parsed: { rawText: JSON.stringify(hit) } } },
  } as any;

  const enriched = await enrichOfferForDisplay(offer);
  assert.equal(enriched.engineCc, undefined);
  assert.equal(enriched.powerHp, undefined);
  assert.equal(enriched.powerDataConfidence, undefined);
  assert.equal(enriched.powerDataSource, undefined);
  assert.notEqual(enriched.calculationStatus, "ready");

  const exactCoincidence = await enrichOfferForDisplay({
    ...offer,
    id: "dubizzle-exact-coincidence",
    operational: { raw: { parsed: { rawText: JSON.stringify({ details: {} }) } } },
  });
  assert.equal(exactCoincidence.engineCc, 1499);
  assert.equal(exactCoincidence.powerHp, 99);
});

test("Swift GLX bucket interiors never survive as exact power, displacement or old pricing", async () => {
  const offer = {
    id: "9b8958287db01ba3fef50bf8", sourceId: "dubizzle_uae_open", sourceOfferId: "swift-glx",
    market: "uae", make: "Suzuki", model: "Swift", trim: "GLX", year: 2024,
    generation: "suzuki/swift/japan-2023", engineCc: 1373, powerHp: 140,
    powerKw: 102.97, icePowerKw: 102.97, utilizationPowerKw: 102.97,
    powerDataConfidence: "reference", powerDataSource: "vehicle-knowledge:drom_f1e86718d9701240befdaed7",
    powertrainKind: "combustion", fuel: "petrol", sourcePrice: 39500, sourceCurrency: "AED",
    totalRub: 2376520, publicVisibleRub: 2376520, publicSpecificationVerified: true, cardProjectionVersion: 3,
    calculationStatus: "ready", calculationSnapshot: { powerRequiresConfirmation: false }, images: [],
    operational: { raw: { parsed: { rawText: JSON.stringify({ details: {
      "Engine Capacity (cc)": { en: { value: "1000 - 1499 cc" } }, Horsepower: { en: { value: "100 - 199 HP" } },
    } }) } } },
  } as any;
  assert.equal(catalogOfferVisibleRub(offer), 0, "legacy compact attestation must not bypass provenance");
  const safe = sanitizeDubizzleStoredRangeMetrics(offer);
  for (const field of ["engineCc", "powerHp", "powerKw", "icePowerKw", "utilizationPowerKw", "calculationSnapshot"]) assert.equal(safe[field], undefined, field);
  assert.equal(safe.totalRub, null);
  assert.equal(safe.publicSpecificationVerified, false);
  const enriched = await enrichOfferForDisplay(offer);
  assert.equal(enriched.engineCc, undefined);
  assert.equal(enriched.powerHp, undefined);
  assert.equal(catalogOfferVisibleRub(enriched), 0);
  assert.equal(offer.powerHp, 140, "do not mutate the stored input");

  const documented = { ...offer, powerDataSource: "seller document", powerDataConfidence: "documented",
    operational: { ...offer.operational, semanticEvidence: {
      engineCc: { source: "seller document", status: "exact", value: 1373 },
      powerHp: { source: "seller document", status: "exact", value: 140 },
    } } };
  assert.equal(sanitizeDubizzleStoredRangeMetrics(documented), documented, "independent exact evidence survives a category bucket");
});
