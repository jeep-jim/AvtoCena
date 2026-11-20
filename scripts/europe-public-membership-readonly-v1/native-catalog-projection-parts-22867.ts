import crypto from 'node:crypto';
import type {JsonStorage, JsonWriteCondition} from './data';

const ROOT = 'catalog/public/projection/all.json';
const FORMAT = 'catalog-projection-parts-v1';
export const PROJECTION_ROWS_PER_PART = 1000;
export const PROJECTION_BYTES_PER_PART = 4 * 1024 * 1024;
type Part = {path: string; count: number; sha256: string};
type Directory = {storageFormat: typeof FORMAT; generationId: string; count: number; parts: Part[]};
const digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function isCatalogProjectionPath(key: string) {
  return /^catalog\/(?:public|generations\/[A-Za-z0-9_-]+\/indexes)\/projection(?:-brand)?\/[^/]+\.json$/.test(key);
}
function prefix(generationId: string, key: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(generationId) || !isCatalogProjectionPath(key)) throw Error('catalog_projection_generation_invalid');
  // Preserve the installed all-market reader's paths. Other roots have separate
  // namespaces, so equal chunk numbers in different markets cannot collide.
  const scope = key === ROOT ? 'all' : crypto.createHash('sha256').update(key).digest('hex');
  return `catalog/generations/${generationId}/indexes/projection-parts/${scope}/`;
}

/** Backpressure: never request the next input batch before its parts are durable. */
export async function writeCatalogProjectionBatches(storage: JsonStorage, key: string, generationId: string,
  batches: AsyncIterable<readonly unknown[]> | Iterable<readonly unknown[]>, condition?: JsonWriteCondition) {
  const base = prefix(generationId, key), parts: Part[] = [];
  let items: unknown[] = [], bytes = Buffer.byteLength('{"items":[]}'), count = 0;
  const flush = async () => {
    if (!items.length) return;
    const part = {items}, sha256 = digest(part), path = `${base}${parts.length}-${sha256}.json`;
    try { await storage.writeJson(path, part, {ifNoneMatch: '*'}); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'storage_conflict') throw error;
      const saved = await storage.readJson(path, null);
      if (!saved || digest(saved) !== sha256) throw Error('catalog_projection_part_conflict');
    }
    count += items.length;
    parts.push({path, count: items.length, sha256});
    items = []; bytes = Buffer.byteLength('{"items":[]}');
  };
  for await (const batch of batches) {
    for (const row of batch) {
      // Bound bytes as well as row count: one source may carry a much larger
      // calculation ledger. Never stringify the complete projection to size it.
      const rowBytes = Buffer.byteLength(JSON.stringify(row) ?? 'null');
      if (rowBytes + Buffer.byteLength('{"items":[]}') > PROJECTION_BYTES_PER_PART) throw Error('catalog_projection_row_too_large');
      if (items.length && (items.length >= PROJECTION_ROWS_PER_PART || bytes + 1 + rowBytes > PROJECTION_BYTES_PER_PART)) await flush();
      bytes += (items.length ? 1 : 0) + rowBytes; items.push(row);
    }
  }
  await flush();
  const directory: Directory = {storageFormat: FORMAT, generationId, count, parts};
  // The previous root remains intact on any child failure. Its original CAS
  // condition is applied only after all immutable children have been written.
  await storage.writeJson(key, directory, condition);
  return directory;
}

// Scoped writes require the new reader on every live/rollback container. The
// existing all-market flag remains compatible with already installed readers.
export async function writeCatalogProjectionParts(storage: JsonStorage, key: string, value: unknown, condition?: JsonWriteCondition): Promise<boolean> {
  const enabled = key === ROOT ? process.env.CATALOG_CHUNKED_ALL_PROJECTION_WRITE === '1'
    : isCatalogProjectionPath(key) && process.env.CATALOG_CHUNKED_PROJECTIONS_WRITE === '1';
  if (!enabled) return false;
  const projection = value as {generationId?: string; items?: unknown[]};
  if (!projection || !Array.isArray(projection.items)) return false;
  if (Object.keys(projection).some(k => k !== 'generationId' && k !== 'items')) throw Error('catalog_projection_unexpected_fields');
  function* batches() {
    for (let start = 0; start < projection.items!.length; start += PROJECTION_ROWS_PER_PART)
      yield projection.items!.slice(start, start + PROJECTION_ROWS_PER_PART);
  }
  await writeCatalogProjectionBatches(storage, key, String(projection.generationId || ''), batches(), condition);
  return true;
}

export async function* catalogProjectionBatches(storage: JsonStorage, key: string, value: unknown): AsyncGenerator<{generationId:string; items:any[]}> {
  if (!value || typeof value !== 'object') throw Error('catalog_projection_missing');
  if (!isCatalogProjectionPath(key) || !('storageFormat' in value)) {
    const projection = value as {generationId:string;items:any[]};
    if (!Array.isArray(projection.items)) throw Error('catalog_projection_items_invalid');
    yield projection; return;
  }
  const directory = value as Directory;
  if (directory.storageFormat !== FORMAT || !Array.isArray(directory.parts) || !Number.isSafeInteger(directory.count) || directory.count < 0) throw Error('catalog_projection_directory_invalid');
  const base = prefix(directory.generationId, key);
  let expected = 0;
  for (const [index, descriptor] of directory.parts.entries()) {
    if (!/^[a-f0-9]{64}$/.test(descriptor.sha256) || descriptor.path !== `${base}${index}-${descriptor.sha256}.json` || !Number.isSafeInteger(descriptor.count) || descriptor.count <= 0 || descriptor.count > PROJECTION_ROWS_PER_PART) throw Error('catalog_projection_part_descriptor_invalid');
    expected += descriptor.count;
  }
  if (expected !== directory.count) throw Error('catalog_projection_count_mismatch');
  if (!directory.parts.length) yield {generationId:directory.generationId, items:[]};
  // Sequential reads cap resident input to a single part, including validation.
  for (const descriptor of directory.parts) {
    const part = await storage.readJson<{items:any[]}|null>(descriptor.path, null);
    if (!part || !Array.isArray(part.items) || part.items.length !== descriptor.count || digest(part) !== descriptor.sha256) throw Error('catalog_projection_part_integrity_failed');
    yield {generationId:directory.generationId, items:part.items};
  }
}

/** Maintenance callers must use this iterator instead of expanding the root. */
export async function* readCatalogProjectionBatches(storage: JsonStorage, key: string) {
  if (!isCatalogProjectionPath(key) || !storage.getBinary) throw Error('catalog_projection_raw_read_required');
  const raw = JSON.parse((await storage.getBinary(key)).data.toString('utf8'));
  yield* catalogProjectionBatches(storage, key, raw);
}

// Compatibility adapter for search consumers that still need random access.
// It never concatenates serialized JSON; maintenance uses the iterator above.
export async function readCatalogProjectionParts<T>(storage: JsonStorage, key: string, value: T): Promise<T> {
  if (!isCatalogProjectionPath(key) || !value || typeof value !== 'object' || !('storageFormat' in value)) return value;
  const items:unknown[] = [];
  for await (const batch of catalogProjectionBatches(storage, key, value)) for (const row of batch.items) items.push(row);
  return {generationId:(value as unknown as Directory).generationId, items} as T;
}
