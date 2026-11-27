import {createHash, randomBytes} from 'node:crypto';
import {signRawGcS3Request} from '../lib/catalog-raw-gc-s3.mjs';
import {privateOwnerAcl, nonGrantingPolicy} from './private-storage.mjs';
import {TARGET, CACHE_PREFIXES, cacheKeyGroup, parseCacheList, parseVersioning,
  runJapanCacheRetention} from './japan-cache-retention-audit.mjs';

export const COMPACTION_LIMITS = Object.freeze({requests: 500, totalMs: 120_000, requestMs: 8000,
  bytes: 32 * 1024 * 1024, writes: 100, listPages: 8, listKeys: 100, checkpointBytes: 64 * 1024,
  detailBytes: 2 * 1024 * 1024, queryBytes: 256 * 1024, metadataBytes: 256 * 1024, reportBytes: 32 * 1024,
  checkpointEvery: 8});
export const CHECKPOINT_KEY = 'catalog/operations/ajes-cache-compaction/v1/checkpoint.json';
const STATE_KEYS = new Set(['accepted', 'intent', 'lease'].map(name => 'catalog/market-rebuild/v1/china/' + name + '.json'));
const DAYS7 = 7 * 86400000;
const SHA = /^[a-f0-9]{64}$/;
const SOURCE = /^[a-f0-9]{40}$/;
const RUN = /^[1-9][0-9]{0,19}$/;
const fail = code => { throw Error('japan_cache_compaction_' + code); };
const need = (value, code) => { if (!value) fail(code); };
const sha = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const tag = value => typeof value === 'string' && /^"[^"\\\x00-\x20\x7f]{1,250}"$/.test(value);
const natural = value => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,15})$/.test(value) && integer(Number(value));
const nullVersion = value => value === null || value === 'null';
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_, digits) => '.' + (digits ?? '').padEnd(3, '0') + 'Z');
const utf8 = bytes => { try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { fail('invalid_utf8'); } };
const POLICY = sha(JSON.stringify({target: TARGET, prefixes: CACHE_PREFIXES, days: 7,
  expiry: 'original-observedAt', action: 'conditional-payload-compaction', schema: 1}));
const ENTRY_ERRORS = new Set(['lease_busy', 'publication_unresolved', 'publication_current_or_rollback_required',
  'publication_changed', 'publication_unavailable', 'publication_stopped'].map(code => 'japan_cache_compaction_entry_' + code));
const safeError = error => ENTRY_ERRORS.has(error?.message) || /^japan_cache_compaction_[a-z_]{1,80}$/.test(error?.message ?? '')
  ? error.message : 'japan_cache_compaction_operation_failed';

/** These are persisted AJ response envelopes, not arbitrary objects carrying a
 * timestamp. Unknown/new schemas are deliberately left for a reviewed reader. */
function snapshot(value, at) {
  const keys = ['schemaVersion', 'items', 'page', 'pageSize', 'received', 'rejected', 'stale', 'observedAt',
    'partial', 'quota', 'sourceEvidence', 'sourceEvidenceById', 'emptyPageEvidence', 'models', 'makes', 'colors', 'total'];
  if (!only(value, keys) || !iso(value.observedAt) || Date.parse(value.observedAt) > at
    || !Array.isArray(value.items) || !integer(value.page) || value.page < 1
    || !integer(value.pageSize, 500) || value.pageSize < 1 || value.items.length > value.pageSize
    || !integer(value.received, 500) || !integer(value.rejected, value.received)
    || value.items.length > value.received || typeof value.stale !== 'boolean'
    || value.items.some(item => !object(item)) || 'partial' in value && typeof value.partial !== 'boolean') return false;
  const aggregate = ['models', 'makes', 'colors'].some(key => Array.isArray(value[key])) || integer(value.total);
  if (value.schemaVersion !== 2 && !(value.schemaVersion === undefined && aggregate)) return false;
  if (aggregate && value.items.length) return false;
  for (const key of ['models', 'makes', 'colors']) if (key in value && (!Array.isArray(value[key]) || value[key].length > 500)) return false;
  if ('total' in value && !integer(value.total)) return false;
  for (const key of ['quota', 'sourceEvidence', 'sourceEvidenceById', 'emptyPageEvidence']) if (key in value && !object(value[key])) return false;
  return true;
}

