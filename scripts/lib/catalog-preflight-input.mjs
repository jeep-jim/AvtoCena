import fs from 'node:fs/promises';
import path from 'node:path';

export async function catalogPreflightInputBytes(storage, env = process.env) {
  if (env.CATALOG_STORAGE_PREFLIGHT_MODE === 'budget-index') {
    const manifest = await storage.readJson('catalog/manifest.json', null);
    if (!/^gen_[a-zA-Z0-9_-]+$/.test(manifest?.generationId || '')) throw Error('Invalid active generation');
    if (!storage.listObjects) throw Error('Projection inventory unavailable');
    const prefix = `catalog/generations/${manifest.generationId}/indexes/projection/`;
    const objects = await storage.listObjects(prefix);
    if (!objects.length) throw Error('Active generation projections unavailable');
    let bytes = 0;
    for (const object of objects) {
      if (!object.key.startsWith(prefix) || !Number.isSafeInteger(object.size) || object.size < 0) throw Error('Invalid projection inventory');
      bytes += object.size;
    }
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw Error('Empty projection inventory');
    return bytes;
  }
  if (env.CATALOG_STORAGE_PREFLIGHT_MODE) throw Error('Unknown storage preflight mode');
  const input = env.CATALOG_REBUILD_INPUT_DIR || 'catalog-intake-publish';
  let bytes = 0;
  for (const file of await fs.readdir(input, {recursive: true})) {
    if (/\.jsonl?$/.test(file)) bytes += (await fs.stat(path.join(input, file))).size;
  }
  return bytes;
}
