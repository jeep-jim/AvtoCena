import fs from 'node:fs/promises';
import {createReadStream, statSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {openChinaQueryIndex} from '../../../../scripts/catalog-next/query-index.mjs';
import {openChinaQuerySemantics} from '../../../../scripts/catalog-next/query-semantics.mjs';
import {queryChinaWithPreparedCity} from './china-city-query.mjs';
import {protectedPhotoUrl} from './photo-proxy-policy';
import {PUBLIC_CATALOG_MARKETS} from './runtime-config';
import type {CatalogSearchParams, VehicleOffer} from './types';

const SHA = /^[a-f0-9]{64}$/;
const RELEASE = /^[a-f0-9]{40}$/;
const ID = /^[a-f0-9]{24}$/;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fail = (reason: string): never => { throw Error('china_local_' + reason); };
const need = (value: unknown, reason: string) => { if (!value) fail(reason); };
const stateKey = Symbol.for('avtocena.china.local-generation.v1');
const guardKey = Symbol.for('avtocena.china.local-offer-guards.v1');
const stateStore = globalThis as any;
const guards: WeakMap<object, () => void> = stateStore[guardKey] ||= new WeakMap();
type Identity = {ino: number; dev: number; size: number; mtimeMs: number; ctimeMs: number};
const identity = (name: string): Identity => {
  const s = statSync(name); need(s.isFile(), 'file_type');
  return {ino: s.ino, dev: s.dev, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs};
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function cityLedgerCache() {
  const entries = new Map<string, WeakRef<Record<string, any>>>();
  const owners = new WeakMap<object, Record<string, any>>();
  const collected = new FinalizationRegistry<{id: string; ref: WeakRef<Record<string, any>>}>(({id, ref}) => {
    if (entries.get(id) === ref) entries.delete(id);
  });
  return {
    get: (id: string) => entries.get(id)?.deref(),
    put(id: string, ledger: Record<string, any>) {
      const ref = new WeakRef(ledger); entries.set(id, ref); collected.register(ledger, {id, ref});
    },
    own(row: object, ledger: Record<string, any>) { owners.set(row, ledger); },
    carry(source: object, row: object) { const ledger = owners.get(source); if (ledger) owners.set(row, ledger); },
  };
}

function configured() {
  return {directory: process.env.CATALOG_CHINA_LOCAL_GENERATION_DIR || '',
    manifestSha256: process.env.CATALOG_CHINA_LOCAL_MANIFEST_SHA256 || '', runtimeSha: process.env.CATALOG_CHINA_LOCAL_RUNTIME_SHA || ''};
}
export const chinaLocalRuntimeConfigured = () => Object.values(configured()).some(Boolean);
export const chinaLocalOfferGuard = (offer: object) => guards.get(offer);

async function digestFile(filename: string, expected: {bytes: number; sha256: string}) {
  const stat = await fs.lstat(filename); need(stat.isFile() && !stat.isSymbolicLink(), 'file_type');
  const before = identity(filename), hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename)) { hash.update(chunk); bytes += chunk.length; }
  need(bytes === expected.bytes && hash.digest('hex') === expected.sha256 && same(before, identity(filename)), 'file_checksum');
  return before;
}

