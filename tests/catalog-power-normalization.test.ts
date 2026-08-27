import assert from "node:assert/strict";
import test from "node:test";
import { enrichOfferWithExplicitEngineDisplacement } from "../apps/web/lib/catalog/explicit-engine-displacement";
import { canonicalizeSemanticSourceFields, preferExplicitCombustionPowertrain } from "../apps/web/lib/catalog/powertrain-safety";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization";
import { applyPrestigeJapanExactIdentityKnowledge } from "../apps/web/lib/catalog/prestige-japan-identity-knowledge";

test("extracts structured peak kW without treating it as 30-minute power", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "EV", operational: { raw: { specification: { maxPowerKw: 150 } } } });
  assert.equal(normalized.powerKw, 150);
  assert.equal(normalized.powerHp, 203.94);
  assert.equal(normalized.power30MinKw, undefined);
  assert.equal(normalized.utilizationPowerKw, undefined);
});

test("sums documented 30-minute power for multiple traction motors", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "Dual Motor EV", powertrainKind: "electric" as const, power30MinKwByMotor: [40, 35], powerDataSource: "EPTS" });
  assert.deepEqual(normalized.power30MinKwByMotor, [40, 35]);
  assert.equal(normalized.power30MinKw, 75);
  assert.equal(normalized.utilizationPowerKw, 75);
  assert.equal(normalized.powerDataConfidence, "documented");
});

test("adds ICE and documented motor power for a non-series hybrid", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "PHEV", powertrainKind: "other_hybrid" as const, icePowerKw: 110, power30MinKwByMotor: [30, 25] });
  assert.equal(normalized.power30MinKw, 55);
  assert.equal(normalized.utilizationPowerKw, 165);
});

test("extracts exact 30-minute power from structured source fields", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "EV", powertrainKind: "electric" as const, operational: { raw: { certification: { maximum30MinutePowerKw: 72 } } } });
  assert.equal(normalized.power30MinKw, 72);
  assert.equal(normalized.utilizationPowerKw, 72);
  assert.equal(normalized.powerDataConfidence, "source_exact");
});

test("extracts exact 30-minute power from source text", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Example", model: "EV", powertrainKind: "electric" as const, operational: { raw: { specs: "Maximum 30-minute power: 68 kW" } } });
  assert.equal(normalized.power30MinKw, 68);
  assert.equal(normalized.utilizationPowerKw, 68);
});

test("extracts Russian horsepower unit", () => {
  assert.equal(normalizeVehicleOfferSpecs({ trim: "Мощность 190 л.с." }).powerHp, 190);
});

test("extracts Chinese power unit", () => {
  assert.equal(normalizeVehicleOfferSpecs({ operational: { raw: { specs: "最大功率 150 kW" } } }).powerHp, 203.94);
});

test("extracts Georgian horsepower unit", () => {
  assert.equal(normalizeVehicleOfferSpecs({ operational: { raw: { specs: "სიმძლავრე 190 ცხენის ძალა" } } }).powerHp, 190);
});

test("extracts engine volume from nested raw details", () => {
  const normalized = normalizeVehicleOfferSpecs({ operational: { raw: { technical: { engine_capacity: "1.5 L" } } } });
  assert.equal(normalized.engineCc, 1500);
});

test("explicit petrol engine overrides unrelated hybrid text in raw listing payload", () => {
  const normalized = normalizeVehicleOfferSpecs({ make: "Toyota", model: "RAV4", fuel: "petrol", engineCc: 2500, powerHp: 203, operational: { raw: { imageUrl: "https://cdn.example/hybrid/recommendation/photo.jpg" } } });
  assert.equal(normalized.powertrainKind, "combustion");
  const safe = preferExplicitCombustionPowertrain(normalized);
  assert.equal(safe.powertrainKind, "combustion");
  assert.equal(safe.power30MinKw, undefined);
  assert.equal(safe.utilizationPowerKw, safe.powerKw);
});

test("explicit hybrid title is never downgraded to combustion", () => {
  const safe = preferExplicitCombustionPowertrain({ make: "Toyota", model: "RAV4", trim: "2.5 Plug-in Hybrid", fuel: "petrol", engineCc: 2500, powertrainKind: "other_hybrid" as const });
  assert.equal(safe.powertrainKind, "other_hybrid");
});

test("identity-bound Hybrid name corrects a stale combustion classification", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Honda",
    model: "Grace Hybrid",
    fuel: "petrol",
    engineCc: 1496,
    powertrainKind: "combustion" as const,
    powerHp: 110,
    icePowerKw: 80.9,
    utilizationPowerKw: 80.9,
    powerDataSource: "marketplace detail:Power",
  });
  assert.equal(normalized.powertrainKind, "other_hybrid");
  assert.equal(normalized.fuel, "hybrid");
  assert.equal(normalized.icePowerKw, undefined);
  assert.equal(normalized.utilizationPowerKw, undefined);
});

