import assert from "node:assert/strict";
import test from "node:test";
import { auditCrossSourceVehicleCoincidences } from "../apps/web/lib/catalog/cross-source-coincidence-audit";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function offer(overrides: Partial<VehicleOffer> & Pick<VehicleOffer, "id" | "sourceId" | "sourceOfferId">): VehicleOffer {
  return {
    id: overrides.id,
    sourceId: overrides.sourceId,
    sourceOfferId: overrides.sourceOfferId,
    market: "korea",
    offerType: "fixed",
    status: "active",
    make: "Hyundai",
    model: "Avante",
    year: 2023,
    productionDate: "2023-03-01",
    mileageKm: 25_000,
    engineCc: 1_598,
    sourcePrice: 20_000_000,
    sourceCurrency: "KRW",
    priceMode: "fixed",
    images: [],
    calculationStatus: "needs_data",
    firstSeenAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    operational: {
      sourceUrl: `https://example.test/${overrides.sourceId}/${overrides.sourceOfferId}`,
      detailIdentityVerified: true,
      fieldIdentityVerified: true,
      photoIdentityVerified: true,
      sourceExactFields: ["productionDate", "mileageKm", "engineCc"],
      semanticEvidence: { engineCc: { status: "exact" }, mileageKm: { status: "exact" } },
      raw: {},
    },
    ...overrides,
  } as VehicleOffer;
}

const checksum = (letter: string) => letter.repeat(64);
const image = (value: string) => ({ id: "", url: `https://images.test/${value}.jpg`, objectKey: "", checksum: value, size: 20_000, mimeType: "image/jpeg" });

test("audit is non-mutating and does not confirm ordinary similar listings", () => {
  const rows = [
    offer({ id: "a", sourceId: "carswitch_uae_open", sourceOfferId: "1", market: "uae", make: "Toyota", model: "Camry", year: 2023 }),
    offer({ id: "b", sourceId: "dubicars_uae_exact", sourceOfferId: "2", market: "uae", make: "Toyota", model: "Camry", year: 2023 }),
  ];
  const before = structuredClone(rows);
  const report = auditCrossSourceVehicleCoincidences(rows);

  assert.deepEqual(rows, before);
  assert.equal(report.auditOnly, true);
  assert.equal(report.totals.confirmed, 0);
  assert.equal(report.totals.suspected, 1);
  assert.equal(report.suspected[0].reason, "exact_vehicle_facts_only");
  assert.equal("rows" in report || "removed" in report || "heldIds" in report, false);
});

test("synthetic and unattested hard identifiers never confirm a coincidence", () => {
  const synthetic = offer({
    id: "carswitch", sourceId: "carswitch_uae_open", sourceOfferId: "873743", market: "uae",
    operational: {
      sourceUrl: "https://carswitch.test/873743", exactDetail: true, exactFields: true,
      raw: { detailIdentityVerified: true, vehicleIdentificationNumber: "BUYFROMCS00873743" },
    },
  });
  const unattested = offer({ id: "dubicars", sourceId: "dubicars_uae_exact", sourceOfferId: "22", market: "uae", vin: "KMHDU41DB8U123456",
    operational: { sourceUrl: "https://dubicars.test/22", raw: {} } });
  const report = auditCrossSourceVehicleCoincidences([synthetic, unattested]);

  assert.equal(report.totals.confirmed, 0);
  assert.ok(report.identityAnomalies.some((row) => row.type === "invalid_hard_identifier" && row.reason === "placeholder"));
  assert.ok(report.identityAnomalies.some((row) => row.type === "unattested_hard_identifier"));
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /BUYFROMCS00873743|KMHDU41DB8U123456/);
});

test("saved-market style rows with URL-only galleries report zero safe confirmations", () => {
  const sourceUrlImage = (url: string) => ({ id: "", url, objectKey: "", checksum: "", size: 0, mimeType: "image/jpeg" });
  const report = auditCrossSourceVehicleCoincidences([
    offer({ id: "uae-carswitch", sourceId: "carswitch_uae_open", sourceOfferId: "873743", market: "uae", make: "Toyota", model: "Camry",
      images: [sourceUrlImage("https://carswitch-cdn.test/car-1.jpg")], operational: { sourceUrl: "https://carswitch.test/873743", raw: { listingBoundImages: true } } }),
    offer({ id: "uae-dubicars", sourceId: "dubicars_uae_exact", sourceOfferId: "101", market: "uae", make: "Toyota", model: "Camry",
      images: [sourceUrlImage("https://dubicars-cdn.test/car-1.jpg")], operational: { sourceUrl: "https://dubicars.test/101", raw: { listingBoundImages: true } } }),
    offer({ id: "georgia-autopapa", sourceId: "autopapa_georgia_open", sourceOfferId: "201", market: "georgia", make: "BMW", model: "X5",
      images: [sourceUrlImage("https://autopapa.test/car-2.jpg")], operational: { sourceUrl: "https://autopapa.test/201", raw: { listingBoundImages: true } } }),
    offer({ id: "georgia-myauto", sourceId: "myauto_georgia_list", sourceOfferId: "301", market: "georgia", make: "BMW", model: "X5",
      images: [sourceUrlImage("https://myauto.test/car-2.jpg")], operational: { sourceUrl: "https://myauto.test/301", raw: { listingBoundImages: true } } }),
    offer({ id: "korea-kcar", sourceId: "kcar_korea_open", sourceOfferId: "401", market: "korea", vin: "KMHDU41DB8U123456" }),
  ]);

  assert.equal(report.totals.confirmed, 0);
  assert.equal(report.confirmed.length, 0);
  assert.ok(report.insufficientEvidenceOffers >= 4);
});

