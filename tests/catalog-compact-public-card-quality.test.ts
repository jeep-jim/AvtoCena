import assert from "node:assert/strict";
import test from "node:test";
import { isCrediblePublicOffer } from "../apps/web/lib/catalog/offer-quality";

const compactSourceCard = {
  id: "mobile-card-1",
  sourceId: "mobile_de_open",
  sourceOfferId: "card-1",
  market: "europe",
  status: "active",
  make: "Toyota",
  model: "Corolla",
  trim: "Toyota Corolla 2024",
  sourceTitle: "Toyota Corolla 2024",
  year: 2024,
  mileageKm: 12_000,
  sourcePrice: 19_000,
  sourceCurrency: "EUR",
  operational: { sourceUrl: "https://suchen.mobile.de/fahrzeuge/details.html?id=1" },
  cardProjectionVersion: 2,
  images: [{
    id: "",
    url: "https://prod.pictures.autoscout24.net/listing-images/card-1.jpg",
    size: 0,
    mimeType: "image/jpeg",
  }],
} as any;

test("compact public projection cards do not rerun source-gallery coherence", () => {
  assert.equal(isCrediblePublicOffer(compactSourceCard), true);
  assert.equal(isCrediblePublicOffer({ ...compactSourceCard, sourceId: "goonet_japan_exact", market: "japan" }), false);
  assert.equal(isCrediblePublicOffer({ ...compactSourceCard, operational: {} }), false);
});

test("full source offers still require coherent source galleries", () => {
  const fullSourceOffer = { ...compactSourceCard, cardProjectionVersion: undefined };
  assert.equal(isCrediblePublicOffer(fullSourceOffer), false);
});