// JSON.parse validates the document; these small scans only retain the source
// spans of kept values. Re-serializing a fresh payload could otherwise change a
// large numeric literal or escape sequence even though it was not expired.
function rawValues(text, array = false) {
  let position = 0;
  const space = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
  const stringEnd = () => {
    position++;
    while (position < text.length) {
      const char = text[position++]; if (char === '\\') position++;
      else if (char === '"') return;
    }
    fail('payload_shape');
  };
  const valueEnd = () => {
    if (text[position] === '"') { stringEnd(); return; }
    if (text[position] === '[' || text[position] === '{') {
      let depth = 0;
      do {
        const char = text[position];
        if (char === '"') { stringEnd(); continue; }
        if (char === '[' || char === '{') depth++;
        if (char === ']' || char === '}') depth--;
        position++;
      } while (depth && position < text.length);
      need(depth === 0, 'payload_shape'); return;
    }
    while (position < text.length && !/[\s,\]}]/.test(text[position])) position++;
  };
  const result = array ? [] : new Map();
  space(); need(text[position++] === (array ? '[' : '{'), 'payload_shape'); space();
  while (text[position] !== (array ? ']' : '}')) {
    let key;
    if (!array) {
      const start = position; need(text[position] === '"', 'payload_shape'); stringEnd();
      key = JSON.parse(text.slice(start, position)); need(!result.has(key), 'payload_shape');
      space(); need(text[position++] === ':', 'payload_shape'); space();
    }
    const start = position; valueEnd(); const raw = text.slice(start, position);
    if (array) result.push(raw); else result.set(key, raw);
    space(); if (text[position] !== ',') break; position++; space();
  }
  need(text[position++] === (array ? ']' : '}'), 'payload_shape'); space(); need(position === text.length, 'payload_shape');
  return result;
}

/** Pure plan, used only after a bounded GET. Kept values/hashes retain their
 * original JSON values and order; no timestamp, source identity or data is added. */
export function planJapanCachePayload(bytes, group, at) {
  const skip = reason => ({changed: false, reason, expiredEntries: 0, retainedEntries: 0});
  if (!Buffer.isBuffer(bytes) || !['stats', 'main', 'queries'].includes(group) || !integer(at)) return skip('unknown_shape');
  let value, text; try { text = utf8(bytes); value = JSON.parse(text); } catch { return skip('unknown_shape'); }
  if (value === null) return skip('already_null');
  const cutoff = at - DAYS7;
  if (group !== 'queries') {
    try { rawValues(text); } catch { return skip('unknown_shape'); }
    if (!snapshot(value, at) || value.schemaVersion !== 2 || value.page !== 1 || value.pageSize !== 1 || value.items.length > 1)
      return skip('unknown_shape');
    if (Date.parse(value.observedAt) > cutoff) return {...skip('retained'), retainedEntries: 1};
    return {changed: true, body: Buffer.from('null'), expiredEntries: 1, retainedEntries: 0};
  }
  if (!only(value, ['hash', 'value', 'previous']) || !SHA.test(value.hash ?? '') || !object(value.value)
    || 'previous' in value && (!Array.isArray(value.previous) || value.previous.length > 3)) return skip('unknown_shape');
  const entries = [{hash: value.hash, value: value.value}, ...(value.previous ?? [])];
  if (entries.some(row => !exact(row, ['hash', 'value']) || !SHA.test(row.hash ?? '') || !snapshot(row.value, at))
    || new Set(entries.map(row => row.hash)).size !== entries.length) return skip('unknown_shape');
  const retained = entries.filter(row => Date.parse(row.value.observedAt) > cutoff), expiredEntries = entries.length - retained.length;
  if (!expiredEntries) return {...skip('retained'), retainedEntries: retained.length};
  let body;
  try {
    const root = rawValues(text), previous = root.has('previous') ? rawValues(root.get('previous'), true) : [];
    const raw = [root, ...previous.map(row => rawValues(row))];
    for (const row of raw) rawValues(row.get('value'));
    const kept = entries.flatMap((row, index) => Date.parse(row.value.observedAt) > cutoff
      ? ['{"hash":' + raw[index].get('hash') + ',"value":' + raw[index].get('value') + '}'] : []);
    body = Buffer.from(kept.length ? kept[0].slice(0, -1)
      + (kept.length > 1 ? ',"previous":[' + kept.slice(1).join(',') + ']' : '') + '}' : 'null');
  } catch { return skip('unknown_shape'); }
  if (body.length >= bytes.length) return skip('no_reduction');
  return {changed: true, body, expiredEntries, retainedEntries: retained.length};
}