test("identity-bound e-Power name corrects a stale combustion classification", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Nissan",
    model: "Note e-Power",
    fuel: "petrol",
    engineCc: 1198,
    powertrainKind: "combustion" as const,
  });
  assert.equal(normalized.powertrainKind, "series_hybrid");
  assert.equal(normalized.fuel, "hybrid");
});

test("exact Prestige Crown chassis supplies identity and powertrain but never power", () => {
  const enriched = applyPrestigeJapanExactIdentityKnowledge({
    sourceId: "prestige_japan_auctions_open",
    market: "japan",
    make: "Toyota",
    model: "Crown",
    powertrainKind: "combustion" as const,
    operational: { raw: {
      detailIdentityVerified: true,
      photoIdentityVerified: true,
      listingBoundImages: true,
      recoveryExactSourceUrl: true,
      recoveryExactPhotoIdentity: true,
      fields: { Make: "TOYOTA", Model: "CROWN SPORT", Chassis: "AZSH37W" },
    } },
  });
  assert.equal(enriched.model, "Crown");
  assert.equal(enriched.generation, "Crown Sport PHEV");
  assert.equal(enriched.powertrainKind, "other_hybrid");
  assert.equal(enriched.fuel, "hybrid");
  assert.equal(enriched.engineCc, 2487);
  assert.equal(enriched.powerHp, undefined);
  assert.equal(enriched.power30MinKw, undefined);
});

test("Prestige chassis knowledge requires exact source and photo identity", () => {
  const input = {
    sourceId: "prestige_japan_auctions_open",
    market: "japan",
    make: "Toyota",
    model: "Crown",
    powertrainKind: "combustion" as const,
    operational: { raw: { fields: { Make: "TOYOTA", Model: "CROWN SPORT", Chassis: "AZSH37W" } } },
  };
  assert.deepEqual(applyPrestigeJapanExactIdentityKnowledge(input), input);
});

test("K Car size class is dropped while exact Korean semantic fields are canonicalized", () => {
  const safe = canonicalizeSemanticSourceFields({ make: "Genesis", model: "G80", fuel: "가솔린", transmission: "자동", drive: "4륜", bodyType: "대형차" });
  assert.equal(safe.fuel, "petrol");
  assert.equal(safe.transmission, "automatic");
  assert.equal(safe.drive, "awd");
  assert.equal(safe.bodyType, undefined);
});

test("K Car SUV category remains a canonical SUV", () => {
  assert.equal(canonicalizeSemanticSourceFields({ bodyType: "SUV" }).bodyType, "suv");
});

test("pure EV cannot retain a leaked combustion displacement", () => {
  const safe = preferExplicitCombustionPowertrain({ make: "Hyundai", model: "Casper Electric", fuel: "전기", powertrainKind: "electric" as const, engineCc: 3000 });
  assert.equal(safe.fuel, "electric");
  assert.equal(safe.engineCc, undefined);
});

test("exact Kia K9 3342 cc and Korean AWD are preserved correctly", () => {
  const safe = preferExplicitCombustionPowertrain({ make: "Kia", model: "K9", trim: "3.3 GDI AWD", fuel: "가솔린", engineCc: 3342, drive: "4륜", bodyType: "대형차", powerHp: 370, powertrainKind: "combustion" as const });
  assert.equal(safe.engineCc, 3342);
  assert.equal(safe.drive, "awd");
  assert.equal(safe.bodyType, undefined);
  assert.equal(safe.powertrainKind, "combustion");
});

test("Mashina numeric model code cannot become estimated horsepower", () => {
  const normalized = normalizeVehicleOfferSpecs({
    sourceId: "mashina_kyrgyzstan_exact",
    make: "Dongfeng",
    model: "DFSK 500",
    trim: "Dongfeng DFSK 500",
    transmission: "CVT",
    powerHp: 500,
    powerKw: 367.75,
    powerDataConfidence: "estimated" as const,
    operational: { raw: { parsed: { title: "Dongfeng DFSK 500", engineCc: 1500 } } },
  });
  assert.equal(normalized.powerHp, undefined);
  assert.equal(normalized.powerKw, undefined);
});

test("engine model code T5L does not become five-litre displacement", () => {
  const normalized = enrichOfferWithExplicitEngineDisplacement({
    id: "dongfeng-t5l",
    sourceId: "mashina_kyrgyzstan_exact",
    sourceOfferId: "dongfeng-t5l",
    market: "kyrgyzstan",
    offerType: "fixed",
    status: "active",
    make: "Dongfeng",
    model: "T5L",
    trim: "1.6 AMT",
    year: 2026,
    sourcePrice: 13_500,
    sourceCurrency: "USD",
    priceMode: "fixed",
    images: [],
    totalRub: null,
    calculationStatus: "needs_data",
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    operational: { sourceUrl: "https://mashina.kg/details/dongfeng-t5l", sourceVenueName: "Mashina" },
  } as any);
  assert.equal(normalized.engineCc, 1600);
});
