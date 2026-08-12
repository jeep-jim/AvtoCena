import assert from "node:assert/strict";
import test from "node:test";
import { hasCredibleOfferContent } from "../apps/web/lib/catalog/offer-quality";

function images(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `image-${index}`,
    url: `https://autopapa.ge/system/car/photos/009/001/${String(index + 1).padStart(3, "0")}/original.jpg`,
    checksum: `checksum-${index}`,
    width: 1200,
    height: 800,
    size: 150_000,
    mimeType: "image/jpeg",
  }));
}

function georgiaOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: "offer-test",
    sourceId: "autopapa_georgia_open",
    sourceOfferId: "999999",
    market: "georgia",
    offerType: "fixed",
    status: "active",
    make: "Honda",
    model: "Civic",
    trim: "Honda Civic",
    year: 2026,
    mileageKm: 30_000,
    engineCc: 2000,
    fuel: "petrol",
    sourcePrice: 20_000,
    sourceCurrency: "USD",
    images: images(5),
    operational: {
      sourceUrl: "https://autopapa.ge/en/usd/honda/civic/999999",
      raw: { listingBoundImages: true },
    },
    ...overrides,
  } as any;
}

test("Georgia server quality gate requires at least five credible listing-bound photos", () => {
  assert.equal(hasCredibleOfferContent(georgiaOffer({ images: images(5) })), true);
  assert.equal(hasCredibleOfferContent(georgiaOffer({ images: images(4) })), false);
});

test("Georgia quality gate rejects personal watercraft even when the source labels it like a car", () => {
  assert.equal(hasCredibleOfferContent(georgiaOffer({
    make: "Yamaha",
    model: "Super Jet",
    trim: "Yamaha Super Jet",
    bodyType: undefined,
  })), false);
});
