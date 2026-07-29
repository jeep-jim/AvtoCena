import test from "node:test";
import assert from "node:assert/strict";
import { credibleCatalogImages, isCrediblePublicOffer } from "../apps/web/lib/catalog/offer-quality";
import { isLikelyVehicleImage, rankedCatalogImageUrls } from "../apps/web/lib/catalog/image-quality";

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

test("accepts a genuine landscape vehicle photograph", () => {
  assert.equal(isLikelyVehicleImage(jpegPhoto), true);
  assert.deepEqual(credibleCatalogImages([jpegPhoto] as any), [jpegPhoto]);
});

test("rejects a square service pictogram even when it is large", () => {
  assert.equal(isLikelyVehicleImage(squareWrenchIcon), false);
  assert.deepEqual(credibleCatalogImages([squareWrenchIcon] as any), []);
  assert.deepEqual(rankedCatalogImageUrls({ images: [squareWrenchIcon] }), []);
});

test("keeps only real photographs and serves them through the stable catalog API", () => {
  assert.deepEqual(
    rankedCatalogImageUrls({ images: [squareWrenchIcon, jpegPhoto] }),
    ["/api/catalog/images/photo"],
  );
});

test("falls back to the stored URL only for legacy images without an id", () => {
  const legacy = { ...jpegPhoto, id: undefined, url: "https://legacy.example/photo.jpg" };
  assert.deepEqual(rankedCatalogImageUrls({ images: [legacy] }), [legacy.url]);
});

test("accepts a server-validated public DTO after private source fields are removed", () => {
  const publicOffer = {
    id: "public-card",
    market: "korea",
    offerType: "fixed",
    status: "active",
    make: "Kia",
    model: "Sportage",
    year: 2022,
    mileageKm: 48_000,
    sourcePrice: 24_000_000,
    sourceCurrency: "KRW",
    calculationStatus: "needs_data",
    images: [jpegPhoto],
  };

  assert.equal(isCrediblePublicOffer(publicOffer as any), true);
  assert.equal(isCrediblePublicOffer({ ...publicOffer, images: [] } as any), false);
});