const cursor = value => value === null || typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value);
export function parseJapanCacheCheckpoint(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length <= COMPACTION_LIMITS.checkpointBytes, 'checkpoint_size');
  let value; try { value = JSON.parse(utf8(bytes)); } catch { fail('checkpoint_schema'); }
  need(exact(value, ['version', 'kind', 'policySha256', 'activation', 'cycle', 'cycleStartedAt', 'updatedAt', 'scan'])
    && value.version === 1 && value.kind === 'japan-cache-compaction-cursor-v1' && value.policySha256 === POLICY
    && exact(value.activation, ['controllerSha', 'runId', 'at']) && SOURCE.test(value.activation.controllerSha)
    && RUN.test(value.activation.runId) && iso(value.activation.at) && integer(value.cycle) && value.cycle > 0
    && iso(value.cycleStartedAt) && iso(value.updatedAt), 'checkpoint_schema');
  const scan = value.scan;
  need(exact(scan, ['prefixIndex', 'cursor', 'page']) && integer(scan.prefixIndex, 3) && cursor(scan.cursor), 'checkpoint_schema');
  if (scan.prefixIndex === 3) need(scan.cursor === null && scan.page === null, 'checkpoint_schema');
  if (scan.page !== null) {
    const page = scan.page;
    need(scan.prefixIndex < 3 && exact(page, ['keys', 'position', 'next']) && Array.isArray(page.keys)
      && page.keys.length <= COMPACTION_LIMITS.listKeys && integer(page.position, page.keys.length) && cursor(page.next)
      && (page.next === null || page.next !== scan.cursor)
      && page.keys.every(key => cacheKeyGroup(key) && key.startsWith(CACHE_PREFIXES[scan.prefixIndex]))
      && new Set(page.keys).size === page.keys.length, 'checkpoint_schema');
  }
  return value;
}

/** This single fetch boundary also covers the reused canary and read-only
 * publication fence. It buffers at most one bounded response and never retries. */
