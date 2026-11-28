// Inspect eight already saved source pages. No application imports, source
// requests, bucket listing, fallback keys, storage writes or raw row output.
import {createHash, createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MARKER = '.github/market-runs/japan-desc-cache-20261128-readonly.json';
export const OPERATION = 'inspect-japan-desc-cache-20261128';
export const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/japan-desc-cache-20261128-readonly.yml@refs/heads/main';
export const LIMIT = Object.freeze({objects: 8, entriesPerBucket: 4, objectBytes: 256 * 1024,
  totalBytes: 2 * 1024 * 1024, totalMs: 60_000, requestMs: 7_000, outputBytes: 16 * 1024});
const ENDPOINT = 'https://s3.regru.cloud', BUCKET = 'avtocena-staging-8120751';
const PREFIX = 'migration-staging/full-20261011/', REGION = 'us-east-1';

// Derived offline from this exact runtime, with year 2026:
// ajesQuery({table:'stats',powerTo:160,sort:'totalRubDesc',page:1..8,pageSize:24})
// -> ajesSourceCacheSql(sql) -> ajesQueryCacheLocation(cacheSql).
// The normalized cache hash is deliberately different from the wire SQL hash.
// LIST keys have no separate legacy location. Only full hash equality matches.
export const PROFILE = Object.freeze({runtimeSha: 'f83fc7d9983fad8619984128196d5f72eaa292aa',
  failedRunId: '46156308870', table: 'stats', sort: 'totalRubDesc', powerTo: 160, pageSize: 24,
  entries: Object.freeze([
    [1, '126', '8d0d0cfeb6c3d5d2f9436ea2108cc82da8c48942956953c7ddeb09099b6e3ec8'],
    [2, '69', '96f527456d9a590decb505acacdf5cb9e86fe159c55e6a2a48c8e63df6e337ab'],
    [3, '24', 'fa117898064d0ddd99ca4593f9741437c80c372a9c417acbe1f274067dcf589d'],
    [4, '22', 'f4890d9657cb21af79e9809d76910b777667d41dffcfd2358270c830af68bf10'],
    [5, '78', '7347e14e6026409cd35b0ed9f6521295382eb845af165264e4757e06b523be42'],
    [6, '92', '3268a15c3f7b192685a2f718fe3db9f3683184e80aee9192f813b28ca0770abe'],
    [7, '127', 'a23ca17f70f06f194a25dc3130f388218e5f91dded0318813a0dbd07e0df2c55'],
    [8, '56', 'e1b9cd383500be74f38dd296883118969086196e5dbb26f6b40a02196ac02773'],
  ].map(([page, slot, hash]) => Object.freeze({page, hash, key: `catalog/partner-cache/ajes/queries/${slot}.json`})))});
const KEYS = Object.freeze([...new Set(PROFILE.entries.map(entry => entry.key))]);
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const natural = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const isoTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
class AuditError extends Error { constructor(code) { super(code); this.code = code; } }
const need = (value, code) => { if (!value) throw new AuditError(code); };

function emptyAggregate() {
  return {matchedPages: 0, rowOccurrences: 0, supplierPw: {atMost160: 0, over160: 0, unknown: 0},
    priceJpy: {known: 0, unknown: 0, min: null, max: null,
      withinPagePairs: 0, withinPagesDescending: null, adjacentPagePairs: 0, adjacentPagesDescending: null},
    localPowerEvaluated: false};
}
const priceJpy = value => typeof value === 'number' && Number.isFinite(value)
  && value > 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;

// Same strict supplier-PW interpretation as the fixed runtime's
// japan-source-power.ts; this does not perform local enrichment or admission.
function supplierPower(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (text.length > 30 || !/^\d+$/.test(text)) return null;
  const hp = Number(text);
  return Number.isSafeInteger(hp) && hp > 0 ? hp : null;
}

/** In-memory summary only. Ignore all unrequested bucket collisions and all
 * retained entries after the first three, exactly as the deployed cache reader.
 * IDs, images, source evidence, make/model, query text and other fields never
 * become output properties. A missing matching hash is never a zero-row page. */
export function summarizeSavedBucket(saved, expected, aggregate, orderState = {}) {
  need(PROFILE.entries.includes(expected), 'fixed_selector');
  const entries = object(saved) ? [saved, ...(Array.isArray(saved.previous) ? saved.previous.slice(0, 3) : [])] : [];
  const match = entries.find(entry => object(entry) && entry.hash === expected.hash && object(entry.value));
  if (!match) return {page: expected.page, readStatus: 'missing'};
  const value = match.value;
  need(value.page === expected.page && value.pageSize === PROFILE.pageSize
    && isoTime(value.observedAt) && typeof value.stale === 'boolean'
    && (value.partial === undefined || typeof value.partial === 'boolean')
    && Array.isArray(value.items) && value.items.length <= PROFILE.pageSize
    && value.items.every(object) && natural(value.received, PROFILE.pageSize)
    && natural(value.rejected, value.received) && value.items.length + value.rejected === value.received, 'entry_invalid');
  // Commit aggregates only after the entire matched entry passed validation.
  const add = emptyAggregate();
  for (const row of value.items) {
    const hp = supplierPower(row.sourcePower);
    add.supplierPw[hp === null ? 'unknown' : hp <= 160 ? 'atMost160' : 'over160']++;
    const price = priceJpy(row.finalPriceJpy);
    if (price !== null) {
      add.priceJpy.known++;
      add.priceJpy.min = add.priceJpy.min === null ? price : Math.min(add.priceJpy.min, price);
      add.priceJpy.max = add.priceJpy.max === null ? price : Math.max(add.priceJpy.max, price);
    } else add.priceJpy.unknown++;
  }
  aggregate.matchedPages++;
  aggregate.rowOccurrences += value.items.length;
  for (const key of ['atMost160', 'over160', 'unknown']) aggregate.supplierPw[key] += add.supplierPw[key];
  for (const key of ['known', 'unknown']) aggregate.priceJpy[key] += add.priceJpy[key];
  if (add.priceJpy.min !== null) aggregate.priceJpy.min = aggregate.priceJpy.min === null
    ? add.priceJpy.min : Math.min(aggregate.priceJpy.min, add.priceJpy.min);
  if (add.priceJpy.max !== null) aggregate.priceJpy.max = aggregate.priceJpy.max === null
    ? add.priceJpy.max : Math.max(aggregate.priceJpy.max, add.priceJpy.max);
  const prices = value.items.map(row => priceJpy(row.finalPriceJpy));
  for (let index = 1; index < prices.length; index++) if (prices[index - 1] !== null && prices[index] !== null) {
    aggregate.priceJpy.withinPagePairs++;
    aggregate.priceJpy.withinPagesDescending = aggregate.priceJpy.withinPagesDescending !== false
      && prices[index - 1] >= prices[index];
  }
  if (orderState.previous?.page === expected.page - 1 && orderState.previous.last !== null
    && prices.length && prices[0] !== null) {
    aggregate.priceJpy.adjacentPagePairs++;
    aggregate.priceJpy.adjacentPagesDescending = aggregate.priceJpy.adjacentPagesDescending !== false
      && orderState.previous.last >= prices[0];
  }
  orderState.previous = {page: expected.page, last: prices.at(-1) ?? null};
  return {page: expected.page, readStatus: 'matched', observedAt: value.observedAt, stale: value.stale,
    partial: value.partial === true, received: value.received, rejected: value.rejected, rowCount: value.items.length};
}

export function verifyJapanDescCacheInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_ACTIONS === 'true' && environment.GITHUB_EVENT_NAME === 'push'
    && environment.GITHUB_WORKFLOW_REF === WORKFLOW, 'invocation');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER, operation: OPERATION});
}

