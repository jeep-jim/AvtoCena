import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { classifyCatalogV2Offer, selectCatalogV2MarketOffers } from "../apps/web/lib/catalog/catalog-v2-policy";
import { MashinaKyrgyzstanListAdapter, mashinaSourceGallery, parseMashinaDetailSpecs, parseMashinaExplicitPowerHp, parseMashinaListingMarkup } from "../apps/web/lib/catalog/mashina-kyrgyzstan-list-source";
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
  for (const sourceId of ["myauto_georgia_list", "dubicars_uae_exact", "mashina_kyrgyzstan_exact"]) {
    assert.match(dedicatedBlock, new RegExp(`"${sourceId}"`), `${sourceId} must keep its source-specific fetchImages implementation`);
  }
});

test("Mashina keeps exact listing-bound galleries as source URLs without binary recaching", () => {
  const gallery = mashinaSourceGallery([
    "https://storage.mashina.kg/catalog/images/a_small.jpg",
    "https://storage.mashina.kg/catalog/images/a_large.jpg",
    "https://storage.mashina.kg/catalog/images/b_large.jpg",
    "https://storage.mashina.kg/catalog/images/c_large.jpg",
    "https://storage.mashina.kg/catalog/images/d_large.jpg",
    "https://storage.mashina.kg/catalog/images/e_large.jpg",
  ], 30);
  assert.equal(gallery.length, 5);
  assert.equal(gallery[0].url, "https://storage.mashina.kg/catalog/images/a_large.jpg");
  assert.equal(gallery.every((image) => image.objectKey === "" && image.size === 0), true);
  assert.equal(gallery.every((image) => /^https:\/\/storage\.mashina\.kg\//.test(image.url)), true);
});

test("Mashina uses the shared brand directory so Wuling MINI EV is not misclassified as MINI", () => {
  const markup = `
    <article>
      <a href="/details/wuling-mini-ev-6a7703d69dfe2c8c52bcede8">
        <img src="https://storage.mashina.kg/catalog/images/wuling-mini_large.jpg" />
        Wuling MINI EV 2026 $8,400 Electric Automatic 12,000 km
      </a>
    </article>`;
  const rows = parseMashinaListingMarkup(markup, "https://mashina.kg/en/search/?page=1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].make, "Wuling");
  assert.match(rows[0].model, /^MINI EV/);
});

test("Mashina source URL identity wins over short dealer brand noise", () => {
  const markup = `
    <article>
      <a href="/details/lotus-eletre-6a6c4cb466c1fe88563bc6c4">
        <img src="https://storage.mashina.kg/catalog/images/lotus-eletre_large.jpg" />
        AC CARS В наличии 1 ч назад Lotus Eletre 2025 $66,800 Electric Automatic 14,000 km
      </a>
    </article>`;
  const rows = parseMashinaListingMarkup(markup, "https://mashina.kg/en/search/?page=1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].make, "Lotus");
  assert.match(rows[0].model, /^Eletre/);
  assert.notEqual(rows[0].make, "AC");
});

test("Mashina rejects pre-2020 rows at the source adapter boundary", () => {
  const adapter = new MashinaKyrgyzstanListAdapter();
  assert.equal(adapter.normalizeOffer({
    id: "old-row",
    detailUrl: "https://mashina.kg/details/toyota-camry-old-row",
    title: "Toyota Camry",
    make: "Toyota",
    model: "Camry",
    year: 2019,
    price: 15_000,
    currency: "USD",
    images: ["https://storage.mashina.kg/catalog/images/old-row_large.jpg"],
  }), null);
});

function mashinaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "toyota-corolla-1",
    detailUrl: "https://www.mashina.kg/details/toyota-corolla-6a7703d69dfe2c8c52bcede8",
    title: "Toyota Corolla",
    make: "Toyota",
    model: "Corolla",
    year: 2026,
    price: 20_000,
    currency: "USD" as const,
    images: Array.from({ length: 5 }, (_, index) => `https://storage.mashina.kg/catalog/images/corolla-${index}_large.jpg`),
    ...overrides,
  };
}

test("Mashina fetches identity-bound details for missing specs even when five listing photos already exist", async () => {
  const previousFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    return new Response(`
      <html><title>Toyota Corolla 2026</title>
      <dl><dt>Engine capacity</dt><dd>1.5 L</dd><dt>Fuel</dt><dd>Gasoline</dd>
      <dt>Transmission</dt><dd>Automatic</dd><dt>Power</dt><dd>115 л.с.</dd></dl></html>
    `, { status: 200 });
  }) as typeof fetch;

  try {
    const adapter = new MashinaKyrgyzstanListAdapter();
    const offer = adapter.normalizeOffer(mashinaRow())!;
    const gallery = await adapter.fetchImages(offer);
    assert.equal(networkCalls, 1);
    assert.equal(gallery.length, 5);
    assert.equal(offer.engineCc, 1_500);
    assert.equal(offer.powerHp, 115);
    assert.equal(offer.fuel, "Gasoline");
    assert.equal(offer.transmission, "Automatic");
    assert.equal(offer.powerDataConfidence, "source_exact");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Mashina never treats a model number as horsepower", () => {
  assert.equal(parseMashinaExplicitPowerHp("Dongfeng DFSK 500 2025 Automatic"), undefined);
  assert.equal(parseMashinaExplicitPowerHp("Engine power: 115 л.с."), 115);
});

test("Mashina keeps peak and 30-minute electric power separate", () => {
  const specs = parseMashinaDetailSpecs("Toyota bZ4X Power 150 kW Maximum 30-minute power 65 kW Fuel Electric");
  assert.equal(specs.powerKw, 150);
  assert.equal(specs.power30MinKw, 65);
  assert.equal(specs.fuel, "Electric");
});

test("Mashina rejects detail enrichment when the page belongs to another vehicle", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("<html><title>Honda Civic</title> Power 180 HP Fuel Gasoline</html>", { status: 200 })) as typeof fetch;

  try {
    const adapter = new MashinaKyrgyzstanListAdapter();
    const offer = adapter.normalizeOffer(mashinaRow())!;
    const gallery = await adapter.fetchImages(offer);
    assert.equal(gallery.length, 5);
    assert.equal(offer.powerHp, undefined);
    assert.equal(offer.fuel, undefined);
    assert.notEqual((offer.operational.raw as any).detailIdentityVerified, true);
  } finally {
    globalThis.fetch = previousFetch;
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
