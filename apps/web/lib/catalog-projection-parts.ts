import crypto from 'node:crypto';
import type {JsonStorage, JsonWriteCondition} from './data';

const ROOT = 'catalog/public/projection/all.json';
const FORMAT = 'catalog-projection-parts-v1';
const ROWS_PER_PART = 1000;
type Part = {path: string; count: number; sha256: string};
type Directory = {storageFormat: typeof FORMAT; generationId: string; count: number; parts: Part[]};
const digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function prefix(generationId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(generationId)) throw Error('catalog_projection_generation_invalid');
  return `catalog/generations/${generationId}/indexes/projection-parts/all/`;
}

// Enable writes only after a release with this reader is installed. Legacy
// readers cannot interpret the directory; ordinary JSON remains supported.
export async function writeCatalogProjectionParts(storage: JsonStorage, key: string, value: unknown, condition?: JsonWriteCondition): Promise<boolean> {
  if (key !== ROOT || process.env.CATALOG_CHUNKED_ALL_PROJECTION_WRITE !== '1') return false;
  const projection = value as {generationId?: string; items?: unknown[]};
  if (!projection || !Array.isArray(projection.items)) return false;
  if (Object.keys(projection).some(k => k !== 'generationId' && k !== 'items')) throw Error('catalog_projection_unexpected_fields');
  const generationId = String(projection.generationId || '');
  const base = prefix(generationId);
  const parts: Part[] = [];
  for (let offset = 0; offset < projection.items.length; offset += ROWS_PER_PART) {
    const part = {items: projection.items.slice(offset, offset + ROWS_PER_PART)};
    const sha256 = digest(part);
    const path = `${base}${parts.length}-${sha256}.json`;
    try { await storage.writeJson(path, part, {ifNoneMatch: '*'}); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'storage_conflict') throw error;
      const saved = await storage.readJson(path, null);
      if (!saved || digest(saved) !== sha256) throw Error('catalog_projection_part_conflict');
    }
    parts.push({path, count: part.items.length, sha256});
  }
  // Publish the root only after every immutable part is durable. CAS conditions
  // still apply to the root; failure leaves the previous root intact.
  await storage.writeJson(ROOT, {storageFormat: FORMAT, generationId, count: projection.items.length, parts}, condition);
  return true;
}

export async function readCatalogProjectionParts<T>(storage: JsonStorage, key: string, value: T): Promise<T> {
  if (key !== ROOT || !value || typeof value !== 'object' || !('storageFormat' in value)) return value;
  const directory = value as unknown as Directory;
  if (directory.storageFormat !== FORMAT || !Array.isArray(directory.parts) || !Number.isSafeInteger(directory.count) || directory.count < 0) throw Error('catalog_projection_directory_invalid');
  const base = prefix(directory.generationId);
  const items: unknown[] = [];
  for (const [index, descriptor] of directory.parts.entries()) {
    if (!/^[a-f0-9]{64}$/.test(descriptor.sha256) || descriptor.path !== `${base}${index}-${descriptor.sha256}.json` || !Number.isSafeInteger(descriptor.count) || descriptor.count <= 0 || descriptor.count > ROWS_PER_PART) throw Error('catalog_projection_part_descriptor_invalid');
  }
  // Bound both requests and transient payloads; preserve original row order.
  for (let offset = 0; offset < directory.parts.length; offset += 4) {
    const group = await Promise.all(directory.parts.slice(offset, offset + 4).map(async descriptor => {
      const part = await storage.readJson<{items: unknown[]} | null>(descriptor.path, null);
      if (!part || !Array.isArray(part.items) || part.items.length !== descriptor.count || digest(part) !== descriptor.sha256) throw Error('catalog_projection_part_integrity_failed');
      return part.items;
    }));
    for (const rows of group) for (const row of rows) items.push(row);
  }
  if (items.length !== directory.count) throw Error('catalog_projection_count_mismatch');
  return {generationId: directory.generationId, items} as T;
}