async function openGeneration() {
  const config = configured();
  need(path.isAbsolute(config.directory) && SHA.test(config.manifestSha256) && RELEASE.test(config.runtimeSha), 'configuration');
  need(await fs.realpath(config.directory) === config.directory, 'directory');
  const manifestPath = path.join(config.directory, 'GENERATION.json');
  const manifestStat = await fs.lstat(manifestPath); need(manifestStat.isFile() && !manifestStat.isSymbolicLink(), 'manifest_type');
  const manifestIdentity = identity(manifestPath);
  const raw = await fs.readFile(manifestPath);
  need(raw.length <= 1024 * 1024 && sha(raw) === config.manifestSha256 && same(manifestIdentity, identity(manifestPath)), 'manifest_checksum');
  let manifest: any; try { manifest = JSON.parse(raw.toString('utf8')); } catch { fail('manifest_json'); }
  need(manifest?.version === 1 && manifest.kind === 'china-local-generation-v1' && manifest.market === 'china' &&
    manifest.runtimeSha === config.runtimeSha && manifest.cityLedgerCodec === 'gzip-city-map-v1' && manifest.queryIndex?.binding?.generationId === manifest.generationId &&
    manifest.queryIndex?.binding?.filterSemanticsSha256 === manifest.filterSemanticsSha256 && SHA.test(manifest.filterSemanticsSha256), 'manifest');
  const resolve = (descriptor: any, name: string) => {
    need(descriptor?.name === name && Number.isSafeInteger(descriptor.bytes) && descriptor.bytes > 0 && SHA.test(descriptor.sha256), 'file_descriptor');
    return path.join(config.directory, name);
  };
  const queryFile = resolve(manifest.queryIndex.file, 'query.sqlite');
  const detailsFile = resolve(manifest.files?.details, 'details.sqlite');
  const semanticsFile = resolve(manifest.files?.semantics, 'FILTER_SEMANTICS.json');
  const fxFile = resolve(manifest.files?.fx, 'FX_RECEIPT.json');
  const pins = new Map<string, Identity>([[manifestPath, manifestIdentity]]);
  const [detailsIdentity, semanticsIdentity, fxIdentity] = await Promise.all([
    digestFile(detailsFile, manifest.files.details), digestFile(semanticsFile, manifest.files.semantics), digestFile(fxFile, manifest.files.fx),
  ]);
  pins.set(detailsFile, detailsIdentity); pins.set(semanticsFile, semanticsIdentity); pins.set(fxFile, fxIdentity);
  const semanticsBytes = await fs.readFile(semanticsFile);
  need(sha(semanticsBytes) === manifest.files.semantics.sha256, 'semantics_changed');
  let semanticsReceipt: any; try { semanticsReceipt = JSON.parse(semanticsBytes.toString('utf8')); } catch { fail('semantics_json'); }
  const semantics = openChinaQuerySemantics(semanticsReceipt, manifest.filterSemanticsSha256);
  need(same(semantics.cityKeys, manifest.queryIndex.cityKeys), 'cities');
  const fxBytes = await fs.readFile(fxFile);
  need(sha(fxBytes) === manifest.files.fx.sha256, 'fx_changed');
  let fx: any; try { fx = JSON.parse(fxBytes.toString('utf8')); } catch { fail('fx_json'); }
  need(fx?.receipt?.market === 'china' && sha(JSON.stringify(fx.receipt)) === fx.receiptSha256 &&
    fx.receiptSha256 === manifest.pricingReceiptSha256 && manifest.queryIndex.binding.pricingReceiptSha256 === fx.receiptSha256 &&
    fx.receipt.pricingAsOf === manifest.pricingAsOf, 'fx_binding');
  const publicRates = Object.values(fx.receipt.rates as Record<string, any>).map((rate: any) => ({
    currency: String(rate.currency), effectiveRate: Number(rate.effectiveRate), rateDate: String(rate.rateDate), history: [],
  }));
  need(publicRates.every(rate => /^[A-Z]{3}$/.test(rate.currency) && Number.isFinite(rate.effectiveRate) && rate.effectiveRate > 0), 'fx_quotes');
  const assertCurrent = () => {
    need(same(configured(), config), 'generation_changed');
    for (const [name, expected] of pins) need(same(identity(name), expected), 'generation_changed');
  };
  const query = await openChinaQueryIndex({filename: queryFile, manifest: manifest.queryIndex, assertAuthority: assertCurrent});
  pins.set(queryFile, identity(queryFile));
  const details = new DatabaseSync(detailsFile, {readOnly: true, allowExtension: false});
  let cityPriceDb: DatabaseSync;
  try {
    details.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
    need(details.prepare('PRAGMA quick_check').get()?.quick_check === 'ok' &&
      Number(details.prepare('SELECT COUNT(*) n FROM offers').get()?.n) === manifest.queryIndex.rows, 'details_integrity');
    const offer = details.prepare('SELECT full_json,full_sha256,projection_json,projection_sha256 FROM offers WHERE id=?');
    const city = details.prepare('SELECT patches_gzip,patches_sha256 FROM city_ledgers WHERE id=?');
    // The query reader has already verified this exact file's hash, metadata
    // and integrity. A second read-only connection batches only scalar prices
    // for the selected IDs, without changing the producer or its indexes.
    cityPriceDb = new DatabaseSync(queryFile, {readOnly: true, allowExtension: false});
    cityPriceDb.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
    const cityKeys: string[] = manifest.queryIndex.cityKeys;
    const citySet = new Set(cityKeys);
    const cityPricesForIds = (ids: string[]) => {
      assertCurrent();
      need(ids.every(id => ID.test(id)) && new Set(ids).size === ids.length, 'city_price_identity');
      const rowsById = new Map(ids.map(id => [id, new Map<string, number | null>()]));
      if (ids.length) {
        const placeholders = (values: unknown[]) => values.map(() => '?').join(',');
        const rows = cityPriceDb.prepare('SELECT id,city,filter_rub FROM city_prices WHERE city IN (' +
          placeholders(cityKeys) + ') AND id IN (' + placeholders(ids) + ')').all(...cityKeys, ...ids);
        for (const row of rows) {
          const prices = rowsById.get(row.id as string), key = row.city as string;
          need(prices && citySet.has(key) && !prices.has(key), 'city_price_identity');
          prices!.set(key, row.filter_rub as number | null);
        }
      }
      const result = new Map(ids.map(id => {
        const prices = rowsById.get(id)!;
        need(prices.size === cityKeys.length, 'city_price_coverage');
        return [id, Object.fromEntries(prices)] as const;
      }));
      assertCurrent(); return result;
    };
    assertCurrent();
    // Only live returned cards/details retain expanded city ledgers strongly.
    // The generation's lookup is weak, so visiting more cars cannot pin the
    // entire all-city inventory in memory. Collection simply causes a reread.
    const cityLedgers = cityLedgerCache();
    return {config, manifest, query, semantics, details, offer, city, cityLedgers, cityPriceDb, cityPricesForIds, assertCurrent, publicRates};
  } catch (error) { cityPriceDb?.close(); details.close(); query.close(); throw error; }
}

