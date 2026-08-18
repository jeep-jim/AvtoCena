import test from "node:test";
import assert from "node:assert/strict";
import {
  readEncyclopediaKnowledgeModels,
  readEncyclopediaKnowledgeVariants,
  readVerifiedEncyclopediaCorpus,
} from "../apps/web/lib/catalog/encyclopedia";
import {
  readVehicleKnowledgeModels,
  readVehicleKnowledgeVariants,
  resetVehicleKnowledgeCache,
} from "../apps/web/lib/catalog/vehicle-knowledge";

test("verified encyclopedia corpus is intact and complete", async () => {
  const corpus = await readVerifiedEncyclopediaCorpus();
  assert.equal(corpus.sourceCheckpoint, "4a145d3e");
  assert.equal(corpus.models.length, 62);
  assert.equal(corpus.variants.length, 740);
  assert.equal(corpus.totals.models, 62);
  assert.equal(corpus.totals.variants, 740);
  assert.ok(corpus.models.some((row) => row.id === "toyota/premio"));
  assert.ok(corpus.models.some((row) => row.id === "toyota/regiusace"));
  assert.ok(corpus.models.some((row) => row.id === "toyota/crown-sport"));
  assert.ok(corpus.variants.some((row) => row.id === "toyota/premio/second-generation/f-2016"));
  assert.ok(corpus.variants.some((row) => row.id === "toyota/crown-sport/sixteenth-generation/sport-rs-phev-2023" && row.powerKw === 225));
});

test("full verified corpus remains read-only and cannot expand calculator runtime", async () => {
  resetVehicleKnowledgeCache();
  const [runtimeModels, runtimeVariants, publicModels, publicVariants] = await Promise.all([
    readVehicleKnowledgeModels(),
    readVehicleKnowledgeVariants(),
    readEncyclopediaKnowledgeModels(),
    readEncyclopediaKnowledgeVariants(),
  ]);

  assert.equal(runtimeModels.length, 4_905);
  assert.equal(runtimeVariants.length, 15_744);
  assert.ok(!runtimeModels.some((row) => row.id === "toyota/premio"));
  assert.ok(!runtimeVariants.some((row) => row.id === "toyota/premio/second-generation/f-2016"));

  assert.ok(publicModels.length > runtimeModels.length);
  assert.ok(publicVariants.length > runtimeVariants.length);
  assert.ok(publicModels.some((row) => row.id === "toyota/premio"));
  assert.ok(publicModels.some((row) => row.id === "toyota/regiusace"));
  assert.ok(publicVariants.some((row) => row.id === "toyota/premio/second-generation/f-2016"));
});
