import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readProtectedImageReferences } from "../scripts/lib/catalog-cleanup-image-references.mjs";

const active = { imagesById: { a: { objectKey: "catalog/images/active.jpg" } } };
const objects = [{ key: "catalog/images/active.jpg" }, { key: "catalog/images/staging.jpg" }, { key: "catalog/images/old.jpg" }];
function readFor(values: Record<string, unknown>) {
  return async (path: string) => values[path.split("/")[2]] ?? null;
}

test("incomplete protected staging defers every image deletion, not publication", async () => {
  const result = await readProtectedImageReferences({ generationIds: ["active", "staging"], requiredGenerationIds: ["active"], imageObjects: objects, readJson: readFor({ active }) });
  assert.deepEqual(result.deferredGenerations, ["staging"]);
  assert.deepEqual([...result.keys].sort(), objects.map(x => x.key).sort());
});

test("missing current or rollback index still fails closed", async () => {
  for (const required of ["active", "previous"]) {
    await assert.rejects(readProtectedImageReferences({ generationIds: [required], requiredGenerationIds: ["active", "previous"], imageObjects: objects, readJson: readFor({}) }), /storage_cleanup_image_index_unreadable/);
  }
});

test("complete protected indexes retain their references without retaining unrelated images", async () => {
  const result = await readProtectedImageReferences({ generationIds: ["active", "staging"], requiredGenerationIds: ["active"], imageObjects: objects, readJson: readFor({ active, staging: { imagesById: { b: { objectKey: "catalog/images/staging.jpg" } } } }) });
  assert.equal(result.keys.has("catalog/images/old.jpg"), false);
  assert.equal(result.keys.size, 2);
  assert.deepEqual(result.deferredGenerations, []);
});

test("malformed indexes cannot authorize deletion and transport failures propagate", async () => {
  for (const malformed of [{}, { imagesById: [] }, { imagesById: "bad" }]) {
    const result = await readProtectedImageReferences({ generationIds: ["staging"], requiredGenerationIds: [], imageObjects: objects, readJson: readFor({ staging: malformed }) });
    assert.equal(result.keys.size, objects.length);
  }
  await assert.rejects(readProtectedImageReferences({ generationIds: ["staging"], requiredGenerationIds: [], imageObjects: objects, readJson: async () => { throw Error("transport_unreachable"); } }), /transport_unreachable/);
});

test("cleanup wires conservative references and reads internal chunks without materializing the pool", () => {
  const code = fs.readFileSync(new URL("../scripts/catalog-clean-object-storage.mjs", import.meta.url), "utf8");
  assert.match(code, /requiredGenerationIds: \[publicGeneration, previousManifest\?\.generationId\]/);
  assert.match(code, /imageCleanupDeferredGenerations\.push/);
  assert.match(code, /for \(const chunk of internalChunks\)/);
  assert.match(code, /storage_cleanup_internal_chunk_unreadable/);
  assert.match(code, /!liveImageKeys\.has\(object\.key\)/);
  assert.doesNotMatch(code, /const internalLists = await/);
});
