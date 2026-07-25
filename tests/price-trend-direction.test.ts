import assert from "node:assert/strict";
import test from "node:test";
import { resolvePriceTrend } from "../apps/web/components/catalog/PriceTrend";

test("a falling customer price resolves to the green down state", () => {
  const trend = resolvePriceTrend({ totalRub: 2_900_000, previousTotalRub: 3_100_000 });
  assert.equal(trend?.direction, "down");
  assert.equal(trend?.deltaRub, -200_000);
});

test("a rising customer price resolves to the red up state", () => {
  const trend = resolvePriceTrend({ totalRub: 3_300_000, previousTotalRub: 3_100_000 });
  assert.equal(trend?.direction, "up");
  assert.equal(trend?.deltaRub, 200_000);
});
