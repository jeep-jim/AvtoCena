import test from "node:test";
import assert from "node:assert/strict";
import { credibleCatalogImages, isCatalogOfferBusinessLiquid, isCrediblePublicOffer } from "../apps/web/lib/catalog/offer-quality";
import { isLikelyVehicleImage, rankedCatalogImageUrls } from "../apps/web/lib/catalog/image-quality";
import { coherentGoonetImages, goonetPrimaryImageUrl } from "../apps/web/lib/catalog/goonet-exact-source";

const jpegPhoto = {
  id: "photo",
  url: "https://img.avtocena.com/catalog/images/korea/photo.jpg",
  objectKey: "catalog/images/korea/photo.jpg",
  width: 1280,
  height: 853,
  size: 240_000,
  checksum: "photo-checksum",
  mimeType: "image/jpeg",
};

const sourcePhoto = (index: number) => ({
  id: `source-photo-${index}`,
  url: `https://car-photo-source.example/listing-100/photo-${index}.jpg`,
  objectKey: "",
  width: 1280,
  height: 853,
  size: 0,
  checksum: "",
  mimeType: "image/jpeg",
});

const squareWrenchIcon = {
  id: "wrench",
  url: "https://img.avtocena.com/catalog/images/china/wrench.png",
  objectKey: "catalog/images/china/wrench.png",
  width: 512,
  height: 512,
  size: 110_000,
  checksum: "wrench-checksum",
  mimeType: "image/png",
};

const rawOffer = {
  id: "public-card",
  sourceId: "encar_direct",
  sourceOfferId: "100",
  market: "korea",
  offerType: "fixed",
  status: "active",
  sourceTitle: "Kia Sportage 2022",
  make: "Kia",
  model: "Sportage",
  year: 2022,
  sourcePrice: 24_000_000,
  sourceCurrency: "KRW",
  totalRub: null,
  calculationStatus: "needs_knowledge",
  images: Array.from({ length: 5 }, (_, index) => sourcePhoto(index + 1)),
};

test("accepts a genuine landscape vehicle photograph", () => {
  assert.equal(isLikelyVehicleImage(jpegPhoto), true);
  assert.deepEqual(credibleCatalogImages([jpegPhoto] as any), [jpegPhoto]);
});

test("rejects a square service pictogram even when it is large", () => {
  assert.equal(isLikelyVehicleImage(squareWrenchIcon), false);
  assert.deepEqual(credibleCatalogImages([squareWrenchIcon] as any), []);
  assert.deepEqual(rankedCatalogImageUrls({ images: [squareWrenchIcon] }), []);
});

test("uses the internal image API only for a legacy stored binary", () => {
  assert.deepEqual(rankedCatalogImageUrls({ images: [squareWrenchIcon, jpegPhoto] }), ["/api/catalog/images/photo"]);
});

test("renders source-only JSON gallery URLs directly", () => {
  const gallery = Array.from({ length: 5 }, (_, index) => sourcePhoto(index + 1));
  assert.deepEqual(rankedCatalogImageUrls({ images: gallery }), gallery.map((image) => image.url));
  assert.equal(rankedCatalogImageUrls({ images: gallery }).some((url) => url.startsWith("/api/catalog/images/")), false);
});

test("rejects website and listing URLs that have no image delivery evidence", () => {
  const pages = [
    { url: "https://www.otomoto.pl/", objectKey: "", mimeType: "" },
    { url: "https://www.otomoto.pl/osobowe/oferta/toyota-corolla-ID6HRRdM.html", objectKey: "", mimeType: "" },
  ];
  assert.deepEqual(pages.map((image) => isLikelyVehicleImage(image)), [false, false]);
  assert.deepEqual(rankedCatalogImageUrls({ images: pages }), []);
});

