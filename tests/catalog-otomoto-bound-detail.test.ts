import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { materializeOtomotoSourceImage, parseOtomotoBoundDetail } from "../apps/web/lib/catalog/otomoto-exact-source";

const source = fs.readFileSync(new URL("../apps/web/lib/catalog/otomoto-exact-source.ts", import.meta.url), "utf8");
const targetUrl = "https://www.otomoto.pl/osobowe/oferta/toyota-corolla-ID6HRRdM.html";
const fallback = {
  id: "6HRRdM",
  url: targetUrl,
  title: "Toyota Corolla 1.8 Hybrid Style",
  make: "Toyota",
  model: "Corolla",
  year: 2024,
  price: 109900,
  images: ["https://list.example/card.jpg"],
};

test("OTOMOTO detail accepts only Product/Vehicle JSON-LD bound to the current -ID listing", () => {
  const markup = `
    <script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      url: "https://www.otomoto.pl/osobowe/oferta/bmw-x5-ID6OTHER.html",
      name: "BMW X5",
      image: ["https://cdn.example/foreign-1.jpg", "https://cdn.example/foreign-2.jpg"],
      itemOffered: { "@type": "Vehicle", brand: { name: "BMW" }, model: "X5", vehicleModelDate: "2024" },
    })}</script>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      url: targetUrl,
      name: "Toyota Corolla 1.8 Hybrid Style",
      offers: { price: "109900" },
      image: [targetUrl, "https://www.otomoto.pl/", "https://img.otomoto.pl/target-cover.webp"],
      itemOffered: {
        "@type": "Vehicle",
        name: "Toyota Corolla 1.8 Hybrid Style",
        brand: { name: "Toyota" },
        model: "Corolla",
        vehicleModelDate: "2024",
        fuelType: "Hybryda",
        vehicleTransmission: "Automatyczna",
        image: [
          { contentUrl: "https://img.otomoto.pl/target-1.webp" },
          { contentUrl: "https://img.otomoto.pl/target-2.webp" },
        ],
      },
    })}</script>`;

  const row = parseOtomotoBoundDetail(markup, targetUrl, fallback as any);
  assert.ok(row);
  assert.equal(row.id, "6HRRdM");
  assert.equal(row.make, "Toyota");
  assert.equal(row.model, "Corolla");
  assert.equal(row.year, 2024);
  assert.equal(row.detailIdentityVerified, true);
  assert.equal(row.galleryIdentityVerified, true);
  assert.deepEqual(row.images, [
    "https://img.otomoto.pl/target-cover.webp",
    "https://img.otomoto.pl/target-1.webp",
    "https://img.otomoto.pl/target-2.webp",
  ]);
  assert.equal(row.images.some((url) => url.includes("foreign")), false);
});

test("OTOMOTO detail fails closed when JSON-LD identity belongs to another listing", () => {
  const markup = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    url: "https://www.otomoto.pl/osobowe/oferta/bmw-x5-ID6OTHER.html",
    name: "BMW X5",
    offers: { price: "999999" },
    image: ["https://img.otomoto.pl/foreign.webp"],
    itemOffered: { "@type": "Vehicle", brand: { name: "BMW" }, model: "X5", vehicleModelDate: "2025" },
  })}</script>`;
  const row = parseOtomotoBoundDetail(markup, targetUrl, fallback as any);
  assert.ok(row);
  assert.equal(row.make, "Toyota");
  assert.equal(row.model, "Corolla");
  assert.equal(row.price, 109900);
  assert.deepEqual(row.images, []);
  assert.equal(row.detailIdentityVerified, false);
  assert.equal(row.galleryIdentityVerified, false);
});

test("OTOMOTO exact gallery stays as source_urls_only instead of image-cache objects", () => {
  const image = materializeOtomotoSourceImage("https://img.otomoto.pl/gallery/frame.webp?quality=90");
  assert.equal(image.url, "https://img.otomoto.pl/gallery/frame.webp?quality=90");
  assert.equal(image.objectKey, "");
  assert.equal(image.size, 0);
  assert.equal(image.mimeType, "image/webp");
  assert.match(image.id, /^src_/);
  assert.doesNotMatch(source, /cacheImageFromUrl/);
  assert.match(source, /galleryStoredAs:\s*"source_urls_only"/);
  assert.doesNotMatch(source, /all\.flatMap\(.*image|detailRow\(.*imageUrls\(markup/s);
});
