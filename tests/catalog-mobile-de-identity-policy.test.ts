import assert from "node:assert/strict";
import test from "node:test";
import { MobileDeExactAdapter } from "../apps/web/lib/catalog/mobile-de-exact-source";

const source = new MobileDeExactAdapter();
const base = {
  id: "462337527",
  sourceUrl: "https://suchen.mobile.de/fahrzeuge/details.html?id=462337527",
  title: "Volkswagen Taigo 1.0 TSI",
  make: "Volkswagen",
  model: "Taigo",
  year: 2025,
  mileageKm: 12000,
  price: 23990,
  currency: "EUR",
  raw: {},
};

test("Mobile.de accepts a current listing with explicit make and model identity", () => {
  const offer = source.normalizeOffer(base);
  assert.ok(offer);
  assert.equal(offer!.make, "Volkswagen");
  assert.equal(offer!.model, "Taigo");
});

test("Mobile.de rejects source placeholder identity instead of inferring a model from the title", () => {
  assert.equal(source.normalizeOffer({ ...base, model: "Andere" }), null);
  assert.equal(source.normalizeOffer({ ...base, make: "Andere", model: "L5E" }), null);
});

test("Mobile.de enforces the non-Japan 2020 minimum at collector normalization", () => {
  assert.equal(source.normalizeOffer({ ...base, year: 2019 }), null);
  assert.ok(source.normalizeOffer({ ...base, year: 2020 }));
});
