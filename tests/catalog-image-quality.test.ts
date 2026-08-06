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

const sourcePhoto = (index: number) => ({
  id: "",
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

const completeOffer = {
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
  totalRub: 2_850_000,
  calculationStatus: "ready",
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

test("removes repeated images with the same checksum", () => {
  const copy = {
    ...jpegPhoto,
    id: "photo-copy",
    objectKey: "catalog/images/uae/photo-copy.jpg",
    url: "https://img.avtocena.com/catalog/images/uae/photo-copy.jpg?size=large",
  };
  assert.deepEqual(rankedCatalogImageUrls({ images: [jpegPhoto, copy, copy] }), ["/api/catalog/images/photo"]);
});

test("rejects four photos and accepts five photos", () => {
  assert.equal(isCrediblePublicOffer({ ...completeOffer, images: completeOffer.images.slice(0, 4) } as any), false);
  assert.equal(isCrediblePublicOffer(completeOffer as any), true);
});

test("rejects price-on-request and unfinished calculation", () => {
  assert.equal(isCrediblePublicOffer({ ...completeOffer, totalRub: 0 } as any), false);
  assert.equal(isCrediblePublicOffer({ ...completeOffer, calculationStatus: "needs_data" } as any), false);
  assert.equal(isCrediblePublicOffer({ ...completeOffer, calculationStatus: "needs_power" } as any), false);
});

test("rejects an advertising payment string used as a model name", () => {
  assert.equal(isCrediblePublicOffer({
    ...completeOffer,
    model: "Corolla XLI 2023 AED 718/Month 0 DP 30 Day Return Warranty",
  } as any), false);
});
