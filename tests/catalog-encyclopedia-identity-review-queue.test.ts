import assert from "node:assert/strict";
import test from "node:test";
import { EncyclopediaIdentityResolver } from "../apps/web/lib/catalog/encyclopedia-identity";
import { buildEncyclopediaIdentityReviewQueue } from "../apps/web/lib/catalog/encyclopedia-identity-review-queue";

const resolver = new EncyclopediaIdentityResolver({
  brands: [
    { id: "aito", canonicalName: "AITO", aliases: [{ value: "AITO Wenjie", safe: true }] },
    { id: "collision-a", canonicalName: "Collision A", aliases: [{ value: "Shared", safe: true }] },
    { id: "collision-b", canonicalName: "Collision B", aliases: [{ value: "Shared", safe: true }] },
  ],
  models: [{ id: "aito/m9", brandId: "aito", canonicalName: "M9" }],
});

test("resolved aliases do not enter the review queue", () => {
  const queue = buildEncyclopediaIdentityReviewQueue(resolver, [
    { make: "AITO Wenjie", model: "M9", market: "china", sourceId: "guazi" },
  ]);
  assert.equal(queue.uniqueItems, 0);
  assert.equal(queue.queued, 0);
});

test("unknown model under a known brand becomes a model research item", () => {
  const queue = buildEncyclopediaIdentityReviewQueue(resolver, [
    { make: "AITO", model: "M8 New", market: "china", sourceId: "guazi" },
    { make: "AITO Wenjie", model: "M8 New", market: "china", sourceId: "autohome" },
  ]);
  assert.equal(queue.uniqueItems, 1);
  assert.deepEqual(queue.items[0], {
    scope: "model",
    status: "unresolved",
    rawMake: "AITO",
    rawModel: "M8 New",
    canonicalBrandId: "aito",
    canonicalMake: "AITO",
    count: 2,
    markets: [{ value: "china", count: 2 }],
    sources: [{ value: "autohome", count: 1 }, { value: "guazi", count: 1 }],
  });
});

test("unknown brands aggregate model samples and rank by live inventory impact", () => {
  const queue = buildEncyclopediaIdentityReviewQueue(resolver, [
    { make: "New Brand", model: "X1", market: "china", sourceId: "s1" },
    { make: "New Brand", model: "X1", market: "china", sourceId: "s2" },
    { make: "New Brand", model: "X2", market: "uae", sourceId: "s1" },
    { make: "Tiny Brand", model: "A", market: "uae", sourceId: "s3" },
  ]);
  assert.equal(queue.items[0].rawMake, "New Brand");
  assert.equal(queue.items[0].count, 3);
  assert.deepEqual(queue.items[0].sampleModels, [
    { value: "X1", count: 2 },
    { value: "X2", count: 1 },
  ]);
});

test("ambiguous aliases are explicitly queued instead of being auto-merged", () => {
  const queue = buildEncyclopediaIdentityReviewQueue(resolver, [
    { make: "Shared", model: "X", market: "china", sourceId: "source" },
  ]);
  assert.equal(queue.items[0].scope, "brand");
  assert.equal(queue.items[0].status, "ambiguous");
  assert.equal(queue.items[0].count, 1);
});
