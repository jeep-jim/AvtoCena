import assert from "node:assert/strict";
import test from "node:test";
import { catalogOfferTitle, presentCatalogOffer } from "../apps/web/lib/catalog/presentation";

function offer(overrides: Record<string, unknown> = {}) {
  return {
    market: "uae",
    make: "Lexus",
    model: "RX",
    trim: "Other",
    year: 2021,
    operational: {
      encyclopediaIdentity: {
        rawMake: "Lexus",
        rawModel: "RX300",
        canonicalBrandId: "lexus",
        canonicalModelId: "lexus/rx",
        makeSource: "canonical",
        modelSource: "safe_alias",
        fullyResolved: true,
        ambiguous: false,
      },
    },
    ...overrides,
  } as any;
}

test("safe V2 alias can be the public model label while canonical family stays stable", () => {
  const row = offer();
  const presented = presentCatalogOffer(row);
  assert.equal(row.model, "RX");
  assert.equal(presented.modelLabel, "RX300");
  assert.equal(catalogOfferTitle(row), "Lexus RX300");
});

test("unresolved or unsafe source model never overrides canonical presentation", () => {
  const row = offer({ operational: { encyclopediaIdentity: { rawModel: "RX300 FREE SHIPPING", modelSource: "unresolved" } } });
  assert.equal(presentCatalogOffer(row).modelLabel, "RX");
  assert.equal(catalogOfferTitle(row), "Lexus RX");
});

test("localized safe aliases do not replace the Latin public model label", () => {
  const row = offer({ operational: { encyclopediaIdentity: { rawModel: "雷克萨斯RX300", modelSource: "safe_alias" } } });
  assert.equal(presentCatalogOffer(row).modelLabel, "RX");
});
