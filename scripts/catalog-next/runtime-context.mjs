import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {calculationVersion} from '../catalog-calculation-version.mjs';
import {signRawGcS3Request} from '../lib/catalog-raw-gc-s3.mjs';

const exec = promisify(execFile);
const MiB = 1024 ** 2, SHA = /^[a-f0-9]{64}$/, REV = /^[a-f0-9]{40}$/;
const sourceId = 'autohome_used_china_open';
const endpoint = 'https://s3.regru.cloud';
const physical = '/avtocena-staging-8120751/migration-staging/full-20261011/';
const mutable = Object.freeze({
  'markets/markets.json': 2 * MiB,
  'fees/exchange-rates.json': 2 * MiB,
  'catalog-editorial/current.json': 8 * MiB,
  'catalog/china-cny-prices/current.json': 64 * MiB,
});
const optional = new Set(['catalog-editorial/current.json', 'catalog/china-cny-prices/current.json']);
const runtimeFiles = Object.freeze([
  'apps/web/lib/data.ts', 'apps/web/lib/business-settings.ts', 'apps/web/lib/effective-market-settings.ts',
  'apps/web/lib/catalog/rates.ts', 'apps/web/lib/catalog/customs-pricing.ts',
  'apps/web/lib/catalog/live-business-pricing.ts', 'apps/web/lib/catalog/market-logistics.ts',
  'apps/web/lib/catalog/city-delivery.ts', 'apps/web/lib/catalog/estimated-market-config.ts',
  'apps/web/lib/catalog/editorial.ts', 'apps/web/lib/catalog/editorial-specifications.ts',
  'apps/web/lib/catalog/china-cny-price.ts', 'apps/web/lib/encyclopedia/calculation-index.ts',
]);
const sourcePaths = ['apps/web/lib', 'packages', 'data', 'scripts', 'package.json', 'package-lock.json',
  'Dockerfile', 'tsconfig.json', 'apps/web/package.json', 'apps/web/tsconfig.json', 'apps/web/next.config.mjs',
  '.github/workflows/deploy-yandex.yml'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw Error('china_runtime_context_' + code); };
const need = (value, code) => { if (!value) fail(code); };
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { fail('invalid_json'); }
}
function scope(key) {
  if (Object.hasOwn(mutable, key)) return mutable[key];
  if (/^knowledge\/encyclopedia\/calculation-releases\/[a-f0-9]{40}\.json$/.test(key)) return 256 * 1024;
  if (/^knowledge\/encyclopedia\/calculation-indexes\/[a-f0-9]{64}\.json$/.test(key)) return 256 * MiB;
  fail('read_scope');
}

/** Optional production transport. Its only methods on the wire are HEAD/GET
 * for the named settings and release-bound encyclopedia; no provider access,
 * redirects, listing, writes, credentials in output, or remote retry loops. */
export function createChinaRuntimeReader({credentials, fetcher = globalThis.fetch}) {
  need(typeof credentials?.accessKeyId === 'string' && credentials.accessKeyId.length > 0 &&
    typeof credentials.secretAccessKey === 'string' && credentials.secretAccessKey.length > 0, 'credentials');
  return async ({method, key, maxBytes}) => {
    const cap = scope(key);
    need(['HEAD', 'GET'].includes(method) && maxBytes === cap, 'read_scope');
    try {
      const signed = signRawGcS3Request({method, host: 's3.regru.cloud', path: physical + key,
        region: 'us-east-1', accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey, at: Date.now()});
      const response = await fetcher(endpoint + signed.canonicalPath, {method, headers: signed.headers,
        redirect: 'error', signal: AbortSignal.timeout(method === 'HEAD' ? 15000 : 60000)});
      if (response.status === 404) { await response.body?.cancel(); return null; }
      const meta = {etag: response.headers.get('etag'), bytes: Number(response.headers.get('content-length')),
        encoding: response.headers.get('content-encoding') || 'identity'};
      need(response.status === 200 && /^"[^"\r\n]{1,128}"$/.test(meta.etag ?? '') &&
        Number.isSafeInteger(meta.bytes) && meta.bytes > 0 && meta.bytes <= cap &&
        ['identity', 'gzip'].includes(meta.encoding), 'object_metadata');
      if (method === 'HEAD') { await response.body?.cancel(); return meta; }
      need(response.body, 'body_missing');
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength; need(bytes <= cap, 'object_size'); chunks.push(Buffer.from(chunk));
      }
      let body = Buffer.concat(chunks, bytes);
      if (meta.encoding === 'identity') need(bytes === meta.bytes, 'body_incomplete');
      else if (body[0] === 0x1f && body[1] === 0x8b) body = gunzipSync(body, {maxOutputLength: cap});
      need(body.length > 0 && body.length <= cap, 'object_size');
      return {...meta, body};
    } catch { fail('transport_refused'); }
  };
}

