import test from "node:test";
import assert from "node:assert/strict";
import { credibleCatalogImages } from "../apps/web/lib/catalog/offer-quality";
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

test("keeps only real photographs when a listing mixes photos and placeholders", () => {
  assert.deepEqual(
    rankedCatalogImageUrls({ images: [squareWrenchIcon, jpegPhoto] }),
    [jpegPhoto.url],
  );
});
