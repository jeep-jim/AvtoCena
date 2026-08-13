import assert from "node:assert/strict";
import test from "node:test";
import { isCatalogKnownBodySemanticValid, isCatalogOfferBusinessLiquid } from "../apps/web/lib/catalog/offer-quality";

function offer(overrides: Record<string, unknown>) {
  return {
    id: "semantic-test",
    sourceId: "encar_direct",
    sourceOfferId: "semantic-test",
    market: "korea",
    offerType: "fixed",
    status: "active",
    sourceTitle: "",
    make: "Hyundai",
    model: "Grandeur",
    trim: "",
    year: 2024,
    sourcePrice: 1,
    sourceCurrency: "KRW",
    powerHp: 100,
    images: [],
    ...overrides,
  } as any;
}

test("known Korean sedans reject impossible SUV/crossover/offroad body types", () => {
  const cases = [
    offer({ make: "Genesis", model: "G80", bodyType: "suv" }),
    offer({ make: "Hyundai", model: "Grandeur Hybrid", bodyType: "crossover" }),
    offer({ make: "Hyundai", model: "Ioniq 6", bodyType: "offroad" }),
    offer({ make: "Kia", model: "K9", bodyType: "SUV" }),
    offer({ make: "Kia", model: "K900", bodyType: "CROSSOVER" }),
    offer({ make: "Kia", model: "Quoris", bodyType: "OffRoad" }),
  ];
  for (const row of cases) {
    assert.equal(isCatalogKnownBodySemanticValid(row), false);
    assert.equal(isCatalogOfferBusinessLiquid(row), false);
  }
});

test("same Korea models remain valid when body type is sedan or unknown", () => {
  assert.equal(isCatalogKnownBodySemanticValid(offer({ make: "Genesis", model: "G80", bodyType: "sedan" })), true);
  assert.equal(isCatalogKnownBodySemanticValid(offer({ make: "Hyundai", model: "Grandeur", bodyType: "" })), true);
  assert.equal(isCatalogKnownBodySemanticValid(offer({ make: "Kia", model: "K9", bodyType: undefined })), true);
});

test("gate is Korea-specific and does not reject unrelated SUVs", () => {
  assert.equal(isCatalogKnownBodySemanticValid(offer({ market: "europe", make: "Genesis", model: "G80", bodyType: "suv" })), true);
  assert.equal(isCatalogKnownBodySemanticValid(offer({ make: "Hyundai", model: "Santa Fe", bodyType: "suv" })), true);
  assert.equal(isCatalogKnownBodySemanticValid(offer({ make: "Kia", model: "Sorento", bodyType: "crossover" })), true);
});
