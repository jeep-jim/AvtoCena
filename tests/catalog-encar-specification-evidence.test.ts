import assert from "node:assert/strict";
import test from "node:test";
import {
  extractEncarExactEngineCc,
  extractEncarExactPowerHp,
  mergeEncarCompleteDetail,
} from "../apps/web/lib/catalog/encar-complete-source";
import { catalogSemanticEvidenceRejectionReason } from "../apps/web/lib/catalog/offer-quality";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function offer(raw: Record<string, unknown> = {}): VehicleOffer {
  return {
    id: "encar:test",
    sourceId: "encar_direct",
    sourceOfferId: "test",
    market: "korea",
    offerType: "fixed",
    status: "active",
    make: "Hyundai",
    model: "Sonata",
    year: 2024,
    sourcePrice: 20_000_000,
    sourceCurrency: "KRW",
    priceMode: "fixed",
    images: [],
    totalRub: null,
    calculationStatus: "ready",
    firstSeenAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    operational: { raw },
  };
}

test("Encar metric evidence accepts one repeated exact source value", () => {
  assert.deepEqual(extractEncarExactEngineCc({ listing: { displacement: "1,998 cc" }, detail: { engineCc: 1998 } }), {
    value: 1998,
    rawValues: ["1,998 cc", "1998"],
    status: "exact",
  });
  assert.deepEqual(extractEncarExactPowerHp({ listing: { power: 150 }, detail: { horsePower: "150 PS" } }), {
    value: 150,
    rawValues: ["150", "150 PS"],
    status: "exact",
  });
});

test("Encar metric evidence converts explicit litres and kW only with units", () => {
  assert.equal(extractEncarExactEngineCc({ displacement: "1.998 L" }).value, 1998);
  assert.equal(extractEncarExactEngineCc({ engineVolume: 2.0 }).value, 2000);
  assert.equal(extractEncarExactEngineCc({ displacement: "2.0" }).status, "ambiguous");
  assert.equal(extractEncarExactPowerHp({ power: "110 kW" }).value, 149.6);
  assert.equal(extractEncarExactPowerHp({ powerHp: 150, powerKw: 110 }).status, "exact");
});

test("Encar metric evidence never chooses the first conflicting recursive value", () => {
  assert.equal(extractEncarExactEngineCc({ vehicle: { displacement: 1998 }, recommendation: { displacement: 2497 } }).status, "conflict");
  assert.equal(extractEncarExactPowerHp({ vehicle: { power: 150 }, recommendation: { power: 180 } }).status, "conflict");
  assert.equal(extractEncarExactEngineCc({ filters: { displacement: "1,500 - 1,999 cc" } }).status, "ambiguous");
});

test("Encar merge preserves exact keyed provenance for the audit", () => {
  const row = offer({ displacement: 1998, power: 150, FuelType: "Gasoline" });
  mergeEncarCompleteDetail(row, { vehicle: { displacement: "1,998 cc", power: "150 PS", fuelTypeName: "Gasoline" } });
  assert.equal(row.engineCc, 1998);
  assert.equal(row.powerHp, 150);
  assert.equal(row.powerDataConfidence, "source_exact");
  assert.equal((row.operational as any).semanticEvidence.fuel.status, "exact");
  assert.equal((row.operational as any).semanticEvidence.engineCc.status, "exact");
  assert.equal((row.operational as any).semanticEvidence.powerHp.status, "exact");
  assert.equal(catalogSemanticEvidenceRejectionReason(row), "");
});

test("Encar merge clears conflicting metrics and marks the offer fail-closed", () => {
  const row = offer({ displacement: 1998, power: 150, FuelType: "Gasoline" });
  mergeEncarCompleteDetail(row, { vehicle: { displacement: 2497, power: 180, fuelTypeName: "Gasoline" } });
  assert.equal(row.engineCc, undefined);
  assert.equal(row.powerHp, undefined);
  assert.equal(row.powerKw, undefined);
  assert.equal(row.powerDataConfidence, undefined);
  assert.equal(row.calculationStatus, "needs_data");
  assert.equal((row.operational as any).semanticEvidence.engineCc.status, "conflict");
  assert.equal((row.operational as any).semanticEvidence.powerHp.status, "conflict");
  assert.equal(catalogSemanticEvidenceRejectionReason(row), "semantic_engineCc_conflict");
});

test("Encar merge does not re-extract a retained range through generic normalization", () => {
  const row = offer({ displacement: "1,500 - 1,999 cc", FuelType: "Gasoline" });
  row.engineCc = 1999;
  mergeEncarCompleteDetail(row, { vehicle: { fuelTypeName: "Gasoline" } });
  assert.equal(row.engineCc, undefined);
  assert.equal((row.operational as any).semanticEvidence.engineCc.status, "ambiguous");
  assert.equal(catalogSemanticEvidenceRejectionReason(row), "semantic_engineCc_ambiguous");
});

test("Encar merge does not promote free text without a keyed source field", () => {
  const row = offer({ description: "Sonata 2.0 L 150 hp", FuelType: "Gasoline" });
  mergeEncarCompleteDetail(row, { vehicle: { fuelTypeName: "Gasoline" } });
  assert.equal(row.engineCc, undefined);
  assert.equal(row.powerHp, undefined);
  assert.equal((row.operational as any).semanticEvidence.engineCc.status, "missing");
  assert.equal((row.operational as any).semanticEvidence.powerHp.status, "missing");
  assert.equal(row.calculationStatus, "needs_data");
});
