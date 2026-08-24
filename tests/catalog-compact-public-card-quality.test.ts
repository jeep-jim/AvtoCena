import assert from "node:assert/strict";
import test from "node:test";
import { isCrediblePublicOffer } from "../apps/web/lib/catalog/offer-quality";

const compactGoonetCard = {
  id: "goonet-card-1",
  market: "japan",
  status: "active",
  make: "Toyota",
  model: "Corolla",
  trim: "Toyota Corolla 2024",
  sourceTitle: "Toyota Corolla 2024",
  year: 2024,
  mileageKm: 12_000,
  sourcePrice: 1_900_000,
  sourceCurrency: "JPY",
  cardProjectionVersion: 2,
  images: [{
    id: "",
    url: "https://catalogphoto.goo-net.com/car/2024/toyota-corolla.jpg",
    size: 0,
    mimeType: "image/jpeg",
  }],
} as any;

test("compact public projection cards do not rerun source-gallery coherence", () => {
  assert.equal(isCrediblePublicOffer(compactGoonetCard), true);
});

test("full source offers still require coherent source galleries", () => {
  const fullSourceOffer = { ...compactGoonetCard, cardProjectionVersion: undefined };
  assert.equal(isCrediblePublicOffer(fullSourceOffer), false);
});