function createBoundedFetch({fetcher, now, nonce, invocation}) {
  const started = now(), deadline = started + COMPACTION_LIMITS.totalMs;
  const syntheticKey = 'catalog/operations/ajes-cache-retention-canary/v1/' + invocation.runId + '/1/' + nonce + '.json';
  const counts = {requests: 0, responseBytes: 0, requestBytes: 0, cachePutAttempts: 0, checkpointPutAttempts: 0,
    syntheticPutAttempts: 0, syntheticDeleteAttempts: 0};
  let stopped = false;
  const allowedCache = new Set();
  function scope(input, options) {
    let url; try { url = new URL(input); } catch { fail('request_scope'); }
    need(url.origin === TARGET.endpoint && !url.username && !url.password && !url.hash, 'request_scope');
    const method = options.method ?? 'GET', headers = new Headers(options.headers);
    need(['GET', 'PUT', 'DELETE'].includes(method) && options.redirect === 'error', 'request_scope');
    need(headers.has('authorization') && headers.get('host') === 's3.regru.cloud', 'request_unsigned');
    const query = [...url.searchParams.entries()]; need(new Set(query.map(row => row[0])).size === query.length, 'request_scope');
    const bucket = '/' + TARGET.bucket;
    if (url.pathname === bucket) {
      need(method === 'GET', 'request_scope');
      if (query.length === 1 && ['acl', 'policy', 'versioning', 'lifecycle'].includes(query[0][0]) && query[0][1] === '')
        return {maximum: COMPACTION_LIMITS.metadataBytes};
      need(query.every(([name]) => ['list-type', 'prefix', 'max-keys', 'encoding-type', 'continuation-token'].includes(name))
        && url.searchParams.get('list-type') === '2' && url.searchParams.get('max-keys') === String(COMPACTION_LIMITS.listKeys)
        && url.searchParams.get('encoding-type') === 'url'
        && CACHE_PREFIXES.some(prefix => url.searchParams.get('prefix') === TARGET.prefix + prefix)
        && cursor(url.searchParams.get('continuation-token')), 'request_scope');
      return {maximum: COMPACTION_LIMITS.metadataBytes};
    }
    let physical; try { physical = decodeURIComponent(url.pathname); } catch { fail('request_scope'); }
    need(physical.startsWith(bucket + '/' + TARGET.prefix), 'request_scope');
    const key = physical.slice((bucket + '/' + TARGET.prefix).length);
    if (STATE_KEYS.has(key)) {
      need(method === 'GET' && (!query.length || query.length === 1 && query[0][0] === 'acl' && query[0][1] === ''), 'state_read_only');
      return {maximum: COMPACTION_LIMITS.metadataBytes};
    }
    if (key === syntheticKey) {
      need(!query.length, 'synthetic_current_only');
      if (method === 'PUT') counts.syntheticPutAttempts++;
      if (method === 'DELETE') counts.syntheticDeleteAttempts++;
      return {maximum: method === 'GET' ? 512 : 4096, uploadMaximum: 512};
    }
    need(key === CHECKPOINT_KEY || allowedCache.has(key) && cacheKeyGroup(key), 'request_scope');
    need(method !== 'DELETE' && (!query.length || method === 'GET' && query.length === 1 && query[0][0] === 'acl' && query[0][1] === ''), 'cache_delete_forbidden');
    const maximum = key === CHECKPOINT_KEY ? COMPACTION_LIMITS.checkpointBytes
      : cacheKeyGroup(key) === 'queries' ? COMPACTION_LIMITS.queryBytes : COMPACTION_LIMITS.detailBytes;
    if (method === 'PUT') {
      need(headers.get('x-amz-acl') === 'private' && headers.get('content-type') === 'application/json', 'mutation_headers');
      const condition = headers.get('if-match');
      need(condition !== null && tag('"' + condition + '"') && !condition.includes('"') && !headers.has('if-none-match')
        || key === CHECKPOINT_KEY && condition === null && headers.get('if-none-match') === '*', 'mutation_condition');
      if (key === CHECKPOINT_KEY) counts.checkpointPutAttempts++;
      else { need(counts.cachePutAttempts < COMPACTION_LIMITS.writes, 'write_budget'); counts.cachePutAttempts++; }
    }
    return {maximum: query.length ? COMPACTION_LIMITS.metadataBytes : method === 'PUT' ? 4096 : maximum, uploadMaximum: maximum};
  }
  const boundedFetch = async (input, options = {}) => {
    need(!stopped && now() >= started && now() < deadline && counts.requests < COMPACTION_LIMITS.requests, 'budget_exhausted');
    const {maximum, uploadMaximum} = scope(input, options);
    let upload = 0;
    if (options.body !== undefined) {
      need(typeof options.body === 'string' || Buffer.isBuffer(options.body) || options.body instanceof Uint8Array, 'request_body');
      upload = Buffer.byteLength(options.body); need(upload > 0 && upload <= uploadMaximum, 'request_size');
    }
    need(counts.responseBytes + counts.requestBytes + upload < COMPACTION_LIMITS.bytes, 'budget_exhausted');
    counts.requestBytes += upload; counts.requests++;
    const controller = new AbortController(); let rejectTimeout, response, reader;
    const timeout = new Promise((_resolve, reject) => { rejectTimeout = reject; });
    const stop = () => { controller.abort(); rejectTimeout(Error('japan_cache_compaction_request_timeout')); };
    const timer = setTimeout(stop, Math.max(1, Math.min(COMPACTION_LIMITS.requestMs, deadline - now())));
    const callerAbort = () => stop();
    options.signal?.addEventListener('abort', callerAbort, {once: true});
    const perform = async () => {
      need(!options.signal?.aborted, 'request_timeout');
      response = await fetcher(input, {...options, cache: 'no-store', signal: controller.signal});
      need(!controller.signal.aborted && now() < deadline, 'request_timeout');
      need(!response.redirected && (!response.url || response.url === String(input)), 'response_origin');
      need(!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity', 'response_encoding');
      const declared = response.headers.get('content-length');
      need(declared === null || natural(declared) && Number(declared) <= maximum, 'response_size');
      need(declared === null || counts.responseBytes + counts.requestBytes + Number(declared) <= COMPACTION_LIMITS.bytes, 'budget_exhausted');
      const parts = []; let size = 0;
      if (response.body) {
        reader = response.body.getReader();
        while (true) {
          need(!controller.signal.aborted && now() < deadline, 'request_timeout');
          const row = await reader.read(); if (row.done) break;
          size += row.value.byteLength; counts.responseBytes += row.value.byteLength;
          need(size <= maximum, 'response_size');
          need(counts.responseBytes + counts.requestBytes <= COMPACTION_LIMITS.bytes, 'budget_exhausted');
          parts.push(row.value);
        }
      }
      need(!controller.signal.aborted && now() < deadline && (declared === null || Number(declared) === size), 'response_incomplete');
      return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(parts, size),
        {status: response.status, headers: response.headers});
    };
    try { return await Promise.race([perform(), timeout]); }
    catch (error) { if (error?.message?.startsWith('japan_cache_compaction_')) throw error; fail('storage_transport'); }
    finally { clearTimeout(timer); controller.abort(); options.signal?.removeEventListener('abort', callerAbort);
      if (reader) void reader.cancel().catch(() => {}); else void response?.body?.cancel().catch(() => {}); }
  };
  return {fetcher: boundedFetch, started, allow: key => { need(cacheKeyGroup(key), 'cache_key'); allowedCache.add(key); },
    stop: () => { stopped = true; }, stats: () => ({...counts}),
    available: (requests = 0, bytes = 0, ms = 0) => !stopped && now() >= started && now() + ms < deadline
      && counts.requests + requests <= COMPACTION_LIMITS.requests
      && counts.responseBytes + counts.requestBytes + bytes <= COMPACTION_LIMITS.bytes,
    controlFetch: async (input, options = {}) => {
      const url = new URL(input), base = '/' + TARGET.bucket, decoded = decodeURIComponent(url.pathname);
      const state = decoded.startsWith(base + '/' + TARGET.prefix) && STATE_KEYS.has(decoded.slice((base + '/' + TARGET.prefix).length));
      const bucket = decoded === base && ['acl', 'policy'].some(name => url.searchParams.size === 1 && url.searchParams.get(name) === '');
      need((options.method ?? 'GET') === 'GET' && (state || bucket), 'state_read_only');
      return boundedFetch(input, options);
    }};
}

