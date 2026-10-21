import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { classifyCatalogV2Offer, selectCatalogV2MarketOffers } from "../apps/web/lib/catalog/catalog-v2-policy";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization";
import { strictSourceDetail } from "../apps/web/lib/catalog/strict-source-detail-wrapper";

const base = {
  id: "encar-1",
  market: "korea",
  sourceId: "encar",
  sourceUrl: "https://example.test/car/1",
  make: "Kia",
  model: "K5",
  year: 2023,
  powerHp: 160,
  sourcePrice: 25_000_000,
  sourceCurrency: "KRW",
  images: ["https://example.test/1.jpg"],
};

test("catalog rejects missing source price", () => {
  const result = classifyCatalogV2Offer({ ...base, sourcePrice: 0 } as any);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "source_price_missing");
});

test("catalog rejects request-only price text even when a placeholder number exists", () => {
  const result = classifyCatalogV2Offer({
    ...base,
    operational: { raw: { priceText: "가격 문의" } },
  } as any);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "price_on_request");
});

test("conflicting crossover default is removed for unambiguous sedan model", () => {
  const selection = selectCatalogV2MarketOffers([{ ...base, bodyType: "crossover" } as any], {
    priorityTarget: 0,
    maximumPerMarket: 10,
    priorityMaxAgeYears: 6,
    recentMaxAgeYears: 15,
    priorityMaxPowerHp: 160,
    priorityMaxTotalRub: 6_000_000,
    hardMaxTotalRub: 100_000_000,
  });
  assert.equal(selection.selected.length, 1);
  assert.equal(selection.selected[0].bodyType, undefined);
});

test("raw page noise cannot invent semantic vehicle attributes", () => {
  const result = normalizeVehicleOfferSpecs({
    ...base,
    operational: {
      raw: {
        navigation: "SUV AWD automatic hybrid crossover",
        recommendations: [{ bodyType: "SUV", drive: "4WD", fuel: "Hybrid", transmission: "Automatic" }],
        description: "Maximum 30-minute power: 68 kW",
      },
    },
  } as any);

  assert.equal(result.bodyType, undefined);
  assert.equal(result.drive, undefined);
  assert.equal(result.transmission, undefined);
  assert.equal(result.fuel, undefined);
  assert.equal(result.powertrainKind, "unknown");
  assert.equal(result.power30MinKw, 68);
});

test("explicit source semantic fields are normalized without model-name guessing", () => {
  const result = normalizeVehicleOfferSpecs({
    ...base,
    fuel: "Gasoline",
    transmission: "Automatic",
    drive: "Front-wheel drive",
    bodyType: "Sedan",
    operational: { raw: { recommendations: "SUV AWD hybrid" } },
  } as any);

  assert.equal(result.fuel, "petrol");
  assert.equal(result.transmission, "automatic");
  assert.equal(result.drive, "fwd");
  assert.equal(result.bodyType, "sedan");
  assert.equal(result.powertrainKind, "combustion");
});

test("source-specific listing-bound gallery adapters are never replaced by generic detail scraping", () => {
  const importer = fs.readFileSync("apps/web/lib/catalog/importer.ts", "utf8");
  const dedicatedBlock = importer.match(/const dedicatedDetailSourceIds = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  for (const sourceId of ["myauto_georgia_list", "dubicars_uae_exact"]) {
    assert.match(dedicatedBlock, new RegExp(`"${sourceId}"`), `${sourceId} must keep its source-specific fetchImages implementation`);
  }
});

function fakeImage(index: number) {
  return {
    id: `img-${index}`,
    url: `https://example.test/listing/image-${index}.jpg`,
    objectKey: "",
    checksum: `checksum-${index}`,
    size: 100_000,
    mimeType: "image/jpeg",
  };
}

function fakeOffer() {
  return {
    id: "generic-1",
    sourceId: "generic_source",
    sourceOfferId: "1",
    market: "china",
    offerType: "fixed",
    status: "active",
    make: "Test",
    model: "Car",
    year: 2025,
    sourcePrice: 100_000,
    sourceCurrency: "CNY",
    priceMode: "fixed",
    images: [],
    calculationStatus: "needs_data",
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    operational: {
      sourceUrl: "https://example.test/listing/1",
      raw: {
        recommendations: "SUV AWD automatic hybrid",
        images: Array.from({ length: 10 }, (_, index) => `https://example.test/recommendation-${index}.jpg`),
      },
    },
  } as any;
}

test("generic strict wrapper is fail-closed and never performs broad page scraping", async () => {
  const previousFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("network scrape must not happen");
  }) as typeof fetch;

  try {
    const adapter = strictSourceDetail({
      sourceId: "generic_source",
      market: "china",
      accessMode: "public_html",
      async fetchPage() { return { items: [], finished: true }; },
      normalizeOffer() { return null; },
      async fetchImages() { return Array.from({ length: 5 }, (_, index) => fakeImage(index)); },
      mapStatus() { return "active"; },
      async healthCheck() { return { ok: true, message: "ok", checkedAt: new Date().toISOString() }; },
    } as any);
    const offer = fakeOffer();
    const images = await adapter.fetchImages(offer);

    assert.equal(networkCalls, 0);
    assert.deepEqual(images, []);
    assert.equal(offer.bodyType, undefined);
    assert.equal(offer.drive, undefined);
    assert.equal(offer.transmission, undefined);
    assert.equal(offer.fuel, undefined);
    assert.equal(offer.operational.galleryVerified, false);
    assert.equal(offer.operational.gallerySafetyMode, "strict_source_adapter_identity_only");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("generic strict wrapper accepts only an adapter-proven exact-listing gallery", async () => {
  const adapter = strictSourceDetail({
    sourceId: "generic_source",
    market: "china",
    accessMode: "public_html",
    async fetchPage() { return { items: [], finished: true }; },
    normalizeOffer() { return null; },
    async fetchImages(offer: any) {
      offer.operational.photoIdentityVerified = true;
      offer.operational.raw.photoIdentityVerified = true;
      return Array.from({ length: 6 }, (_, index) => fakeImage(index));
    },
    mapStatus() { return "active"; },
    async healthCheck() { return { ok: true, message: "ok", checkedAt: new Date().toISOString() }; },
  } as any);
  const offer = fakeOffer();
  const images = await adapter.fetchImages(offer);

  assert.equal(images.length, 6);
  assert.equal(offer.operational.galleryVerified, true);
  assert.equal(offer.operational.galleryImageCount, 6);
  assert.equal(offer.operational.gallerySafetyMode, "strict_source_adapter_identity_only");
});