function selectChinaMarket(value) {
  need(Array.isArray(value), 'markets_shape');
  const rows = value.filter(row => object(row) && row.id === 'china');
  need(rows.length === 1 && Array.isArray(rows[0].versions) && rows[0].versions.every(object), 'china_market_missing_or_invalid');
  // Preserve every saved version and field. Active selection happens later at
  // the FX receipt's pricingAsOf, never at this materializer's wall clock.
  return {body: [rows[0]], effective: [rows[0]]};
}
function selectChinaEditorial(value) {
  if (value === null) return {body: {revision: '0', entries: {}}, effective: {entries: {}}};
  need(object(value) && object(value.entries), 'editorial_shape');
  const entries = {};
  for (const [key, row] of Object.entries(value.entries)) {
    if (!object(row) || row.market !== 'china' || row.sourceId !== sourceId) continue;
    need(key === row.id && typeof row.sourceOfferId === 'string' && /^\d{1,150}$/.test(row.sourceOfferId) &&
      hash(sourceId + ':' + row.sourceOfferId).slice(0, 24) === key, 'china_editorial_identity');
    // Do not reduce edits to the old prepared-reader subset: seller prices,
    // descriptions, photos, specifications and revision evidence are retained.
    entries[key] = row;
  }
  return {body: {revision: typeof value.revision === 'string' ? value.revision : '0', entries}, effective: {entries}};
}
function requiredCurrencies(editorial) {
  const codes = new Set(['CNY', 'USD', 'EUR']);
  for (const row of Object.values(editorial.entries)) {
    if (row.status !== 'visible' || row.sellerPrice == null) continue;
    need(object(row.sellerPrice) && Number.isFinite(row.sellerPrice.amount) && row.sellerPrice.amount > 0 &&
      typeof row.sellerPrice.currency === 'string' && /^[A-Z]{3}$/.test(row.sellerPrice.currency), 'china_editorial_price');
    if (row.sellerPrice.currency !== 'RUB') codes.add(row.sellerPrice.currency);
  }
  return [...codes].sort();
}
function exactDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function selectRates(value, currencies) {
  need(object(value), 'rates_shape');
  const rates = currencies.map(currency => {
    const matches = Array.isArray(value.rates)
      ? value.rates.filter(row => object(row) && String(row.currency).toUpperCase() === currency)
      : object(value[currency]) ? [value[currency]] : [];
    need(matches.length === 1, 'required_rate_missing');
    const row = matches[0], quote = Number(row.cbrRate ?? row.value), nominal = Number(row.nominal);
    need(['cbr', 'cbr_live'].includes(row.rateSource) && Number.isFinite(quote) && quote > 0 &&
      Number.isFinite(nominal) && nominal > 0 && exactDate(row.rateDate || row.date), 'required_rate_invalid');
    return {...row, currency};
  });
  // The global observation timestamp can change when another currency updates.
  // Its captured value is retained; actual quote rows are the stability fence.
  return {body: {...(value.updatedAt === undefined ? {} : {updatedAt: value.updatedAt}), rates}, effective: {rates}};
}
function selectAnchors(value) {
  if (value === null) value = {version: 1, entries: {}};
  need(object(value) && value.version === 1 && object(value.entries), 'anchors_shape');
  return {body: value, effective: value};
}
function project(objects) {
  const market = selectChinaMarket(objects.get('markets/markets.json')?.value);
  const editorial = selectChinaEditorial(objects.get('catalog-editorial/current.json')?.value ?? null);
  const currencies = requiredCurrencies(editorial.body);
  return {currencies, data: new Map([
    ['markets/markets.json', market],
    ['fees/exchange-rates.json', selectRates(objects.get('fees/exchange-rates.json')?.value, currencies)],
    ['catalog-editorial/current.json', editorial],
    ['catalog/china-cny-prices/current.json', selectAnchors(objects.get('catalog/china-cny-prices/current.json')?.value ?? null)],
  ])};
}