test("unique source-bound VIN plus an exact corroborator is confirmed without exposing VIN", () => {
  const vin = "KMHDU41DB8U123456";
  const rows = [
    offer({ id: "kcar", sourceId: "kcar_korea_open", sourceOfferId: "K1", vin }),
    offer({ id: "encar", sourceId: "encar_direct", sourceOfferId: "E1", vin }),
  ];
  const report = auditCrossSourceVehicleCoincidences(rows);

  assert.equal(report.totals.confirmed, 1);
  assert.deepEqual(report.confirmed[0].corroborators, ["engine_cc", "mileage", "production_month"]);
  assert.equal(report.confirmed[0].hardIdentifiers[0].kind, "vin");
  assert.match(report.confirmed[0].hardIdentifiers[0].hash, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(vin));
});

test("a hard identifier reused inside one source is quarantined from matching", () => {
  const vin = "KMHR381ABPU498929";
  const rows = [
    offer({ id: "kcar-a", sourceId: "kcar_korea_open", sourceOfferId: "K1", vin, mileageKm: 38_345 }),
    offer({ id: "kcar-b", sourceId: "kcar_korea_open", sourceOfferId: "K2", vin, mileageKm: 55_899 }),
    offer({ id: "encar-a", sourceId: "encar_direct", sourceOfferId: "E1", vin, mileageKm: 38_345 }),
  ];
  const report = auditCrossSourceVehicleCoincidences(rows);

  assert.equal(report.totals.confirmed, 0);
  const anomaly = report.identityAnomalies.find((row) => row.type === "source_nonunique_hard_identifier");
  assert.deepEqual(anomaly?.offerIds, ["kcar-a", "kcar-b"]);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(vin));
});

test("matching hard identifier with contradictory exact identity is a conflict, not a match", () => {
  const vin = "KMHDU41DB8U123456";
  const report = auditCrossSourceVehicleCoincidences([
    offer({ id: "a", sourceId: "kcar_korea_open", sourceOfferId: "K1", vin }),
    offer({ id: "b", sourceId: "encar_direct", sourceOfferId: "E1", vin, model: "Sonata", engineCc: 1_998 }),
  ]);

  assert.equal(report.totals.confirmed, 0);
  assert.equal(report.totals.conflicts, 1);
  assert.deepEqual(report.conflicts[0].conflicts, ["canonical_identity_mismatch", "engine_cc_mismatch"]);
});

test("two unique verified binary images require exact physical corroboration", () => {
  const shared = [image(checksum("a")), image(checksum("b"))];
  const report = auditCrossSourceVehicleCoincidences([
    offer({ id: "autopapa", sourceId: "autopapa_georgia_open", sourceOfferId: "A1", market: "georgia", images: shared }),
    offer({ id: "myauto", sourceId: "myauto_georgia_list", sourceOfferId: "M1", market: "georgia", images: shared }),
  ]);

  assert.equal(report.totals.confirmed, 1);
  assert.deepEqual(report.confirmed[0].sharedImageChecksums, [checksum("a"), checksum("b")]);
  assert.ok(report.confirmed[0].corroborators.includes("engine_cc"));
  assert.ok(report.confirmed[0].corroborators.includes("mileage"));
});

test("one shared image is report-only and stock-image reuse inside a source is quarantined", () => {
  const shared = [image(checksum("c"))];
  const report = auditCrossSourceVehicleCoincidences([
    offer({ id: "source-a-1", sourceId: "source-a", sourceOfferId: "A1", images: shared }),
    offer({ id: "source-a-2", sourceId: "source-a", sourceOfferId: "A2", images: shared, mileageKm: 70_000 }),
    offer({ id: "source-b", sourceId: "source-b", sourceOfferId: "B1", images: shared }),
  ]);

  assert.equal(report.totals.confirmed, 0);
  assert.ok(report.identityAnomalies.some((row) => row.type === "source_nonunique_image_checksum"));
});

test("report ordering and evidence hashes are deterministic", () => {
  const vin = "KMHDU41DB8U123456";
  const rows = [
    offer({ id: "a", sourceId: "kcar_korea_open", sourceOfferId: "K1", vin }),
    offer({ id: "b", sourceId: "encar_direct", sourceOfferId: "E1", vin }),
  ];
  assert.deepEqual(auditCrossSourceVehicleCoincidences(rows), auditCrossSourceVehicleCoincidences([...rows].reverse()));
});
