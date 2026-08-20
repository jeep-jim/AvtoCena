import assert from "node:assert/strict";
import test from "node:test";
import { deduplicatePublicCatalogOffers } from "../apps/web/lib/catalog/public-offer-deduplication";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

function offer(overrides: Partial<VehicleOffer> & Pick<VehicleOffer, "id" | "sourceOfferId">): VehicleOffer {
  return {
    id: overrides.id,
    sourceId: "encar_direct",
    sourceOfferId: overrides.sourceOfferId,
    market: "korea",
    offerType: "fixed",
    status: "active",
    make: "KGM",
    model: "Rexton",
    trim: "дизель 2.2 4WD",
    year: 2021,
    mileageKm: 50_529,
    engineCc: 2_157,
    sourcePrice: 2_300_000,
    sourceCurrency: "KRW",
    priceMode: "fixed",
    images: [{
      id: "",
      url: "https://ci.encar.com/carpicture/carpicture03/pic4193/41935962_001.jpg",
      objectKey: "",
      checksum: "",
      size: 0,
      mimeType: "image/jpeg",
    }],
    totalRub: 2_810_884,
    calculationStatus: "ready",
    firstSeenAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    operational: {
      sourceUrl: `https://fem.encar.com/cars/detail/${overrides.sourceOfferId}`,
      galleryVerified: true,
      raw: { Photo: "/carpicture/carpicture03/pic4193/41935962_001.jpg" },
    },
    ...overrides,
    publicVisibleRub: 2_810_884,
  } as VehicleOffer;
}

test("different Encar ids with one exact gallery and commercial identity become one public card", () => {
  const correct = offer({ id: "offer-correct", sourceOfferId: "41935962" });
  const copiedGallery = offer({ id: "offer-copy", sourceOfferId: "41940870", updatedAt: "2026-08-20T01:00:00.000Z" });
  const result = deduplicatePublicCatalogOffers([copiedGallery, correct]);

  assert.deepEqual(result.rows.map((row) => row.id), [correct.id]);
  assert.deepEqual(result.removed.map((row) => [row.keptId, row.removedId]), [[correct.id, copiedGallery.id]]);
});

test("same stock photo does not collapse vehicles with different commercial identity", () => {
  const base = offer({ id: "offer-a", sourceOfferId: "41935962" });
  const differentMileage = offer({ id: "offer-b", sourceOfferId: "41940870", mileageKm: 60_000 });
  const differentPrice = offer({ id: "offer-c", sourceOfferId: "41940900", sourcePrice: 2_400_000 });
  const result = deduplicatePublicCatalogOffers([base, differentMileage, differentPrice]);

  assert.equal(result.rows.length, 3);
  assert.equal(result.removed.length, 0);
});
