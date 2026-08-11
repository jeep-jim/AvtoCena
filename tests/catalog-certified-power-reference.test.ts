import assert from "node:assert/strict";
import test from "node:test";
import {
  certifiedPowerReferenceMatches,
  type CertifiedPowerReference,
} from "../apps/web/lib/catalog/power-reference";

const reference: CertifiedPowerReference = {
  id: "kia-ev6-awd-2022",
  make: "Kia",
  model: "EV6",
  modelAliases: ["EV6 Long Range"],
  trimContains: ["GT Line"],
  driveContains: ["AWD"],
  yearFrom: 2022,
  yearTo: 2023,
  powertrainKind: "electric",
  peakPowerKw: 239,
  peakPowerToleranceKw: 1,
  power30MinKw: 107.6,
  sourceDocumentType: "OTTS",
  sourceDocumentId: "TEST-DOCUMENT-ID",
  verifiedAt: "2026-08-11T00:00:00.000Z",
  verifiedBy: "test",
};

test("certified power reference accepts an exact documented variant and explicit model alias", () => {
  assert.equal(certifiedPowerReferenceMatches(reference, {
    make: "KIA",
    model: "EV6 Long Range",
    trim: "4WD GT Line",
    drive: "AWD",
    year: 2022,
    powertrainKind: "electric",
    powerKw: 239.4,
  }), true);
});

test("certified power reference rejects another powertrain, drive or peak-power variant", () => {
  const base = { make: "Kia", model: "EV6", trim: "GT Line", drive: "AWD", year: 2022, powertrainKind: "electric" as const, powerKw: 239 };
  assert.equal(certifiedPowerReferenceMatches(reference, { ...base, powertrainKind: "other_hybrid" }), false);
  assert.equal(certifiedPowerReferenceMatches(reference, { ...base, drive: "RWD" }), false);
  assert.equal(certifiedPowerReferenceMatches(reference, { ...base, powerKw: 168 }), false);
});
