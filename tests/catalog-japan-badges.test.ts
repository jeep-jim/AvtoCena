import assert from "node:assert/strict";
import test from "node:test";
import { assessJapanExportRestriction, auctionGradeLabel } from "../apps/web/lib/catalog/japan-export-restriction";
import { offerSpecificationGroups } from "../apps/web/lib/catalog/offer-specification-groups";
import { publicOffer, searchProjectionFromOffer } from "../apps/web/lib/catalog/storage";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

const vehicle = (extra: Partial<VehicleOffer> = {}): VehicleOffer => ({
  id: "fixture:1", sourceId: "fixture", sourceOfferId: "1", market: "japan", make: "Toyota", model: "Example", year: 2024,
  status: "active", offerType: "auction", sourcePrice: 100000, sourceCurrency: "JPY", priceMode: "fixed", calculationStatus: "needs_data", images: [],
  firstSeenAt: "2026-09-08", updatedAt: "2026-09-08", fuel: "petrol", powertrainKind: "combustion", engineCc: 1997, auctionGrade: "3.5",
  operational: { semanticEvidence: { fuel: { status: "exact", value: extra.fuel || "petrol" }, engineCc: { status: "exact", value: extra.engineCc === undefined && extra.powertrainKind !== "electric" ? 1997 : extra.engineCc } } }, ...extra,
});

test("export technical restriction uses exact evidence and strict 1900cc boundary", () => {
  assert.equal(assessJapanExportRestriction(vehicle())?.reason, "engine_over_1900cc");
  assert.equal(assessJapanExportRestriction(vehicle({ engineCc: 1900 })), undefined);
  assert.equal(assessJapanExportRestriction(vehicle({ engineCc: 1899 })), undefined);
  assert.equal(assessJapanExportRestriction(vehicle({ market: "korea" })), undefined);
  assert.equal(assessJapanExportRestriction(vehicle({ vehicleCategory: "N1" })), undefined);
  const stale = vehicle(); stale.engineCc = 2500;
  assert.equal(assessJapanExportRestriction(stale), undefined);
  assert.equal(assessJapanExportRestriction(vehicle({ operational: {} })), undefined);
  assert.equal(assessJapanExportRestriction(vehicle({ operational: { semanticEvidence: { fuel: { status: "exact" }, engineCc: { status: "conflict" } } } })), undefined);
});

test("confirmed electric/hybrid restrictions do not depend on horsepower or engine size", () => {
  assert.equal(assessJapanExportRestriction(vehicle({ fuel: "electric", powertrainKind: "electric", engineCc: undefined }))?.reason, "electric");
  assert.equal(assessJapanExportRestriction(vehicle({ fuel: "hybrid", powertrainKind: "series_hybrid", engineCc: 660, powerHp: 64 }))?.reason, "hybrid");
  assert.equal(assessJapanExportRestriction(vehicle({ fuel: "petrol", powertrainKind: "electric" })), undefined);
  assert.equal(assessJapanExportRestriction(vehicle({ engineCc: 1600, powerHp: 300 })), undefined);
});

test("grade stays a source value; missing or invalid grades are never invented", () => {
  for (const grade of ["R", "RA", "S", "***", "3.5", "4", "4.5"]) assert.equal(auctionGradeLabel(grade), grade);
  assert.equal(auctionGradeLabel("3,5"), "3.5");
  for (const grade of [null, "", "unknown", {}, "150", "<script>"]) assert.equal(auctionGradeLabel(grade), undefined);
});

test("card projection and public DTO retain badges without operational payload", () => {
  const offer = vehicle();
  const dto = publicOffer(offer);
  const row = searchProjectionFromOffer(offer);
  assert.equal(dto.auctionGrade, "3.5");
  assert.deepEqual(row.japanExportRestriction, dto.japanExportRestriction);
  assert.equal(dto.japanExportRestriction?.status, "restricted");
  assert.equal("operational" in dto, false);
});

test("all specifications are listing-bound and exclude inferred/manual power and raw secrets", () => {
  const offer = vehicle({ powerHp: 150, operational: { raw: { password: "PRIVATE", vin: "PRIVATE" }, sourceSpecifications: {
    version: 1, sourceId: "fixture", sourceOfferId: "1", specificationId: "spec", sourceUrl: "https://example.org/1", capturedAt: "2026-09-08",
    groups: [{ name: "Equipment", items: [{ name: "Seats", value: "0" }, { name: "Option", value: "-" }, { name: "VIN", value: "PRIVATE" }] }],
  } } });
  const groups = offerSpecificationGroups(offer);
  assert.ok(groups.some(group => group.name === "Equipment"));
  assert.equal(JSON.stringify(groups).includes("PRIVATE"), false);
  assert.equal(groups.flatMap(group => group.items).some(item => item.name === "Мощность, л.с."), false);
  offer.operational.sourceSpecifications!.sourceOfferId = "another-listing";
  assert.equal(offerSpecificationGroups(offer).some(group => group.name === "Equipment"), false);
});
