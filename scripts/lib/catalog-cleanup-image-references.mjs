// An interrupted publication may leave a protected staging generation without
// its final image index. Preserve every stored image in that case; never infer
// that an unreadable index means there are no referenced images.
export async function readProtectedImageReferences({ generationIds, requiredGenerationIds, imageObjects, readJson }) {
  const keys = new Set();
  const deferredGenerations = [];
  const required = new Set(requiredGenerationIds);
  for (const generationId of generationIds) {
    if (!generationId) continue;
    const index = await readJson(`catalog/generations/${generationId}/indexes/images-by-id.json`, null);
    const images = index?.imagesById;
    if (!images || typeof images !== "object" || Array.isArray(images)) {
      if (required.has(generationId)) throw new Error(`storage_cleanup_image_index_unreadable_${generationId}`);
      deferredGenerations.push(generationId);
      continue;
    }
    for (const image of Object.values(images)) {
      const key = String(image?.objectKey || "").trim();
      if (key) keys.add(key);
    }
  }
  if (deferredGenerations.length) {
    for (const object of imageObjects) {
      const key = String(object?.key || "").trim();
      if (key) keys.add(key);
    }
  }
  return { keys, deferredGenerations };
}