function createStorage({environment, fetcher, now}) {
  const accessKeyId = environment.REGCLOUD_S3_ACCESS_KEY_ID, secretAccessKey = environment.REGCLOUD_S3_SECRET_ACCESS_KEY;
  need(typeof accessKeyId === 'string' && /^[A-Za-z0-9_+=./-]{1,256}$/.test(accessKeyId)
    && typeof secretAccessKey === 'string' && secretAccessKey.length > 0 && secretAccessKey.length <= 1024
    && !/[\r\n\x00]/.test(secretAccessKey), 'credentials');
  let privacy = null;
  async function request(method, key, query = {}, body, extra = {}) {
    const signed = signRawGcS3Request({method, host: 's3.regru.cloud', path: '/' + TARGET.bucket + (key === null ? '' : '/' + TARGET.prefix + key),
      query, body: body ?? '', headers: {...extra, 'accept-encoding': 'identity'}, region: TARGET.region, accessKeyId, secretAccessKey, at: now()});
    const response = await fetcher(TARGET.endpoint + signed.canonicalPath + (signed.canonicalQuery ? '?' + signed.canonicalQuery : ''),
      {method, headers: signed.headers, ...(body === undefined ? {} : {body}), redirect: 'error'});
    return {status: response.status, body: Buffer.from(await response.arrayBuffer()), etag: response.headers.get('etag'),
      versionId: response.headers.get('x-amz-version-id')};
  }
  return {
    async settings() {
      const acl = await request('GET', null, {acl: ''}); need(acl.status === 200, 'bucket_private');
      let owner; try { owner = privateOwnerAcl(utf8(acl.body)); } catch { fail('bucket_private'); }
      const policy = await request('GET', null, {policy: ''}); let policyHash;
      try { policyHash = nonGrantingPolicy(policy.status, utf8(policy.body)); } catch { fail('bucket_private'); }
      const version = await request('GET', null, {versioning: ''}); need(version.status === 200, 'versioning_unverified');
      let parsed; try { parsed = parseVersioning(version.body); } catch { fail('versioning_unverified'); }
      need(parsed.state === 'never_enabled' && parsed.mfaDelete !== 'enabled', 'versioning_not_never_enabled');
      const current = {owner, policyHash};
      need(privacy === null || privacy.owner === current.owner && privacy.policyHash === current.policyHash, 'bucket_settings_changed'); privacy = current;
      return {privateBucketVerified: true, versioning: 'never_enabled'};
    },
    async read(key) {
      need(privacy, 'bucket_private');
      const acl = await request('GET', key, {acl: ''});
      if (acl.status === 404) return {found: false};
      need(acl.status === 200, 'object_private');
      try { need(privateOwnerAcl(utf8(acl.body)) === privacy.owner, 'object_private'); } catch { fail('object_private'); }
      const result = await request('GET', key);
      if (result.status === 404) return {found: false};
      need(result.status === 200 && tag(result.etag), 'object_read');
      need(nullVersion(result.versionId), 'versioning_changed');
      return {...result, found: true};
    },
    async readback(key) {
      const result = await request('GET', key);
      if (result.status === 404) return {found: false};
      need(result.status === 200 && tag(result.etag), 'object_read');
      need(nullVersion(result.versionId), 'versioning_changed');
      return {...result, found: true};
    },
    async put(key, body, prior) {
      need(privacy && Buffer.isBuffer(body) && (key === CHECKPOINT_KEY || cacheKeyGroup(key)), 'mutation_scope');
      need(prior === null ? key === CHECKPOINT_KEY : tag(prior), 'mutation_condition');
      return request('PUT', key, {}, body, {'content-type': 'application/json', 'x-amz-acl': 'private',
        ...(prior === null ? {'if-none-match': '*'} : {'if-match': prior.slice(1, -1)})});
    },
    async list(prefix, token) {
      const response = await request('GET', null, {'list-type': '2', prefix: TARGET.prefix + prefix,
        'max-keys': String(COMPACTION_LIMITS.listKeys), 'encoding-type': 'url', ...(token === null ? {} : {'continuation-token': token})});
      need(response.status === 200, 'list_failed');
      try { return parseCacheList(response.body, prefix, token); } catch { fail('list_schema'); }
    }
  };
}

