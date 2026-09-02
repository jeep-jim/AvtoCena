import assert from "node:assert/strict";
import test from "node:test";
import { enrichOfferWithExplicitEngineDisplacement } from "../apps/web/lib/catalog/explicit-engine-displacement";
import { kcarKoreaExactSource, kcarSpecificationEvidence } from "../apps/web/lib/catalog/kcar-exact-source";
import { canonicalizeSemanticSourceFields, preferExplicitCombustionPowertrain } from "../apps/web/lib/catalog/powertrain-safety";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization";
import { applyPrestigeJapanExactIdentityKnowledge } from "../apps/web/lib/catalog/prestige-japan-identity-knowledge";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

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

test("stored exact Lexus UX250h resolver identity cannot be published as combustion", () => {
  const normalized = normalizeVehicleOfferSpecs({
    make: "Lexus",
    model: "UX 2.0 2WD",
    fuel: "petrol",
    engineCc: 1987,
    powertrainKind: "combustion" as const,
    powerHp: 152.3,
    powerKw: 112,
    icePowerKw: 112,
    utilizationPowerKw: 112,
    operational: {
      encyclopediaIdentity: {
        rawModel: "UX250h",
        modelSource: "presentation:safe_alias",
      },
    } as any,
  });
  assert.equal(normalized.powertrainKind, "other_hybrid");
  assert.equal(normalized.fuel, "hybrid");
  assert.equal(normalized.powerHp, undefined);
  assert.equal(normalized.powerKw, undefined);
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

test("K Car exact detail classifies fuel, displacement and horsepower provenance", () => {
  const evidence = kcarSpecificationEvidence({
    regModelYear: "2024",
    manufactureDate: "20240115",
    fuelName: "가솔린",
    rawFuelType: "001",
    engineDisplacement: "1,998",
    horsepower: "245",
  });
  assert.equal(evidence.year.status, "exact");
  assert.equal(evidence.fuel.value, "petrol");
  assert.equal(evidence.engineCc.value, 1998);
  assert.equal(evidence.powerHp.value, 245);
  assert.equal(evidence.powerKw.status, "missing");
});

test("K Car rejects conflicting years, ambiguous metrics and mismatched EV power units", () => {
  const evidence = kcarSpecificationEvidence({
    regModelYear: "2024",
    manufactureDate: "20230115",
    fuelName: "전기",
    rawFuelType: "001",
    engineDisplacement: "2.0",
    horsepower: "150-200",
  });
  assert.equal(evidence.year.status, "conflict");
  assert.equal(evidence.engineCc.status, "ambiguous");
  assert.equal(evidence.powerHp.status, "conflict");
  assert.equal(evidence.powerKw.status, "conflict");
});

test("K Car pure EV keeps kW as peak power and flags nonzero displacement", () => {
  const evidence = kcarSpecificationEvidence({
    regModelYear: 2025,
    manufactureDate: "20250101",
    fuelName: "전기",
    rawFuelType: "009",
    engineDisplacement: 1998,
    horsepower: 150,
  });
  assert.equal(evidence.fuel.value, "electric");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.powerHp.status, "missing");
  assert.equal(evidence.powerKw.status, "exact");
  assert.equal(evidence.powerKw.value, 150);
});

test("K Car normalized offer exposes exact source evidence to the shared audit", () => {
  const evidence = kcarSpecificationEvidence({
    regModelYear: 2024,
    manufactureDate: "20240115",
    fuelName: "가솔린",
    rawFuelType: "001",
    engineDisplacement: 1998,
    horsepower: 245,
  });
  const offer = kcarKoreaExactSource.normalizeOffer({
    id: "EC12345678",
    url: "https://www.kcar.com/bc/detail/carInfoDtl?i_sCarCd=EC12345678",
    title: "기아 K5 노블레스",
    make: "기아",
    model: "K5",
    trim: "노블레스",
    year: 2024,
    engineCc: 1998,
    powerHp: 245,
    fuel: "petrol",
    transmission: "자동",
    drive: "2WD",
    bodyType: "세단",
    sourcePrice: 30_000_000,
    sourceCurrency: "KRW",
    images: Array.from({ length: 5 }, (_, index) => `https://img.kcar.com/3dcarpicture/2026/01/001/12345678_1/main/${index}.jpg`),
    rawFuelType: "001",
    rawStatus: "판매중",
    semanticEvidence: evidence,
  });
  assert.ok(offer);
  assert.equal(classifySpecificationEvidence(offer!, "fuelPowertrain").state, "exact");
  assert.equal(classifySpecificationEvidence(offer!, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer!, "powerHp").state, "exact");
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

test("engine model code T5L does not become five-litre displacement", () => {
  const normalized = enrichOfferWithExplicitEngineDisplacement({
    id: "dongfeng-t5l",
    sourceId: "autohome_used_china_open",
    sourceOfferId: "dongfeng-t5l",
    market: "china",
    offerType: "fixed",
    status: "active",
    make: "Dongfeng",
    model: "T5L",
    trim: "1.6 AMT",
    year: 2026,
    sourcePrice: 13_500,
    sourceCurrency: "CNY",
    priceMode: "fixed",
    images: [],
    totalRub: null,
    calculationStatus: "needs_data",
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    operational: { sourceUrl: "https://www.che168.com/dealer/dongfeng-t5l", sourceVenueName: "Che168" },
  } as any);
  assert.equal(normalized.engineCc, 1600);
});