test("removes repeated images with the same checksum", () => {
  const copy = {
    ...jpegPhoto,
    id: "photo-copy",
    objectKey: "catalog/images/uae/photo-copy.jpg",
    url: "https://img.avtocena.com/catalog/images/uae/photo-copy.jpg?size=large",
  };
  assert.deepEqual(rankedCatalogImageUrls({ images: [jpegPhoto, copy, copy] }), ["/api/catalog/images/photo"]);
});

test("uses the configured V3 two-photo admission contract across live source markets", () => {
  const previous = process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER;
  process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "2";
  try {
    const liveMarkets = [
      rawOffer,
      { ...rawOffer, market: "georgia", sourceId: "autopapa_georgia_open", sourceCurrency: "USD" },
      { ...rawOffer, market: "china", sourceId: "autohome_new_china_open", sourceCurrency: "CNY" },
      { ...rawOffer, market: "europe", sourceId: "mobile_de_open", sourceCurrency: "EUR" },
      { ...rawOffer, market: "japan", sourceId: "japan_live", sourceCurrency: "JPY" },
    ];
    for (const offer of liveMarkets) {
      assert.equal(isCrediblePublicOffer({ ...offer, images: rawOffer.images.slice(0, 1) } as any), false, `${offer.market}: one image`);
      assert.equal(isCrediblePublicOffer({ ...offer, images: rawOffer.images.slice(0, 2) } as any), true, `${offer.market}: two images`);
    }
  } finally {
    if (previous === undefined) delete process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER;
    else process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = previous;
  }
});

test("rejects catalog cards without real source make and model identity", () => {
  assert.equal(isCrediblePublicOffer(rawOffer as any), true);
  for (const make of ["", "unknown", "N/A", "Марка уточняется", "не указано", "기타", "其他"]) {
    assert.equal(isCrediblePublicOffer({ ...rawOffer, make } as any), false, `make=${make || "<empty>"}`);
  }
  for (const model of ["", "unknown", "N/A", "Модель уточняется", "неизвестно", "미상", "未知"]) {
    assert.equal(isCrediblePublicOffer({ ...rawOffer, model } as any), false, `model=${model || "<empty>"}`);
  }
});

test("uses only Goo-net listing-bound frames and never dealer gallery assets", () => {
  const page = "https://www.goo-net-exchange.com/usedcars/HONDA/VEZEL/988026042600804420007/";
  const primary = "https://picture1.goo-net.com/9880260426/00804420/J/98802604260080442000700.jpg";
  const exactSecondary = [1, 2, 3, 4].map((index) => primary.replace(/00\.jpg$/, `${String(index).padStart(2, "0")}.jpg`));
  const dealerGallery = Array.from(
    { length: 5 },
    (_, index) => `https://picture1.goo-net.com/080/0804420/J/0804420A20260425D0070${index + 1}.jpg`,
  );
  const unrelated = [
    "https://picture1.goo-net.com/common/recommend/J/recommend01.jpg",
    "https://picture1.goo-net.com/common/recommend/J/recommend02.jpg",
  ];

  assert.deepEqual(coherentGoonetImages([...dealerGallery, ...unrelated, ...exactSecondary, primary], 5, page), [
    primary,
    ...exactSecondary,
  ]);
});

test("derives Goo-net's official primary photo from the stable listing id", () => {
  assert.equal(
    goonetPrimaryImageUrl("https://www.goo-net-exchange.com/usedcars/HONDA/VEZEL/988026042600804420007/"),
    "https://picture1.goo-net.com/9880260426/00804420/J/98802604260080442000700.jpg",
  );
  assert.equal(
    goonetPrimaryImageUrl("https://www.goo-net-exchange.com/usedcars/SUZUKI/JIMNY/700070353330260822001/"),
    "https://picture1.goo-net.com/7000703533/30260822/J/70007035333026082200100.jpg",
  );
  assert.equal(
    goonetPrimaryImageUrl("https://www.goo-net-exchange.com/usedcars/TOYOTA/ALPHARD/700040138730260807004/"),
    "https://picture1.goo-net.com/7000401387/30260807/J/70004013873026080700400.jpg",
  );
  assert.equal(goonetPrimaryImageUrl("https://www.goo-net-exchange.com/usedcars/HONDA/VEZEL/not-a-listing/"), "");
});