export async function initializeLocalChinaReader() {
  if (!chinaLocalRuntimeConfigured()) return null;
  const key = JSON.stringify(configured());
  const state = stateStore[stateKey];
  if (state) { need(state.key === key, 'generation_changed'); return state.promise as ReturnType<typeof openGeneration>; }
  const promise = openGeneration(); stateStore[stateKey] = {key, promise};
  return promise;
}

function publicProjection(row: any) {
  const {sourceId: _source, sourceGroup: _group, operational: _operational, vin: _vin, frameNumber: _frame, ...value} = row;
  const image = protectedPhotoUrl(String(value.cardImageUrl || ''), 'china');
  return {...value, market: 'china', cardImageUrl: image, status: 'active', offerType: 'fixed', priceMode: value.priceMode || 'fixed',
    calculationStatus: value.calculationStatus || 'needs_data', sourcePrice: value.sourcePrice ?? null, sourceCurrency: value.sourceCurrency ?? null,
    images: image ? [{id: '', url: image, size: 0, mimeType: 'image/jpeg'}] : [],
    firstSeenAt: value.firstSeenAt || value.updatedAt || '', updatedAt: value.updatedAt || value.firstSeenAt || ''};
}

type State = NonNullable<Awaited<ReturnType<typeof initializeLocalChinaReader>>>;
function cityLedger(state: State, id: string) {
  // Only called inside search/detail's fresh cut and file-identity fences.
  const cached = state.cityLedgers.get(id); if (cached) return cached;
  const found = state.city.get(id);
  need(found && found.patches_gzip instanceof Uint8Array, 'city_patch');
  let text: Buffer; try { text = gunzipSync(found!.patches_gzip as Uint8Array, {maxOutputLength: 64 * 1024 * 1024}); } catch { fail('city_patch_gzip'); }
  need(sha(text!) === found!.patches_sha256, 'city_patch_checksum');
  let ledger: Record<string, any>; try { ledger = JSON.parse(text!.toString('utf8')); } catch { fail('city_patch_json'); }
  need(ledger! && typeof ledger! === 'object' && !Array.isArray(ledger!), 'city_patch_json');
  state.assertCurrent(); state.cityLedgers.put(id, ledger!); return ledger!;
}
function cityPatch(state: State, id: string, base: any, cityKey?: string, requestedCity?: string, fullDetails = false) {
  if (!cityKey) return base;
  const ledger = cityLedger(state, id), patch = structuredClone(ledger[cityKey]);
  need(patch && typeof patch.offer === 'object' && typeof patch.snapshot === 'object' &&
    !Object.hasOwn(patch.offer, 'id') && !Object.hasOwn(patch.offer, 'market') && !Object.hasOwn(patch.offer, 'sourcePrice') && !Object.hasOwn(patch.offer, 'sourceCurrency'), 'city_patch_scope');
  const snapshot = {...base.calculationSnapshot, ...patch.snapshot};
  if (patch.breakdownPatch && fullDetails) {
    const lines = new Map((base.calculationSnapshot?.breakdown || []).map((line: any) => [line.id, line]));
    for (const line of patch.breakdownPatch.replace || []) { need(typeof line?.id === 'string', 'city_line'); lines.set(line.id, line); }
    need(Array.isArray(patch.breakdownPatch.order) && patch.breakdownPatch.order.every((id: any) => typeof id === 'string' && lines.has(id)), 'city_line_order');
    snapshot.breakdown = patch.breakdownPatch.order.map((id: string) => lines.get(id));
  }
  if (cityKey === '__unquoted__' && requestedCity && snapshot.deliveryQuote) snapshot.deliveryQuote = {...snapshot.deliveryQuote, city: requestedCity, status: 'needs_quote'};
  const result = {...base, ...patch.offer, deliveryCity: requestedCity || patch.offer.deliveryCity, calculationSnapshot: snapshot};
  state.cityLedgers.own(result, ledger); return result;
}

