import assert from "node:assert/strict";
import test from "node:test";
import { catalogOfferTitle, presentCatalogOffer } from "../apps/web/lib/catalog/presentation";

test("China title recovers a known brand from exact source text when make is unavailable", () => {
  const offer = { market: "china", make: "未知厂商", model: "福特Ranger", sourceTitle: "福特Ranger 2025款 2.3T", year: 2025 };
  assert.equal(catalogOfferTitle(offer), "Ford Ranger");
});

test("China title translates newly mapped source manufacturer instead of saying make pending", () => {
  const offer = { market: "china", make: "威麟", model: "威麟R08", sourceTitle: "威麟R08 2025款 2.3T", year: 2025 };
  assert.equal(catalogOfferTitle(offer), "Rely R08");
});

test("China title omits an actually unresolved make rather than publishing placeholder copy", () => {
  const offer = { market: "china", make: "未知厂商", model: "未知R99", sourceTitle: "未知R99 2025款", year: 2025 };
  const presented = presentCatalogOffer(offer);
  assert.equal(presented.title, "R99");
  assert.doesNotMatch(presented.title, /Марка уточняется|Модель уточняется/);
});
