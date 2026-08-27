import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const core = fs.readFileSync("apps/web/lib/catalog/knowledge-core.ts", "utf8");
const storage = fs.readFileSync("apps/web/lib/catalog/storage.ts", "utf8");
const customsPricing = fs.readFileSync("apps/web/lib/catalog/customs-pricing.ts", "utf8");
const displayEnrichment = fs.readFileSync("apps/web/lib/catalog/display-enrichment.ts", "utf8");
const sourceRebuild = fs.readFileSync("scripts/catalog-rebuild-source-shard.mjs", "utf8");
const identityMaster = fs.readFileSync("scripts/catalog-apply-encyclopedia-identity-master.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/catalog-v3-market-10k-reusable.yml", "utf8");
const manifest = fs.readFileSync("data/catalog/vehicle-encyclopedia-v2/manifest.json", "utf8");

test("Knowledge CORE is the catalog enrichment entrypoint", () => {
  assert.match(core, /export async function enrichOfferWithKnowledgeCore/);
  assert.match(core, /vehicle-encyclopedia-v2/);
  assert.match(core, /Legacy knowledge is now a compatibility fallback behind one CORE API/);
  assert.match(core, /fieldTrusted/);
  assert.match(core, /sourcePowerAuthoritative/);
  assert.match(core, /power30MinKw/);
  assert.match(storage, /enrichOfferWithKnowledgeCore/);
  assert.doesNotMatch(storage, /enrichOfferWithVehicleKnowledge\(/);
  assert.match(customsPricing, /enrichOfferWithKnowledgeCore/);
  assert.doesNotMatch(customsPricing, /enrichOfferWithVehicleKnowledge/);
  assert.match(displayEnrichment, /enrichOfferWithKnowledgeCore/);
  assert.doesNotMatch(displayEnrichment, /enrichOfferWithVehicleKnowledge/);
  assert.match(sourceRebuild, /enrichOfferWithKnowledgeCore/);
  assert.doesNotMatch(sourceRebuild, /enrichOfferWithVehicleKnowledge/);
  assert.match(identityMaster, /enrichOfferWithKnowledgeCore/);
  assert.match(identityMaster, /applyPrestigeJapanExactIdentityKnowledge/);
});

test("Knowledge CORE coverage follows market year contract", () => {
  const parsed = JSON.parse(manifest);
  const japan = parsed.coverageWindows.find((row: any) => row.marketId === "japan");
  const others = parsed.coverageWindows.find((row: any) => Array.isArray(row.marketIds));
  assert.equal(parsed.targetYearFrom, 2010);
  assert.equal(japan?.yearFrom, 2010);
  assert.equal(others?.yearFrom, 2020);
});

test("Every market publish emits a live knowledge-gap report", () => {
  assert.match(workflow, /Build Knowledge CORE gap report/);
  assert.match(workflow, /catalog-build-knowledge-gaps\.mjs/);
  assert.match(workflow, /catalog-v3-\$\{\{ inputs\.market \}\}-knowledge-gaps\.json/);
  assert.match(workflow, /Verify offer detail read models/);
});

test("Compiled source corpus is connected to the production Knowledge CORE", async () => {
  const compiledRoot = "data/catalog/knowledge-core";
  const compiled = JSON.parse(fs.readFileSync(path.join(compiledRoot, "manifest.json"), "utf8"));
  const sourceMaster = JSON.parse(fs.readFileSync("data/catalog/knowledge-source-snapshots/master/manifest.json", "utf8"));
  const completion = JSON.parse(fs.readFileSync("data/catalog/knowledge-source-snapshots/completion-report.json", "utf8"));

  assert.equal(compiled.status, "ready");
  assert.equal(completion.ready, true);
  assert.deepEqual(completion.failures, []);
  assert.equal(compiled.sourceCorpus.masterContentDigest, sourceMaster.contentDigest);
  assert.equal(compiled.counts.sourceModels, sourceMaster.counts.models);
  assert.equal(compiled.counts.canonicalSourceModels, sourceMaster.counts.modelsWithCanonicalV2);
  assert.equal(compiled.counts.unresolvedMake, sourceMaster.counts.models - sourceMaster.counts.modelsWithKnownMake);
  assert.equal(compiled.counts.unresolvedCanonicalModel, sourceMaster.counts.models - sourceMaster.counts.modelsWithCanonicalV2);
  assert.equal(compiled.counts.missingImage, sourceMaster.counts.models - sourceMaster.counts.modelsWithImageUrl);
  assert.ok(compiled.counts.compiledCanonicalModels > 0);
  assert.ok(compiled.counts.compiledSourceVariants > 0);
  assert.equal(compiled.sourceCorpus.chinaCoverage, "partial");
  assert.match(compiled.runtimeContract.koreaYear, /never compiled as model year/i);
  assert.match(compiled.runtimeContract.image, /binaryVerified remains false/i);
  assert.match(compiled.runtimeContract.power30Min, /No 30-minute power field is emitted/i);

  let variants = 0;
  for (const file of compiled.files.variants) {
    const payload = JSON.parse(fs.readFileSync(path.join(compiledRoot, file), "utf8"));
    assert.equal(payload.entityType, "compiled_variant");
    for (const variant of payload.records) {
      assert.equal(Object.hasOwn(variant, "power30MinKw"), false);
      assert.equal(Object.hasOwn(variant, "power30MinKwByMotor"), false);
      variants++;
    }
  }
  assert.equal(variants, compiled.counts.compiledSourceVariants);

  const { enrichOfferWithKnowledgeCore, readKnowledgeCoreIndex, resetKnowledgeCoreForTests } = await import("../apps/web/lib/catalog/knowledge-core");
  resetKnowledgeCoreForTests();
  const index = await readKnowledgeCoreIndex();
  assert.ok(index);
  assert.equal(index.compiledModelCount, compiled.counts.compiledCanonicalModels);
  assert.equal(index.compiledVariantCount, compiled.counts.compiledSourceVariants);
  assert.ok(index.variantCount >= index.compiledVariantCount);

  const enriched = await enrichOfferWithKnowledgeCore({
    id: "core-runtime-proof",
    sourceId: "runtime-test",
    sourceOfferId: "core-runtime-proof",
    market: "europe",
    offerType: "fixed",
    status: "active",
    make: "Geely",
    model: "Cityray",
    year: 2025,
    engineCc: 1499,
    fuel: "petrol",
    sourcePrice: 1,
    sourceCurrency: "EUR",
    priceMode: "fixed",
    images: [],
    calculationStatus: "needs_data",
    firstSeenAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    operational: {},
  } as any);
  assert.equal((enriched.operational as any).knowledgeCore.source, "knowledge-source-corpus");
  assert.equal((enriched.operational as any).knowledgeCore.sourceCorpusConnected, true);
  assert.equal(enriched.powerKw, 128);
  assert.equal(enriched.power30MinKw, undefined);
});
