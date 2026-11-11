import assert from "node:assert/strict";
import test from "node:test";

import {
  mapWithConcurrency,
  rotatedPrestigePlanCandidates,
} from "../apps/web/lib/catalog/prestige-japan-partition-plan";

test("a high daily offset rotates through short Prestige model lists without skipping them", () => {
  const candidates = rotatedPrestigePlanCandidates([
    {
      make: "TOYOTA",
      makeIndex: 0,
      models: ["A", "B", "C"].map((model, modelIndex) => ({ model, modelIndex })),
    },
    {
      make: "NISSAN",
      makeIndex: 1,
      models: ["X", "Y"].map((model, modelIndex) => ({ model, modelIndex })),
    },
  ], 99);

  assert.deepEqual(candidates.map(({ make, model }) => `${make}:${model}`), [
    "TOYOTA:A",
    "NISSAN:Y",
    "TOYOTA:B",
    "NISSAN:X",
    "TOYOTA:C",
  ]);
  assert.equal(new Set(candidates.map(({ makeIndex, modelIndex }) => `${makeIndex}:${modelIndex}`)).size, 5);
});

test("bounded Prestige planning preserves source order", async () => {
  let active = 0;
  let peak = 0;
  const output = await mapWithConcurrency([0, 1, 2, 3, 4], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value % 2 ? 2 : 5));
    active--;
    return value * 10;
  });

  assert.deepEqual(output, [0, 10, 20, 30, 40]);
  assert.equal(peak, 2);
});