export async function inspectJapanDescCache(options = {}) {
  need(object(options) && Object.keys(options).every(key => ['env', 'fetcher', 'now'].includes(key)), 'options');
  const {env = process.env, fetcher = globalThis.fetch, now = Date.now} = options;
  need(typeof fetcher === 'function' && typeof now === 'function', 'capabilities');
  const report = {version: 1, kind: 'japan-desc-saved-cache-audit-v1', runtimeSha: PROFILE.runtimeSha,
    failedRunId: PROFILE.failedRunId,
    selection: {table: PROFILE.table, sort: PROFILE.sort, powerTo: PROFILE.powerTo, pageSize: PROFILE.pageSize,
      pages: PROFILE.entries.map(entry => entry.page)},
    attribution: 'exact_cached_query_not_run_identity', freshnessEvaluated: false,
    completed: false, objectGets: 0, acceptedResponseBytes: 0, bucketListings: 0, supplierRequests: 0,
    storageWrites: 0, records: [], aggregate: emptyAggregate()};
  const started = now();
  need(Number.isFinite(started), 'clock');
  const deadline = started + LIMIT.totalMs, totalController = new AbortController();
  const totalTimer = setTimeout(() => totalController.abort(), LIMIT.totalMs);
  async function read(key) {
    need(KEYS.includes(key) && report.objectGets < LIMIT.objects, 'request_scope');
    need(!totalController.signal.aborted && now() < deadline, 'deadline');
    const url = new URL(`${ENDPOINT}/${BUCKET}/${(PREFIX + key).split('/').map(encode).join('/')}`);
    const stamp = new Date(now()).toISOString().replace(/[:-]|\.\d{3}/g, ''), day = stamp.slice(0, 8);
    const scope = `${day}/${REGION}/s3/aws4_request`, payload = hash('');
    const headers = {host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': stamp};
    const names = Object.keys(headers).sort(), canonicalHeaders = names.map(name => `${name}:${headers[name]}\n`).join('');
    const canonical = ['GET', url.pathname, '', canonicalHeaders, names.join(';'), payload].join('\n');
    const signing = hmac(hmac(hmac(hmac('AWS4' + env.REGCLOUD_S3_SECRET_ACCESS_KEY, day), REGION), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signing).update(['AWS4-HMAC-SHA256', stamp, scope, hash(canonical)].join('\n')).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.REGCLOUD_S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
    headers['accept-encoding'] = 'identity';
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, totalController.signal]);
    const timer = setTimeout(() => controller.abort(), Math.min(LIMIT.requestMs, deadline - now()));
    let response, reader, onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(new AuditError('deadline'));
      signal.addEventListener('abort', onAbort, {once: true});
      if (signal.aborted) onAbort();
    });
    const live = () => need(!signal.aborted && now() < deadline, 'deadline');
    try {
      live();
      report.objectGets++;
      response = await Promise.race([Promise.resolve(fetcher(url, {method: 'GET', headers, redirect: 'error', signal}))
        .then(value => { if (signal.aborted) { void value.body?.cancel().catch(() => {}); throw new AuditError('deadline'); } return value; }), interrupted]);
      live();
      if (response.status === 404) return null;
      need(response.status === 200, 'unavailable');
      need(!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity', 'encoding');
      const declared = response.headers.get('content-length');
      need(declared === null || /^\d{1,9}$/.test(declared) && Number(declared) <= LIMIT.objectBytes
        && report.acceptedResponseBytes + Number(declared) <= LIMIT.totalBytes, 'byte_limit');
      reader = response.body?.getReader(); need(reader, 'body_missing');
      const chunks = []; let bytes = 0;
      while (true) {
        live();
        const item = await Promise.race([reader.read(), interrupted]);
        live();
        if (item.done) break;
        need(item.value instanceof Uint8Array && bytes + item.value.byteLength <= LIMIT.objectBytes
          && report.acceptedResponseBytes + item.value.byteLength <= LIMIT.totalBytes, 'byte_limit');
        bytes += item.value.byteLength; report.acceptedResponseBytes += item.value.byteLength; chunks.push(item.value);
      }
      need(declared === null || bytes === Number(declared), 'body_size');
      try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, bytes))); }
      catch { throw new AuditError('body_invalid'); }
    } catch (error) {
      throw error instanceof AuditError ? error : new AuditError('unavailable');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
  }
  try {
    need(typeof env.REGCLOUD_S3_ACCESS_KEY_ID === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(env.REGCLOUD_S3_ACCESS_KEY_ID)
      && typeof env.REGCLOUD_S3_SECRET_ACCESS_KEY === 'string' && env.REGCLOUD_S3_SECRET_ACCESS_KEY.length >= 16
      && env.REGCLOUD_S3_SECRET_ACCESS_KEY.length <= 256, 'configuration_unavailable');
    // A key is fetched once even if multiple fixed hashes share its bucket.
    const buckets = new Map(), orderState = {};
    for (const expected of PROFILE.entries) {
      if (!buckets.has(expected.key)) {
        try { buckets.set(expected.key, {value: await read(expected.key)}); }
        catch (error) { buckets.set(expected.key, {error: error instanceof AuditError ? error.code : 'unavailable'}); }
      }
      const saved = buckets.get(expected.key);
      if (saved.error) { report.records.push({page: expected.page, readStatus: saved.error}); continue; }
      try { report.records.push(summarizeSavedBucket(saved.value, expected, report.aggregate, orderState)); }
      catch { report.records.push({page: expected.page, readStatus: 'entry_invalid'}); }
    }
    report.completed = report.records.length === PROFILE.entries.length
      && report.records.every(record => ['matched', 'missing'].includes(record.readStatus));
  } catch (error) { report.errorCode = error instanceof AuditError ? error.code : 'audit_failed'; }
  finally { clearTimeout(totalTimer); totalController.abort(); }
  need(Buffer.byteLength(JSON.stringify(report)) <= LIMIT.outputBytes, 'output_limit');
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    need(process.argv.length === 3 && ['--verify', '--run'].includes(process.argv[2]), 'arguments');
    // Verification precedes credential access and the only network capability.
    const invocation = verifyJapanDescCacheInvocation();
    if (process.argv[2] === '--verify') process.stdout.write(JSON.stringify({verified: true, invocation}) + '\n');
    else {
      const report = {...await inspectJapanDescCache(), invocation};
      need(Buffer.byteLength(JSON.stringify(report)) <= LIMIT.outputBytes, 'output_limit');
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      if (!report.completed) process.exitCode = 1;
    }
  } catch {
    process.stdout.write(JSON.stringify({version: 1, kind: 'japan-desc-saved-cache-audit-v1', completed: false,
      errorCode: 'invocation_or_audit_failed', supplierRequests: 0, storageWrites: 0}) + '\n');
    process.exitCode = 1;
  }
}
