import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const rebuild = fs.readFileSync(new URL("../scripts/catalog-rebuild-source-shard.mjs", import.meta.url), "utf8");
const publish = fs.readFileSync(new URL("../scripts/catalog-publish-source-scale.mjs", import.meta.url), "utf8");
const card = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const detail = fs.readFileSync(new URL("../apps/web/app/(public)/cars/offer/[id]/page.tsx", import.meta.url), "utf8");
const knowledge = fs.readFileSync(new URL("../apps/web/lib/catalog/vehicle-knowledge.ts", import.meta.url), "utf8");
const sync = fs.readFileSync(new URL("../scripts/catalog-sync-vehicle-models.mjs", import.meta.url), "utf8");
test("mass-market catalog is applied to production code", () => {
  assert.match(rebuild, /catalogPublicPriority\(offer\)\.eligible/);
  assert.match(publish, /priority_\$\{priority.reason\}/);
  assert.match(publish, /compareCatalogPublicPriority/);
  assert.match(card, /catalogOfferVisibleRub\(normalizedOffer\)/);
  assert.match(detail, /catalogOfferVisibleRub\(raw\)/);
  assert.match(knowledge, /popularityDecile: model.popularityDecile/);
  assert.match(sync, /recentKnowledgeYear = new Date\(\)\.getFullYear\(\) - 9/);
});
