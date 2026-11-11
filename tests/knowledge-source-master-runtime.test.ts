import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { readCatalogBrandDirectory } from "../apps/web/lib/catalog/catalog-brand-directory";
import {
  readKnowledgeSourceMaster,
  readSourceBackedEncyclopediaModels,
  resetKnowledgeSourceMasterForTests,
} from "../apps/web/lib/catalog/knowledge-source-master";

test("saved 754-brand / 20590-model source corpus is physically connected to product runtime", async () => {
  resetKnowledgeSourceMasterForTests();
  const master = await readKnowledgeSourceMaster();
  assert.equal(master.manifest.status, "source_master_built");
  assert.equal(master.manifest.counts?.brands, 754);
  assert.equal(master.manifest.counts?.models, 20_590);
  assert.equal(master.manifest.counts?.modelsWithKnownMake, 18_451);
  assert.equal(master.manifest.counts?.modelsWithCanonicalV2, 1_625);
  assert.equal(master.models.length, 20_590);

  const sourceBacked = await readSourceBackedEncyclopediaModels();
  assert.ok(sourceBacked.length > 10_000, `expected broad known-make corpus, got ${sourceBacked.length}`);
  assert.equal(sourceBacked.every((model) => Boolean(model.make && model.model && model.sourceBacked)), true);
  assert.equal(sourceBacked.some((model: any) => "power30MinKw" in model), false, "source-master identity must never invent 30-minute power");

  const brands = await readCatalogBrandDirectory();
  assert.ok(brands.length > 100, `expected full encyclopedia brand directory, got ${brands.length}`);
});

test("public encyclopedia directory is not derived from live parser facets anymore", () => {
  const source = fs.readFileSync(new URL("../apps/web/lib/catalog/catalog-brand-directory.ts", import.meta.url), "utf8");
  assert.match(source, /readSourceBackedEncyclopediaModels/);
  assert.doesNotMatch(source, /readCatalogFacets/);
  assert.doesNotMatch(source, /activeBrandSlugs/);
});
