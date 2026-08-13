import assert from "node:assert/strict";
import test from "node:test";
import { autoscoutEuropeExactSource, parseAutoScoutDetailGallery } from "../apps/web/lib/catalog/autoscout-exact-source";

const id = "e69f4836-88ed-4c84-b8ae-034e73c485c7";
function page(images: string[], declaredId = id) {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { listingDetails: { id: declaredId, images } } } })}</script>`;
}

test("AutoScout exact detail gallery uses only source-declared HQ images for the exact listing", () => {
  const good = Array.from({ length: 6 }, (_, i) => `https://prod.pictures.autoscout24.net/listing-images/${id}_photo${i}.jpg/1280x960.webp`);
  const rows = parseAutoScoutDetailGallery(page([good[0], `https://prod.pictures.autoscout24.net/listing-images/foreign_photo.jpg/1280x960.webp`, good[1].replace("1280x960", "250x188"), ...good.slice(1), good[0]]), id);
  assert.deepEqual(rows, good);
});

test("AutoScout detail gallery rejects a mismatched declared listing id", () => {
  const images = Array.from({ length: 5 }, (_, i) => `https://prod.pictures.autoscout24.net/listing-images/${id}_photo${i}.jpg/1280x960.webp`);
  assert.deepEqual(parseAutoScoutDetailGallery(page(images, "different-id"), id), []);
});

test("AutoScout list thumbnails are not claimed as verified exact photos before detail fetch", () => {
  const offer = autoscoutEuropeExactSource.normalizeOffer({ id, sourceUrl: `https://www.autoscout24.com/offers/example-${id}`, title: "Volvo EX90", make: "Volvo", model: "EX90", trim: "Ultra", year: 2025, mileageKm: 13909, price: 70000, currency: "EUR", images: Array.from({ length: 5 }, (_, i) => `https://prod.pictures.autoscout24.net/listing-images/${id}_${i}.jpg/250x188.webp`), raw: {} });
  assert.ok(offer);
  assert.equal(offer!.operational?.exactDetail, false);
  assert.equal(offer!.operational?.exactPhotos, false);
  assert.equal(offer!.operational?.galleryVerified, false);
  assert.equal(offer!.operational?.photoIdentityVerified, false);
});