/** No supplier capability is accepted here. Actual cache DELETE is rejected at
 * the shared transport; only the existing owned canary may exercise DELETE. */
export async function runJapanCacheCompaction({invocation, environment = process.env, createPublicationFence,
  fetcher = globalThis.fetch, now = Date.now, nonce = randomBytes(24).toString('hex')}) {
  const report = {version: 1, kind: 'japan-cache-compaction-v1', controllerSha: invocation?.sourceSha,
    runId: invocation?.runId, attempt: invocation?.attempt, startedAt: new Date(now()).toISOString(),
    status: 'deferred', completed: false, partial: true, scanCycleCompleted: false, fullInventorySnapshot: false,
    payloadsCompacted: 0, expiredEntriesRemoved: 0, logicalPayloadBytesReduced: 0, reconciledWrites: 0,
    unconfirmedWrites: 0, concurrentChanges: 0, inspectedPayloads: 0, metadataPages: 0, listedObjects: 0,
    skippedUnknownKeys: 0, skippedUnknownPayloads: 0, skippedRetained: 0, skippedNull: 0, inspectionFailures: 0,
    objectKeysDeleted: 0, hostDiskMeasured: false, sourceRequests: 0, rawPayloadsPersistedInReports: false,
    checkpointSaved: false, resumed: false, storage: null, capability: null, publication: null};
  let io, state, checkpointObservation, checkpointSavedPosition = null, publicationFence, storage;
  const persist = async () => {
    state.updatedAt = new Date(now()).toISOString();
    const body = Buffer.from(JSON.stringify(state)); parseJapanCacheCheckpoint(body);
    await publicationFence.beforeMutation(); await storage.settings();
    let result;
    try { result = await storage.put(CHECKPOINT_KEY, body, checkpointObservation.found ? checkpointObservation.etag : null); }
    catch (error) { if (safeError(error).includes('versioning')) throw error; }
    if (result && [409, 412].includes(result.status)) fail('checkpoint_conflict');
    if (result) need(nullVersion(result.versionId), 'versioning_changed');
    const after = await storage.readback(CHECKPOINT_KEY);
    need(after.found && after.body.equals(body) && (!result || ![200, 201].includes(result.status) || !result.etag || result.etag === after.etag), 'checkpoint_unconfirmed');
    checkpointObservation = after; report.checkpointSaved = true; checkpointSavedPosition = JSON.stringify(state.scan);
  };
  try {
    need(SOURCE.test(invocation?.sourceSha ?? '') && RUN.test(invocation?.runId ?? '') && invocation?.attempt === '1'
      && ['push', 'schedule', 'workflow_dispatch'].includes(invocation?.event) && /^[a-f0-9]{48}$/.test(nonce)
      && typeof createPublicationFence === 'function' && typeof fetcher === 'function', 'configuration');
    io = createBoundedFetch({fetcher, now, nonce, invocation});
    storage = createStorage({environment, fetcher: io.fetcher, now});
    report.storage = await storage.settings();
    checkpointObservation = await storage.read(CHECKPOINT_KEY);
    if (!checkpointObservation.found && invocation.event !== 'push') { report.reason = 'not_initialized'; return report; }
    state = checkpointObservation.found ? parseJapanCacheCheckpoint(checkpointObservation.body) : {
      version: 1, kind: 'japan-cache-compaction-cursor-v1', policySha256: POLICY,
      activation: {controllerSha: invocation.sourceSha, runId: invocation.runId, at: report.startedAt},
      cycle: 1, cycleStartedAt: report.startedAt, updatedAt: report.startedAt, scan: {prefixIndex: 0, cursor: null, page: null}};
    report.resumed = checkpointObservation.found;
    need(Date.parse(state.updatedAt) <= io.started && Date.parse(state.activation.at) <= io.started
      && Date.parse(state.cycleStartedAt) <= io.started, 'checkpoint_future');
    publicationFence = await createPublicationFence({fetcher: io.controlFetch, now});
    need(publicationFence && typeof publicationFence.beforeMutation === 'function', 'publication_fence');
    const summary = publicationFence.summary;
    need(exact(summary, ['status', 'currentAndRollbackVerified', 'observationsBound', 'leaseHeld', 'stateMutations'])
      && summary.status === 'resolved_committed' && summary.currentAndRollbackVerified === true
      && summary.observationsBound === true && summary.leaseHeld === false && summary.stateMutations === 0, 'publication_fence');
    report.publication = {status: 'resolved_committed', currentAndRollbackVerified: true,
      observationsBound: true, leaseHeld: false, stateMutations: 0};
    const capability = await runJapanCacheRetention({mode: 'canary', invocation, environment, fetcher: io.fetcher, now, nonce});
    report.capability = {currentObjectConditionalPutVerified: Boolean(capability.canary?.currentObjectConditionalPutVerified),
      currentObjectConditionalDeleteVerified: Boolean(capability.canary?.currentObjectConditionalDeleteVerified),
      conditionalHeaderFormat: capability.canary?.conditionalHeaderFormat === 'bare' ? 'bare' : 'unverified',
      versioningChanged: Boolean(capability.canary?.versioningChanged), residuePossible: Boolean(capability.canary?.residuePossible)};
    need(capability.completed && capability.storage?.privateBucketVerified && capability.storage.versioning?.state === 'never_enabled'
      && report.capability.currentObjectConditionalPutVerified && report.capability.conditionalHeaderFormat === 'bare'
      && !report.capability.versioningChanged && !report.capability.residuePossible, 'conditional_put_unverified');
    if (state.scan.prefixIndex === 3) {
      state.cycle++; state.cycleStartedAt = report.startedAt; state.scan = {prefixIndex: 0, cursor: null, page: null};
    }
    // Save activation/new cycle first. Existing pages are already durable and
    // may be replayed safely: every item is freshly read and conditionally PUT.
    if (!checkpointObservation.found || state.scan.prefixIndex === 0 && state.scan.cursor === null && state.scan.page === null) await persist();
    else checkpointSavedPosition = JSON.stringify(state.scan);
    let sinceCheckpoint = 0, halted = false;
    while (state.scan.prefixIndex < CACHE_PREFIXES.length) {
      if (!io.available(50, COMPACTION_LIMITS.detailBytes + 512 * 1024, COMPACTION_LIMITS.requestMs)
        || io.stats().cachePutAttempts >= COMPACTION_LIMITS.writes) { report.reason = 'bounded_run'; break; }
      if (state.scan.page === null) {
        if (report.metadataPages >= COMPACTION_LIMITS.listPages) { report.reason = 'bounded_pages'; break; }
        const listed = await storage.list(CACHE_PREFIXES[state.scan.prefixIndex], state.scan.cursor);
        report.metadataPages++; report.listedObjects += listed.objects.length;
        const keys = listed.objects.filter(row => cacheKeyGroup(row.key)).map(row => row.key);
        report.skippedUnknownKeys += listed.objects.length - keys.length;
        state.scan.page = {keys, position: 0, next: listed.next};
        await persist(); sinceCheckpoint = 0;
      }
      const page = state.scan.page;
      if (page.position === page.keys.length) {
        if (page.next === null) { state.scan.prefixIndex++; state.scan.cursor = null; }
        else state.scan.cursor = page.next;
        state.scan.page = null; await persist(); sinceCheckpoint = 0; continue;
      }
      const key = page.keys[page.position]; io.allow(key);
      let observed;
      try { observed = await storage.read(key); }
      catch (error) {
        if (/versioning|budget|timeout|settings/.test(safeError(error))) throw error;
        report.inspectionFailures++; page.position++; sinceCheckpoint++;
        if (sinceCheckpoint >= COMPACTION_LIMITS.checkpointEvery) { await persist(); sinceCheckpoint = 0; }
        continue;
      }
      if (!observed.found) report.concurrentChanges++;
      else {
        report.inspectedPayloads++;
        const plan = planJapanCachePayload(observed.body, cacheKeyGroup(key), io.started);
        if (!plan.changed) {
          if (plan.reason === 'already_null') report.skippedNull++;
          else if (plan.reason === 'retained') report.skippedRetained++;
          else report.skippedUnknownPayloads++;
        } else {
          // This check is deliberately repeated for each actual cache write.
          // Runtime may write between it and PUT; bare If-Match is the fence.
          await publicationFence.beforeMutation(); await storage.settings();
          let result, uncertain = false;
          try { result = await storage.put(key, plan.body, observed.etag); }
          catch { uncertain = true; }
          if (result && [409, 412].includes(result.status)) report.concurrentChanges++;
          else {
            if (result) need(nullVersion(result.versionId), 'versioning_changed');
            let after;
            try { after = await storage.readback(key); }
            catch (error) {
              report.unconfirmedWrites++; if (/versioning/.test(safeError(error))) throw error;
              report.reason = 'readback_unconfirmed'; halted = true;
            }
            if (after) {
              if (after.found && after.body.equals(plan.body)
                && (!result || ![200, 201].includes(result.status) || !result.etag || after.etag === result.etag)) {
                report.payloadsCompacted++; report.expiredEntriesRemoved += plan.expiredEntries;
                report.logicalPayloadBytesReduced += observed.body.length - plan.body.length;
                if (uncertain || ![200, 201].includes(result?.status)) report.reconciledWrites++;
              } else report.unconfirmedWrites++;
            }
          }
        }
      }
      if (halted) break; // Leave this position pending for a new bounded GET.
      page.position++; sinceCheckpoint++;
      if (sinceCheckpoint >= COMPACTION_LIMITS.checkpointEvery) { await persist(); sinceCheckpoint = 0; }
    }
    if (JSON.stringify(state.scan) !== checkpointSavedPosition) await persist();
    report.scanCycleCompleted = state.scan.prefixIndex === 3;
    report.status = halted || report.inspectionFailures > 0 ? 'failed' : report.scanCycleCompleted ? 'scan_cycle_complete' : 'bounded_partial';
    report.partial = !report.scanCycleCompleted || report.inspectionFailures > 0 || report.skippedUnknownKeys > 0
      || report.skippedUnknownPayloads > 0 || report.unconfirmedWrites > 0;
    report.completed = !halted && report.inspectionFailures === 0;
  } catch (error) {
    report.errorCode = safeError(error);
    const guarded = ENTRY_ERRORS.has(report.errorCode) || report.errorCode === 'japan_cache_compaction_checkpoint_conflict';
    const exhausted = report.errorCode === 'japan_cache_compaction_budget_exhausted' || io && !io.available(1, 1, 1);
    report.status = exhausted ? 'bounded_partial' : guarded
      ? report.payloadsCompacted || report.checkpointSaved ? 'bounded_partial' : 'deferred' : 'failed';
    if (exhausted) report.reason = 'bounded_run';
    report.partial = true;
    // The last acknowledged checkpoint stays authoritative. Re-reading a page
    // after a lost checkpoint acknowledgement cannot erase a fresh response.
  } finally {
    if (io) { report.requests = io.stats(); io.stop(); }
    else report.requests = {requests: 0, responseBytes: 0, requestBytes: 0, cachePutAttempts: 0,
      checkpointPutAttempts: 0, syntheticPutAttempts: 0, syntheticDeleteAttempts: 0};
    report.finishedAt = new Date(now()).toISOString();
    need(Buffer.byteLength(JSON.stringify(report)) <= COMPACTION_LIMITS.reportBytes, 'report_size');
  }
  return report;
}
