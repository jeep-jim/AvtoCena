import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalogBrandSummary } from "../apps/web/lib/catalog/storage";

test("brand summary aggregates make/model/market counts compactly", () => {
  const summary = buildCatalogBrandSummary("gen_test", [
    { id:"1", market:"europe", make:"BMW", model:"X3", year:2024 },
    { id:"2", market:"korea", make:"BMW", model:"X3", year:2023 },
    { id:"3", market:"europe", make:"BMW", model:"X5", year:2024 },
    { id:"4", market:"europe", make:"Audi", model:"A4", year:2024 },
  ] as any);
  assert.equal(summary.generationId, "gen_test");
  assert.equal(summary.brands.bmw.count, 3);
  assert.deepEqual(summary.brands.bmw.marketCounts, { europe:2, korea:1 });
  assert.deepEqual(summary.brands.bmw.models.map((x) => [x.model,x.count]), [["X3",2],["X5",1]]);
  assert.equal(summary.brands.audi.count, 1);
});