test("rejects Goo-net dealer-gallery fallback when no exact listing identity exists", () => {
  const gallery = Array.from(
    { length: 4 },
    (_, index) => `https://picture1.goo-net.com/080/0804420/J/0804420A20260425D0070${index + 1}.jpg`,
  );
  assert.deepEqual(coherentGoonetImages([
    "https://picture1.goo-net.com/other/listing/J/other01.jpg",
    ...gallery,
  ], 3), []);
});

test("keeps a server-validated compact Japan projection visible with one ranked cover", () => {
  const japanProjection = {
    ...rawOffer,
    id: "japan-projection-card",
    sourceId: undefined,
    sourceOfferId: undefined,
    sourceTitle: undefined,
    market: "japan",
    make: "Toyota",
    model: "Corolla",
    sourcePrice: 1_500_000,
    sourceCurrency: "JPY",
    images: rawOffer.images.slice(0, 1),
    cardProjectionVersion: 1,
  };
  assert.equal(isCrediblePublicOffer(japanProjection as any), true);
  assert.equal(isCrediblePublicOffer({ ...japanProjection, cardProjectionVersion: undefined } as any), false);
});

test("accepts raw source price without knowledge calculation", () => {
  assert.equal(isCrediblePublicOffer(rawOffer as any), true);
  assert.equal(isCrediblePublicOffer({ ...rawOffer, sourcePrice: 0 } as any), false);
  assert.equal(isCrediblePublicOffer({ ...rawOffer, sourceCurrency: "" } as any), false);
});

test("rejects an advertising payment string used as the source title", () => {
  assert.equal(isCrediblePublicOffer({
    ...rawOffer,
    sourceTitle: "Corolla XLI 2023 AED 718/Month 0 DP 30 Day Return Warranty",
  } as any), false);
});

test("business liquidity remains a ranking signal but does not override Japan's year gate", () => {
  const olderJapan = {
    ...rawOffer,
    market: "japan",
    year: new Date().getFullYear() - 7,
    fuel: "petrol",
    powerHp: 220,
    powerDataConfidence: "estimated",
    powerDataSource: "vehicle-model-representative:toyota/crown",
  };
  assert.equal(isCatalogOfferBusinessLiquid(olderJapan as any), false);
  assert.equal(isCrediblePublicOffer(olderJapan as any), true);
  assert.equal(isCatalogOfferBusinessLiquid({
    ...olderJapan,
    powerDataConfidence: "reference",
    powerDataSource: "vehicle-knowledge:drom_variant_220hp",
  } as any), false);
  assert.equal(isCatalogOfferBusinessLiquid({
    ...olderJapan,
    powerDataConfidence: "source_exact",
    powerDataSource: "source:horsepower",
  } as any), false);
});

test("rejects rounded Korea K9 3.3 GDI displacement and keeps exact 3342cc evidence", () => {
  const k9 = {
    ...rawOffer,
    make: "Kia",
    model: "K9(II) 3.3 GDI AWD",
    trim: "K9(II) 3.3 GDI AWD",
    sourceTitle: "Kia K9 3.3 GDI AWD",
    engineCc: 3300,
    operational: { raw: {} },
  };
  assert.equal(isCatalogOfferBusinessLiquid(k9 as any), false);
  assert.equal(isCatalogOfferBusinessLiquid({ ...k9, engineCc: 3000 } as any), false);
  assert.equal(isCatalogOfferBusinessLiquid({ ...k9, engineCc: 3342 } as any), true);
  assert.equal(isCatalogOfferBusinessLiquid({ ...k9, engineCc: 3300, sourceTitle: "Kia K9 3.3 GDI 3342 cc" } as any), false);
});
