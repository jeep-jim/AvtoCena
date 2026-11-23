import {createHash} from 'node:crypto';
import type {CatalogMarket} from './types';

export type CatalogImmutableReference = Readonly<{key: string; sha256: string}>;
export type CatalogMarketGenerationReference = Readonly<{
  version: 1; market: CatalogMarket; generationId: string; receipt: CatalogImmutableReference;
}>;
export type CatalogMarketManifestEntry = {
  count: number; chunks: string[]; updatedAt: string; provider?: 'auto_api_encar';
  acceptedGeneration?: CatalogMarketGenerationReference;
};
export type CatalogMarketGenerationReceipt = Readonly<{
  version: 1; kind: 'accepted_market_generation_v1'; market: CatalogMarket; generationId: string;
  entry: Readonly<Omit<CatalogMarketManifestEntry, 'acceptedGeneration'>>;
  references: readonly CatalogImmutableReference[];
  retainedReceipts: readonly CatalogMarketGenerationReference[];
}>;
export type CatalogManifestForMarketReads = {
  generationId: string; markets: Record<string, CatalogMarketManifestEntry>;
};
export type CatalogMarketGenerationRead = Readonly<{
  kind: 'legacy' | 'accepted'; market: string; generationId: string;
  entry: Readonly<Omit<CatalogMarketManifestEntry, 'acceptedGeneration'>>;
  chunkKeys: readonly string[]; receipt: CatalogMarketGenerationReceipt | null;
}>;
export type CatalogReferenceReader = (key: string, fallback: null) => Promise<unknown>;