function mark<T extends object>(state: State, row: T, city?: string, baseRub?: number | null,
  preparedPrices?: Record<string, number | null>, ledgerSource: object = row): T {
  const data = row as any;
  const result = {...row, preparedChinaSelection: {version: 1, generationId: state.manifest.generationId, ...(city ? {city} : {})},
    preparedChinaCityPrices: {version: 1, generationId: state.manifest.generationId, baseRub: baseRub === undefined ? data.totalRub ?? null : baseRub, values: preparedPrices ?? state.query.cityPrices(data.id)}};
  state.cityLedgers.carry(ledgerSource, result); guards.set(result, state.assertCurrent); return result;
}
function checkCut(state: State, expected?: string | null) { if (expected && expected !== state.manifest.generationId) fail('cut_changed'); state.assertCurrent(); }

export async function searchLocalChina(params: CatalogSearchParams, options: {countOnly?: boolean; includeFacets?: boolean; navigationFacets?: boolean; marketPage?: boolean; expectedGeneration?: string | null} = {}) {
  const state = await initializeLocalChinaReader(); if (!state) return null;
  checkCut(state, options.expectedGeneration || params.preparedCut);
  const pageSize = options.marketPage ? 24 : Math.max(1, Math.min(48, Number(params.pageSize) || 24));
  const query = state.semantics.compileRequest({...params, pageSize});
  const cityPricesById = new Map<string, Record<string, number | null>>();
  const result = queryChinaWithPreparedCity(state.query, {...query, countOnly: Boolean(options.countOnly)},
    cityPricesById, state.cityPricesForIds);
  if (cityPricesById.size !== result.items.length) {
    for (const [id, prices] of state.cityPricesForIds(result.items.map((item: any) => item.id))) cityPricesById.set(id, prices);
  }
  const items = result.items.map((item: any) => {
    const projection = cityPatch(state, item.id, item.projection, query.cityKey, params.city);
    if (item.queryRub !== null) need(projection.totalRub === item.queryRub, 'city_query_price');
    return mark(state, publicProjection(projection), params.city, item.projection.totalRub ?? null, cityPricesById.get(item.id), projection);
  });
  const facets = options.includeFacets || options.navigationFacets ? localFacets(state, options.navigationFacets ? {} : query) : undefined;
  state.assertCurrent();
  return {...result, items, usedIndexShards: [], marketCountInfo: {}, ...(facets ? {facets} : {})};
}
function localFacets(state: State, query: any) {
  const value = state.query.facets(query);
  return {...value, makes: [...value.makes], models: value.models.map(({make, model}: any) => ({make, model})),
    bodyTypes: [...value.bodyTypes], fuels: [...value.fuels], transmissions: [...value.transmissions], drives: [...value.drives], markets: [...PUBLIC_CATALOG_MARKETS]};
}
export async function localChinaFacets(params: CatalogSearchParams = {}) {
  const state = await initializeLocalChinaReader(); if (!state) return null;
  return localFacets(state, state.semantics.compileRequest({...params, market: 'china'}));
}
export async function localChinaCounts(params: CatalogSearchParams = {}) {
  const state = await initializeLocalChinaReader(); if (!state) return null;
  return state.query.facets(state.semantics.compileRequest({...params, market: 'china'}));
}
export async function localChinaPublicRates() {
  const state = await initializeLocalChinaReader(); if (!state) return null;
  state.assertCurrent();
  return {rates: state.publicRates.map(rate => ({...rate, history: []})), ratesUpdatedAt: state.manifest.pricingAsOf};
}
export async function readLocalChinaOffer(id: string, city?: string, expectedGeneration?: string) {
  const state = await initializeLocalChinaReader(); if (!state || !ID.test(id)) return null;
  checkCut(state, expectedGeneration);
  const query = state.semantics.compileRequest({market: 'china', city});
  const locator = state.query.get(id, query.cityKey);
  if (!locator) return {offer: null, assertCurrent: state.assertCurrent};
  need(locator.detailLocator?.version === 1 && locator.detailLocator.file === 'details.sqlite' && locator.detailLocator.id === id, 'locator');
  const found = state.offer.get(id);
  need(found && typeof found.full_json === 'string' && sha(found.full_json) === found.full_sha256 && found.full_sha256 === locator.detailLocator.sha256, 'detail_checksum');
  let offer: any; try { offer = JSON.parse(String(found!.full_json)); } catch { fail('detail_json'); }
  need(offer?.id === id && offer.market === 'china', 'detail_identity');
  const baseRub = offer.totalRub ?? null;
  offer = cityPatch(state, id, offer, query.cityKey, city, true);
  if (locator.queryRub !== null) need(offer.totalRub === locator.queryRub, 'detail_price');
  state.assertCurrent();
  return {offer: mark(state, offer, city, baseRub) as VehicleOffer, assertCurrent: state.assertCurrent};
}

export async function resetLocalChinaReaderForTests() {
  const state = stateStore[stateKey]; delete stateStore[stateKey];
  if (state) await state.promise.then((value: any) => { value.query.close(); value.details.close(); value.cityPriceDb.close(); }, () => {});
}