/** Prepare only the verified-China pricing inputs. Supported sequence:
 * applyCatalogEditorial -> applyEncyclopediaCalculation -> completeness check
 * -> calculateOfferWithVerifiedSpecifications -> read-only full price batch.
 * This is not a complete search/alias context or the general knowledge fallback.
 * runtimeRoot remains the exact immutable code checkout; this new directory is
 * the worker's cwd so getDataRoot() reads its private, fixed data files.
 * No FX is captured here. sourceObservedAt, capturedAt and future pricingAsOf
 * are independent facts. The caller must supply the independently confirmed
 * encyclopedia binding of the installed runtime; no older-release fallback. */
export async function materializeChinaRuntimeContext({runtimeRoot, runtimeSha, encyclopedia, outputDirectory, readObject}) {
  need(REV.test(runtimeSha ?? '') && REV.test(encyclopedia?.bindingReleaseSha ?? '') &&
    SHA.test(encyclopedia?.expectedIndexDigest ?? '') && typeof readObject === 'function', 'arguments');
  need(path.isAbsolute(runtimeRoot) && path.normalize(runtimeRoot) === runtimeRoot &&
    path.isAbsolute(outputDirectory) && path.normalize(outputDirectory) === outputDirectory &&
    outputDirectory !== runtimeRoot && !outputDirectory.startsWith(runtimeRoot + path.sep), 'workspace_scope');
  const captureStartedAt = new Date().toISOString();
  const git = async args => {
    try { return (await exec('git', args, {cwd: runtimeRoot, maxBuffer: 32 * MiB, encoding: 'buffer'})).stdout; }
    catch { fail('runtime_source_changed'); }
  };
  need(await fs.realpath(runtimeRoot) === runtimeRoot &&
    await fs.realpath(path.dirname(outputDirectory)) === path.dirname(outputDirectory), 'workspace_scope');
  try { await fs.lstat(outputDirectory); fail('output_exists'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const assertRuntime = async () => {
    need((await git(['rev-parse', 'HEAD'])).toString().trim() === runtimeSha, 'runtime_revision');
    await git(['diff', '--quiet', '--no-ext-diff', 'HEAD', '--', ...sourcePaths]);
  };
  await assertRuntime();
  const runtimeInputs = [];
  for (const file of runtimeFiles) {
    const bytes = await git(['show', runtimeSha + ':' + file]);
    need(bytes.length > 0 && bytes.length <= MiB, 'runtime_reader_missing');
    runtimeInputs.push({file, sha256: hash(bytes)});
  }
  let version;
  try { version = calculationVersion(runtimeRoot); } catch { fail('runtime_version'); }
  const read = async (method, key) => {
    const maxBytes = scope(key); let result;
    try { result = await readObject({method, key, maxBytes}); } catch { fail('read_failed'); }
    if (result === null) return null;
    need(object(result) && /^"[^"\r\n]{1,128}"$/.test(result.etag ?? '') &&
      Number.isSafeInteger(result.bytes) && result.bytes > 0 && result.bytes <= maxBytes &&
      ['identity', 'gzip'].includes(result.encoding ?? 'identity'), 'object_metadata');
    if (method === 'HEAD') return result;
    need(Buffer.isBuffer(result.body) && result.body.length > 0 && result.body.length <= maxBytes &&
      (result.encoding === 'gzip' || result.body.length === result.bytes), 'object_size');
    return {...result, sha256: hash(result.body), value: parse(result.body)};
  };
  const sameMeta = (a, b) => a && b && a.etag === b.etag && a.bytes === b.bytes &&
    (a.encoding ?? 'identity') === (b.encoding ?? 'identity');
  const bindingKey = `knowledge/encyclopedia/calculation-releases/${encyclopedia.bindingReleaseSha}.json`;
  const bindingHead = await read('HEAD', bindingKey), binding = await read('GET', bindingKey);
  need(sameMeta(bindingHead, binding), 'encyclopedia_binding_missing_or_changed');
  const indexKey = `knowledge/encyclopedia/calculation-indexes/${encyclopedia.expectedIndexDigest}.json`;
  need(binding.value?.version === 1 && binding.value.release === encyclopedia.bindingReleaseSha &&
    binding.value.digest === encyclopedia.expectedIndexDigest && binding.value.key === indexKey, 'encyclopedia_binding');
  const indexHead = await read('HEAD', indexKey), index = await read('GET', indexKey);
  need(sameMeta(indexHead, index) && index.value?.version === 1 && object(index.value.models) &&
    index.value.digest === encyclopedia.expectedIndexDigest && digest(index.value.models) === encyclopedia.expectedIndexDigest,
    'encyclopedia_index');
  const readMutable = async () => {
    const result = new Map();
    for (const key of Object.keys(mutable)) {
      const value = await read('GET', key);
      need(value !== null || optional.has(key), 'required_object_missing'); result.set(key, value);
    }
    return result;
  };
  const before = await readMutable(), first = project(before);
  const after = await readMutable(), second = project(after);
  for (const [key, value] of first.data)
    need(digest(value.effective) === digest(second.data.get(key).effective), 'china_inputs_changed');
  need(sameMeta(bindingHead, await read('HEAD', bindingKey)) && sameMeta(indexHead, await read('HEAD', indexKey)),
    'encyclopedia_changed');
  await assertRuntime();
  need(calculationVersion(runtimeRoot) === version, 'runtime_source_changed');
  await fs.mkdir(outputDirectory, {mode: 0o700}); let complete = false;
  try {
    const files = [];
    const data = new Map([...first.data].map(([key, value]) => [key, Buffer.from(JSON.stringify(value.body))]));
    data.set('knowledge/encyclopedia/calculation-v1.json', index.body);
    for (const [key, body] of data) {
      const file = 'data/' + key, target = path.join(outputDirectory, file);
      await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
      await fs.writeFile(target, body, {flag: 'wx', mode: 0o600});
      need(hash(await fs.readFile(target)) === hash(body), 'local_readback');
      files.push({file, bytes: body.length, sha256: hash(body)});
    }
    const receipt = {version: 1, kind: 'china-verified-pricing-context-v1', market: 'china',
      runtimeSha, calculationVersion: version, captureStartedAt, capturedAt: new Date().toISOString(),
      encyclopedia: {bindingReleaseSha: encyclopedia.bindingReleaseSha, digest: encyclopedia.expectedIndexDigest,
        bindingSha256: binding.sha256, indexSha256: index.sha256},
      currencies: [...first.currencies, 'RUB'], runtimeInputs,
      objects: [...first.data].map(([key, value]) => ({key, effectiveSha256: digest(value.effective),
        firstSha256: before.get(key)?.sha256 ?? null, recheckedSha256: after.get(key)?.sha256 ?? null,
        sharedObjectChanged: before.get(key)?.sha256 !== after.get(key)?.sha256})),
      files, effectiveInputsRechecked: true, globalAtomicSnapshot: false,
      pricingAsOf: null, fxCaptured: false, searchAliasesIncluded: false,
      storageWrites: 0, supplierRequests: 0, publicationReady: false};
    const body = Buffer.from(JSON.stringify(receipt)), receiptPath = path.join(outputDirectory, 'RUNTIME_CONTEXT.json');
    await fs.writeFile(receiptPath, body, {flag: 'wx', mode: 0o600});
    need(hash(await fs.readFile(receiptPath)) === hash(body), 'receipt_readback');
    complete = true;
    return {receipt, receiptSha256: hash(body), paths: {directory: outputDirectory, receipt: receiptPath,
      data: path.join(outputDirectory, 'data')}};
  } finally { if (!complete) await fs.rm(outputDirectory, {recursive: true, force: true}); }
}