const GENERATION = /^gen_\d+_[-a-z0-9]+$/;
const SHA = /^[a-f0-9]{64}$/;
const MARKETS = new Set(['japan', 'china', 'korea', 'uae', 'europe', 'georgia']);
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw Error('catalog_market_generation_' + code);
}
export const catalogReferenceDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keys = (value: Record<string, any>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const chunkKey = (generationId: string, market: string, chunk: string) =>
  String(chunk || '').startsWith('catalog/') ? String(chunk) : `catalog/generations/${generationId}/offers/${market}/${chunk}.json`;

export function assertCatalogMarketGenerationReference(value: unknown, market?: string): CatalogMarketGenerationReference {
  check(object(value) && keys(value, ['version', 'market', 'generationId', 'receipt']) && value.version === 1
    && MARKETS.has(value.market) && (!market || value.market === market) && GENERATION.test(value.generationId || ''), 'reference');
  const receipt = value.receipt;
  check(object(receipt) && keys(receipt, ['key', 'sha256']) && SHA.test(receipt.sha256 || '')
    && receipt.key === `catalog/generations/${value.generationId}/market-receipts-v1/${value.market}/${receipt.sha256}.json`, 'receipt_reference');
  return value as CatalogMarketGenerationReference;
}

function immutableObjectKey(key: unknown, market: string): key is string {
  if (typeof key !== 'string' || key.split('/').some(part => !part || part === '.' || part === '..') || /[?#\\\r\n]/.test(key)) return false;
  // Receipts are graph edges, never opaque leaves: GC must follow their refs.
  if (/^catalog\/generations\/gen_\d+_[-a-z0-9]+\/market-receipts-v1\//.test(key)) return false;
  if (/^catalog\/generations\/gen_\d+_[-a-z0-9]+\/.+$/.test(key)) return true;
  return new RegExp('^catalog/runtime-(?:budget|sort)-prices-v3/' + market + '/[a-f0-9]{64}\\.json$').test(key)
    || new RegExp('^catalog/runtime-budget-selections-v1/' + market + '/[a-f0-9]{64}/(?:ready|parts/' + market + '/[a-f0-9]{64})\\.json$').test(key);
}

/** Routing integrity only. Price readiness and its original fingerprint,
 * source order, policy date and createdAt remain the price reader's contract. */
export function assertCatalogMarketGenerationReceipt(value: unknown, reference: CatalogMarketGenerationReference): CatalogMarketGenerationReceipt {
  assertCatalogMarketGenerationReference(reference);
  check(object(value) && keys(value, ['version', 'kind', 'market', 'generationId', 'entry', 'references', 'retainedReceipts'])
    && catalogReferenceDigest(value) === reference.receipt.sha256 && value.version === 1
    && value.kind === 'accepted_market_generation_v1' && value.market === reference.market
    && value.generationId === reference.generationId, 'receipt');
  const entry = value.entry;
  check(object(entry) && keys(entry, ['count', 'chunks', 'updatedAt', 'provider']) && Number.isSafeInteger(entry.count) && entry.count >= 0
    && Array.isArray(entry.chunks) && entry.chunks.every((chunk: unknown) => typeof chunk === 'string' && !!chunk)
    && new Set(entry.chunks).size === entry.chunks.length && typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt))
    && (entry.provider === undefined || entry.provider === 'auto_api_encar')
    && (entry.count === 0 ? entry.chunks.length === 0 : entry.chunks.length > 0), 'entry');
  check(Array.isArray(value.references) && Array.isArray(value.retainedReceipts), 'references');
  const references = new Map<string, string>();
  for (const item of value.references) {
    check(object(item) && keys(item, ['key', 'sha256']) && immutableObjectKey(item.key, value.market) && SHA.test(item.sha256 || '')
      && !references.has(item.key), 'object_reference');
    references.set(item.key, item.sha256);
  }
  const expectedChunk = new RegExp('^catalog/generations/gen_\\d+_[-a-z0-9]+/offers/' + value.market + '/[a-z0-9-]+\\.json$');
  const chunkKeys = entry.chunks.map((chunk: string) => chunkKey(value.generationId, value.market, chunk));
  check(new Set(chunkKeys).size === chunkKeys.length && chunkKeys.every((key: string) => expectedChunk.test(key) && references.has(key)), 'chunk_reference');
  for (const retained of value.retainedReceipts) assertCatalogMarketGenerationReference(retained);
  return value as CatalogMarketGenerationReceipt;
}

export async function readCatalogMarketGenerationReceipt(reference: CatalogMarketGenerationReference, readJson: CatalogReferenceReader) {
  assertCatalogMarketGenerationReference(reference);
  return assertCatalogMarketGenerationReceipt(await readJson(reference.receipt.key, null), reference);
}

/** Absence uses the exact old manifest/chunk rules and performs no receipt IO.
 * A present but invalid/missing descriptor never falls through to another generation. */
export async function resolveCatalogMarketGeneration(manifest: CatalogManifestForMarketReads, market: string,
  readJson: CatalogReferenceReader): Promise<CatalogMarketGenerationRead | null> {
  const current = manifest.markets?.[market]; if (!current) return null;
  if (current.acceptedGeneration === undefined) {
    const {acceptedGeneration, ...entry} = current;
    return {kind: 'legacy', market, generationId: manifest.generationId, entry,
      chunkKeys: (current.chunks || []).map(chunk => chunkKey(manifest.generationId, market, chunk)), receipt: null};
  }
  const reference = assertCatalogMarketGenerationReference(current.acceptedGeneration, market);
  const receipt = await readCatalogMarketGenerationReceipt(reference, readJson), entry = receipt.entry;
  check(current.count === entry.count && current.updatedAt === entry.updatedAt && current.provider === entry.provider
    && Array.isArray(current.chunks) && current.chunks.length === entry.chunks.length
    && current.chunks.every((chunk, index) => chunk === entry.chunks[index]), 'manifest_entry_changed');
  return {kind: 'accepted', market, generationId: receipt.generationId, entry, receipt,
    chunkKeys: entry.chunks.map(chunk => chunkKey(receipt.generationId, market, chunk))};
}

export function assertCatalogMarketGenerationChunk(read: CatalogMarketGenerationRead, key: string, value: unknown): asserts value is Array<{id: string; market: string}> {
  check(read.kind === 'accepted' && read.receipt && read.chunkKeys.includes(key), 'chunk_scope');
  const reference = read.receipt.references.find(item => item.key === key);
  check(reference && Array.isArray(value) && catalogReferenceDigest(value) === reference.sha256
    && value.every(row => object(row) && typeof row.id === 'string' && !!row.id && row.market === read.market), 'chunk');
}

export function assertCatalogMarketGenerationCount(read: CatalogMarketGenerationRead, rows: readonly {id: string}[]) {
  check(rows.length === read.entry.count && new Set(rows.map(row => row.id)).size === rows.length, 'count');
}
