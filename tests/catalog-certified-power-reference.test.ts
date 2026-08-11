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
  assert.equal(certifiedPowerReferenceMatches(reference, {
    make: "Kia",
    model: "EV6 Long Range",
    trim: "4WD GT Line",
    drive: "AWD",
    year: 2022,
    powertrainKind: "electric",
  }), true);
});

test("certified power reference rejects another powertrain, drive or peak-power variant", () => {
  const base = { make: "Kia", model: "EV6", trim: "GT Line", drive: "AWD", year: 2022, powertrainKind: "electric" as const, powerKw: 239 };
  assert.equal(certifiedPowerReferenceMatches(reference, { ...base, powertrainKind: "other_hybrid" }), false);
  assert.equal(certifiedPowerReferenceMatches(reference, { ...base, drive: "RWD" }), false);
  assert.equal(certifiedPowerReferenceMatches(reference, { ...base, powerKw: 168 }), false);
});

test("certified power reference canonicalizes Korean make, model, trim and drive text", () => {
  const koreanReference: CertifiedPowerReference = {
    id: "hyundai-ioniq5-facelift-awd-2025",
    make: "Hyundai",
    model: "Ioniq5",
    rawModelContains: ["더 뉴"],
    trimContains: ["롱레인지"],
    driveContains: ["awd"],
    yearFrom: 2025,
    yearTo: 2026,
    powertrainKind: "electric",
    power30MinKw: 81,
    utilizationPowerKw: 81,
    sourceDocumentType: "KBA_registration_data",
    sourceDocumentId: "KBA:8252/ALA",
    verifiedAt: "2026-08-11T00:00:00.000Z",
    verifiedBy: "test",
  };

  assert.equal(certifiedPowerReferenceMatches(koreanReference, {
    make: "현대",
    model: "더 뉴 아이오닉5",
    trim: "롱레인지 AWD 프레스티지",
    year: 2025,
    powertrainKind: "electric",
  }), true);
  assert.equal(certifiedPowerReferenceMatches(koreanReference, {
    make: "현대",
    model: "아이오닉5",
    trim: "롱레인지 2WD 프레스티지",
    year: 2025,
    powertrainKind: "electric",
  }), false);
});

test("raw model qualifier prevents a newer Niro reference from matching the old generation", () => {
  const niroReference: CertifiedPowerReference = {
    id: "kia-niro-ev-sg2",
    make: "Kia",
    model: "Niro EV",
    rawModelContains: ["디 올 뉴"],
    yearFrom: 2023,
    yearTo: 2025,
    powertrainKind: "electric",
    power30MinKw: 50,
    utilizationPowerKw: 50,
    sourceDocumentType: "KBA_registration_data",
    sourceDocumentId: "KBA:2233/ABP",
    verifiedAt: "2026-08-11T00:00:00.000Z",
    verifiedBy: "test",
  };

  assert.equal(certifiedPowerReferenceMatches(niroReference, {
    make: "기아", model: "디 올 뉴 니로 EV", year: 2024, powertrainKind: "electric",
  }), true);
  assert.equal(certifiedPowerReferenceMatches(niroReference, {
    make: "기아", model: "니로 EV", year: 2023, powertrainKind: "electric",
  }), false);
});

test("Casper Electric Inspiration matches the documented European Inster homologation", () => {
  const casperReference: CertifiedPowerReference = {
    id: "hyundai-casper-electric-inster-49kwh",
    make: "Hyundai",
    model: "Casper",
    modelAliases: ["Casper Electric"],
    rawModelContains: ["캐스퍼"],
    trimContains: ["인스퍼레이션"],
    yearFrom: 2024,
    yearTo: 2026,
    powertrainKind: "electric",
    peakPowerKw: 85,
    peakPowerToleranceKw: 1,
    power30MinKw: 28,
    utilizationPowerKw: 28,
    sourceDocumentType: "KBA_registration_data",
    sourceDocumentId: "KBA:8252/AMA",
    verifiedAt: "2026-08-11T00:00:00.000Z",
    verifiedBy: "test",
  };

  assert.equal(certifiedPowerReferenceMatches(casperReference, {
    make: "현대", model: "캐스퍼 일렉트릭", trim: "인스퍼레이션", year: 2025, powertrainKind: "electric",
  }), true);
  assert.equal(certifiedPowerReferenceMatches(casperReference, {
    make: "현대", model: "캐스퍼", trim: "인스퍼레이션", year: 2025, powertrainKind: "electric", powerKw: 84.5,
  }), true);
  assert.equal(certifiedPowerReferenceMatches(casperReference, {
    make: "현대", model: "캐스퍼", trim: "인스퍼레이션", year: 2025, powertrainKind: "electric", powerKw: 71,
  }), false);
});
