import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {signRawGcS3Request, signSyntheticS3DeleteRequest} from '../lib/catalog-raw-gc-s3.mjs';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {privateOwnerAcl, nonGrantingPolicy} from './private-storage.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TARGET = Object.freeze({endpoint: 'https://s3.regru.cloud', bucket: 'avtocena-staging-8120751',
  prefix: 'migration-staging/full-20261011/', region: 'us-east-1'});
export const CACHE_PREFIXES = Object.freeze(['stats', 'main', 'queries'].map(name => 'catalog/partner-cache/ajes/' + name + '/'));
export const LIMITS = Object.freeze({requests: 32, listPagesPerPrefix: 2, listKeys: 100, inspections: 8,
  xmlBytes: 256 * 1024, detailBytes: 2 * 1024 * 1024, queryBytes: 256 * 1024, totalBytes: 20 * 1024 * 1024,
  reportBytes: 32 * 1024, totalMs: 120_000, requestMs: 8000, canaryBytes: 512});
const DAYS7 = 7 * 86400000;
const HASH = /^[a-f0-9]{64}$/;
const need = (value, code) => { if (!value) throw Error('japan_cache_audit_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const safeError = error => /^japan_cache_audit_[a-z_]{1,80}$/.test(error?.message ?? '') ? error.message : 'japan_cache_audit_failed';
const natural = value => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,15})$/.test(value) && Number.isSafeInteger(Number(value));
const etag = value => typeof value === 'string' && /^"[^"\\\x00-\x20\x7f]{1,250}"$/.test(value);
const immutableVersion = value => typeof value === 'string' && value !== 'null' && /^[\x21-\x7e]{1,1024}$/.test(value);
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_, digits) => '.' + (digits ?? '').padEnd(3, '0') + 'Z');
const modified = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const utf8 = bytes => { try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { throw Error('japan_cache_audit_utf8'); } };

/** Small XML tree with no DTD, custom entities, comments, CDATA or mixed text. */
export function parseAuditXml(text) {
  need(typeof text === 'string' && Buffer.byteLength(text) <= LIMITS.xmlBytes, 'xml_size');
  text = text.replace(/^\uFEFF/, '').replace(/^<\?xml\s+version=['"]1\.0['"](?:\s+encoding=['"]UTF-8['"])?\s*\?>\s*/i, '');
  need(!/<[!?]/.test(text) && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text), 'xml_declaration');
  const document = {name: '', children: [], text: ''}, stack = [document];
  const tokens = text.match(/<[^>]*>|[^<]+/g) ?? []; let nodes = 0;
  need(tokens.join('') === text && tokens.length <= 16000, 'xml_tokens');
  const decode = value => {
    need(!/&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/.test(value), 'xml_entity');
    return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity) => {
      if (!entity.startsWith('#')) return {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[entity];
      const n = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      need(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff), 'xml_entity');
      return String.fromCodePoint(n);
    });
  };
  for (const token of tokens) {
    if (!token.startsWith('<')) { stack.at(-1).text += decode(token); continue; }
    const close = /^<\/([A-Za-z][A-Za-z0-9]*)\s*>$/.exec(token);
    if (close) {
      need(stack.length > 1 && stack.at(-1).name === close[1]
        && (!stack.at(-1).children.length || !stack.at(-1).text.trim()), 'xml_close');
      stack.pop(); continue;
    }
    const open = /^<([A-Za-z][A-Za-z0-9]*)(\s+xmlns=['"]https?:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/['"])?\s*(\/?)>$/.exec(token);
    need(open && (!open[2] || stack.length === 1) && ++nodes <= 6000 && stack.length <= 9, 'xml_node');
    const node = {name: open[1], children: [], text: ''}; stack.at(-1).children.push(node);
    if (!open[3]) stack.push(node);
  }
  need(stack.length === 1 && document.children.length === 1 && !document.text.trim(), 'xml_document');
  return document.children[0];
}
const children = (node, name) => node.children.filter(row => row.name === name);
function one(node, name, optional = false) {
  const values = children(node, name); need(values.length === 1 || optional && values.length === 0, 'xml_field'); return values[0] ?? null;
}
function scalar(node, name, optional = false) {
  const value = one(node, name, optional); need(!value || !value.children.length, 'xml_scalar'); return value?.text ?? null;
}
function fields(node, allowed) { need(node.children.every(row => allowed.includes(row.name)), 'xml_schema'); }
function serviceError(bytes, code) {
  const node = parseAuditXml(utf8(bytes)); return node.name === 'Error' && scalar(node, 'Code') === code;
}

export function parseVersioning(bytes) {
  const root = parseAuditXml(utf8(bytes)); need(root.name === 'VersioningConfiguration', 'versioning_schema');
  fields(root, ['Status', 'MfaDelete']);
  const status = scalar(root, 'Status', true), mfa = scalar(root, 'MfaDelete', true);
  need(status === null || ['Enabled', 'Suspended'].includes(status), 'versioning_state');
  need(mfa === null || ['Enabled', 'Disabled'].includes(mfa), 'versioning_mfa');
  return {state: status === null ? 'never_enabled' : status.toLowerCase(), mfaDelete: mfa === null ? 'not_reported' : mfa.toLowerCase()};
}

/** Project only matching-rule semantics, never rule IDs, tag values or unrelated prefixes. */
export function summarizeLifecycle(bytes, status) {
  if (status === 404 && serviceError(bytes, 'NoSuchLifecycleConfiguration')) return {state: 'absent', totalRules: 0, matchingRules: 0, rules: [], limited: false};
  need(status === 200, 'lifecycle_http');
  const root = parseAuditXml(utf8(bytes)); need(root.name === 'LifecycleConfiguration', 'lifecycle_schema'); fields(root, ['Rule']);
  const rules = children(root, 'Rule'); need(rules.length <= 1000, 'lifecycle_rules'); const matched = [];
  for (const rule of rules) {
    const state = scalar(rule, 'Status'); need(['Enabled', 'Disabled'].includes(state), 'lifecycle_status');
    const filter = one(rule, 'Filter', true), legacyPrefix = scalar(rule, 'Prefix', true);
    need(!(filter && legacyPrefix !== null), 'lifecycle_filter');
    const and = filter && one(filter, 'And', true); need(!and || filter.children.length === 1, 'lifecycle_filter');
    const constraints = and ?? filter;
    const prefix = legacyPrefix ?? (constraints ? scalar(constraints, 'Prefix', true) : null) ?? '';
    const coverage = CACHE_PREFIXES.flatMap((group, index) => {
      const physical = TARGET.prefix + group;
      return physical.startsWith(prefix) ? [{group: ['stats', 'main', 'queries'][index], coverage: 'whole_prefix'}]
        : prefix.startsWith(physical) ? [{group: ['stats', 'main', 'queries'][index], coverage: 'partial_prefix'}] : [];
    });
    if (!coverage.length) continue;
    const expiration = one(rule, 'Expiration', true), noncurrent = one(rule, 'NoncurrentVersionExpiration', true);
    const days = expiration && scalar(expiration, 'Days', true), date = expiration && scalar(expiration, 'Date', true);
    const noncurrentDays = noncurrent && scalar(noncurrent, 'NoncurrentDays', true);
    const newer = noncurrent && scalar(noncurrent, 'NewerNoncurrentVersions', true);
    const marker = expiration && scalar(expiration, 'ExpiredObjectDeleteMarker', true);
    for (const value of [days, noncurrentDays, newer]) need(value === null || natural(value) && Number(value) > 0, 'lifecycle_days');
    need(date === null || iso(date), 'lifecycle_date'); need(marker === null || ['true', 'false'].includes(marker), 'lifecycle_marker');
    need(!(days !== null && date !== null), 'lifecycle_expiration');
    matched.push({enabled: state === 'Enabled', coverage,
      additionalFilter: Boolean(constraints?.children.some(row => row.name !== 'Prefix')),
      currentExpirationDays: days === null ? null : Number(days), currentExpirationDate: date,
      noncurrentExpirationDays: noncurrentDays === null ? null : Number(noncurrentDays),
      newerNoncurrentVersions: newer === null ? null : Number(newer), expiredDeleteMarker: marker === 'true',
      transitionPresent: children(rule, 'Transition').length > 0 || children(rule, 'NoncurrentVersionTransition').length > 0,
      unclassifiedRuleFields: rule.children.some(row => !['ID', 'Status', 'Prefix', 'Filter', 'Expiration', 'NoncurrentVersionExpiration',
        'Transition', 'NoncurrentVersionTransition', 'AbortIncompleteMultipartUpload'].includes(row.name))
        || Boolean(expiration?.children.some(row => !['Days', 'Date', 'ExpiredObjectDeleteMarker'].includes(row.name)))
        || Boolean(noncurrent?.children.some(row => !['NoncurrentDays', 'NewerNoncurrentVersions'].includes(row.name)))});
  }
  return {state: 'configured', documentSha256: hash(bytes), totalRules: rules.length, matchingRules: matched.length,
    rules: matched.slice(0, 50), limited: matched.length > 50};
}

export function cacheKeyGroup(key) {
  if (typeof key !== 'string') return null;
  const detail = /^catalog\/partner-cache\/ajes\/(stats|main)\/[A-Za-z0-9_-]{1,64}\.json$/.exec(key);
  if (detail) return detail[1];
  const relative = key.startsWith(CACHE_PREFIXES[2]) ? key.slice(CACHE_PREFIXES[2].length) : '';
  if (['counts/overall.json', 'directories/makes-overall.json'].includes(relative)) return 'queries';
  const slot = /^(?:(?:counts\/)|(?:directories\/(?:makes|models)-))?(0|[1-9][0-9]{0,2})\.json$/.exec(relative);
  return slot && Number(slot[1]) < 128 ? 'queries' : null;
}

export function parseCacheList(bytes, prefix, cursor = null) {
  need(CACHE_PREFIXES.includes(prefix), 'list_prefix');
  const root = parseAuditXml(utf8(bytes)); need(root.name === 'ListBucketResult', 'list_schema');
  fields(root, ['Name', 'Prefix', 'MaxKeys', 'KeyCount', 'IsTruncated', 'Contents', 'ContinuationToken', 'NextContinuationToken', 'EncodingType', 'Delimiter', 'StartAfter']);
  need(scalar(root, 'Name') === TARGET.bucket && scalar(root, 'MaxKeys') === String(LIMITS.listKeys), 'list_binding');
  const encoding = scalar(root, 'EncodingType', true); need(encoding === 'url' || encoding === null, 'list_encoding');
  const decode = value => { try { return encoding === 'url' ? decodeURIComponent(value) : value; } catch { throw Error('japan_cache_audit_list_encoding'); } };
  need(decode(scalar(root, 'Prefix')) === TARGET.prefix + prefix, 'list_binding');
  for (const field of ['Delimiter', 'StartAfter']) need([null, ''].includes(scalar(root, field, true)), 'list_parameter');
  const echoed = scalar(root, 'ContinuationToken', true); need(echoed === null || echoed === cursor, 'list_cursor');
  const truncated = scalar(root, 'IsTruncated'); need(['true', 'false'].includes(truncated), 'list_truncated');
  const next = scalar(root, 'NextContinuationToken', true);
  need(truncated === 'true' ? typeof next === 'string' && next.length > 0 && next.length <= 4096 && next !== cursor : next === null, 'list_cursor');
  const objects = children(root, 'Contents').map(row => {
    fields(row, ['Key', 'Size', 'LastModified', 'ETag', 'StorageClass', 'Owner', 'ChecksumAlgorithm', 'ChecksumType', 'Type']);
    need([null, 'Normal'].includes(scalar(row, 'Type', true)), 'list_type');
    const full = decode(scalar(row, 'Key')), size = scalar(row, 'Size'), at = scalar(row, 'LastModified'), tag = scalar(row, 'ETag');
    need(full.startsWith(TARGET.prefix + prefix) && full.length <= 1024 && !/[\x00-\x1f\x7f]/.test(full)
      && natural(size) && iso(at) && etag(tag), 'list_object');
    return {key: full.slice(TARGET.prefix.length), size: Number(size), lastModified: at, etag: tag};
  });
  need(objects.length <= LIMITS.listKeys && new Set(objects.map(row => row.key)).size === objects.length, 'list_count');
  const count = scalar(root, 'KeyCount', true); need(count === null || natural(count) && Number(count) === objects.length, 'list_count');
  return {objects, truncated: truncated === 'true', next};
}

/** No source values or vehicle identity leave this in-memory inspection. */
export function inspectCachePayload(bytes, group, cutoff) {
  let value; try { value = JSON.parse(utf8(bytes)); } catch { return {snapshots: 0, expired: 0, retained: 0, invalid: 1}; }
  const snapshots = group === 'queries' ? [value, ...(Array.isArray(value?.previous) ? value.previous.slice(0, 3) : [])]
    .map(row => row && HASH.test(row.hash ?? '') ? row.value : undefined) : [value];
  const result = {snapshots: snapshots.length, expired: 0, retained: 0, invalid: 0};
  for (const row of snapshots) {
    if (!row || typeof row !== 'object' || !iso(row.observedAt) || !Array.isArray(row.items)
      || Date.parse(row.observedAt) > cutoff + DAYS7) result.invalid++;
    else if (Date.parse(row.observedAt) <= cutoff) result.expired++;
    else result.retained++;
  }
  return result;
}

/** The sole network capability. Actual cache keys have GET only. Synthetic
 * mutation methods take no key argument and can address only this run's nonce. */
export function createJapanCacheAuditStorage({mode, owner, environment = process.env, fetcher = globalThis.fetch,
  now = Date.now, nonce = randomBytes(24).toString('hex')}) {
  need(['audit', 'canary'].includes(mode) && /^[1-9][0-9]{0,19}$/.test(owner?.runId ?? '') && owner?.attempt === '1'
    && /^[a-f0-9]{40}$/.test(owner?.revision ?? '') && /^[a-f0-9]{48}$/.test(nonce), 'configuration');
  const accessKeyId = environment.REGCLOUD_S3_ACCESS_KEY_ID, secretAccessKey = environment.REGCLOUD_S3_SECRET_ACCESS_KEY;
  need(typeof accessKeyId === 'string' && /^[A-Za-z0-9_+=./-]{1,256}$/.test(accessKeyId)
    && typeof secretAccessKey === 'string' && secretAccessKey.length > 0 && secretAccessKey.length <= 1024
    && !/[\r\n\x00]/.test(secretAccessKey), 'credentials');
  const started = now(), deadline = started + LIMITS.totalMs, cutoff = started - DAYS7;
  const key = 'catalog/operations/ajes-cache-retention-canary/v1/' + owner.runId + '/1/' + nonce + '.json';
  const known = new Map(), versions = new Map(), listed = new Map(), cursors = new Map();
  let privacy = false, versioning = null, created = false, puts = 0;
  const counters = {requests: 0, responseBytes: 0, metadataPages: 0, bodyInspections: 0, syntheticPuts: 0, syntheticDeletes: 0};
  const bodies = [1, 2].map(sequence => Buffer.from(JSON.stringify({kind: 'japan-cache-conditional-delete-canary-v1',
    run: owner.runId, attempt: 1, nonce, sequence})));
  need(bodies.every(body => body.length <= LIMITS.canaryBytes), 'canary_size');
  async function request(method, logicalKey, query = {}, body, headers = {}, maximum = LIMITS.xmlBytes) {
    need(now() < deadline && counters.requests < LIMITS.requests, 'request_budget');
    need(['GET', 'HEAD', 'PUT', 'DELETE'].includes(method), 'method');
    if (method === 'PUT' || method === 'DELETE') need(mode === 'canary' && logicalKey === key && privacy && versioning, 'mutation_scope');
    else need(logicalKey === null || logicalKey === key && mode === 'canary' || listed.has(logicalKey), 'read_scope');
    need(maximum > 0 && maximum <= LIMITS.detailBytes, 'body_bound');
    const physical = '/' + TARGET.bucket + (logicalKey === null ? '' : '/' + TARGET.prefix + logicalKey);
    const signer = method === 'DELETE' ? signSyntheticS3DeleteRequest : signRawGcS3Request;
    const signed = signer({method, host: 's3.regru.cloud', path: physical, query, body: body ?? '',
      headers: {...headers, 'accept-encoding': 'identity'}, region: TARGET.region, accessKeyId, secretAccessKey, at: now()});
    const url = TARGET.endpoint + signed.canonicalPath + (signed.canonicalQuery ? '?' + signed.canonicalQuery : '');
    const controller = new AbortController(); let rejectDeadline;
    const expired = new Promise((_resolve, reject) => { rejectDeadline = reject; });
    const timer = setTimeout(() => { controller.abort(); rejectDeadline(Error('japan_cache_audit_deadline')); }, Math.max(1, Math.min(LIMITS.requestMs, deadline - now())));
    let response, reader; counters.requests++;
    if (method === 'PUT') counters.syntheticPuts++;
    if (method === 'DELETE') counters.syntheticDeletes++;
    const perform = async () => {
      response = await fetcher(url, {method, headers: signed.headers, ...(body === undefined ? {} : {body}), redirect: 'error',
        cache: 'no-store', signal: controller.signal});
      need(!controller.signal.aborted && now() < deadline, 'deadline');
      need(!response.redirected && (!response.url || response.url === url), 'response_origin');
      need(!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity', 'response_encoding');
      const length = response.headers.get('content-length');
      need(length === null || natural(length) && Number(length) <= maximum, 'response_size');
      const chunks = []; let bytes = 0;
      if (response.body) {
        reader = response.body.getReader();
        while (true) {
          need(!controller.signal.aborted && now() < deadline, 'deadline');
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength; counters.responseBytes += part.value.byteLength;
          need(bytes <= maximum && counters.responseBytes <= LIMITS.totalBytes, 'response_size'); chunks.push(part.value);
        }
      }
      need(!controller.signal.aborted && now() < deadline, 'deadline');
      need(method === 'HEAD' || length === null || bytes === Number(length), 'response_length');
      return {status: response.status, data: Buffer.concat(chunks, bytes), etag: response.headers.get('etag'),
        versionId: response.headers.get('x-amz-version-id'), deleteMarker: response.headers.get('x-amz-delete-marker'),
        lastModified: modified(response.headers.get('last-modified'))};
    };
    try {
      return await Promise.race([perform(), expired]);
    } catch (error) {
      if (controller.signal.aborted || now() >= deadline) throw Error('japan_cache_audit_deadline');
      throw Error(safeError(error));
    } finally {
      clearTimeout(timer); controller.abort();
      if (reader) void reader.cancel().catch(() => {}); else void response?.body?.cancel().catch(() => {});
    }
  }
  const remember = (result, sequence) => {
    need(result.status === 200 && result.data.equals(bodies[sequence - 1]) && etag(result.etag), 'canary_readback');
    need(versioning.state === 'enabled' ? immutableVersion(result.versionId) : result.versionId === null || result.versionId === 'null', 'canary_version_changed');
    const value = Object.freeze({sequence, etag: result.etag, versionId: immutableVersion(result.versionId) ? result.versionId : null});
    known.set(sequence, value); if (value.versionId) versions.set(value.versionId, value); return value;
  };
  return Object.freeze({cutoff, syntheticKey: key, stats: () => ({...counters}),
    async settings() {
      const acl = await request('GET', null, {acl: ''}); need(acl.status === 200, 'bucket_acl');
      try { privateOwnerAcl(utf8(acl.data)); } catch { throw Error('japan_cache_audit_bucket_acl'); }
      const policy = await request('GET', null, {policy: ''});
      try { nonGrantingPolicy(policy.status, utf8(policy.data)); } catch { throw Error('japan_cache_audit_bucket_policy'); }
      privacy = true;
      const version = await request('GET', null, {versioning: ''}); need(version.status === 200, 'versioning_http');
      versioning = parseVersioning(version.data);
      const lifecycle = await request('GET', null, {lifecycle: ''});
      return {privateBucketVerified: true, versioning, lifecycle: summarizeLifecycle(lifecycle.data, lifecycle.status)};
    },
    async list(prefix, cursor = null) {
      need(mode === 'audit' && privacy && versioning && CACHE_PREFIXES.includes(prefix), 'list_scope');
      const history = cursors.get(prefix) ?? [];
      need(history.length < LIMITS.listPagesPerPrefix && (history.length === 0 ? cursor === null : history.at(-1) !== null && cursor === history.at(-1)), 'list_budget');
      const response = await request('GET', null, {'list-type': '2', prefix: TARGET.prefix + prefix,
        'max-keys': String(LIMITS.listKeys), 'encoding-type': 'url', ...(cursor === null ? {} : {'continuation-token': cursor})});
      need(response.status === 200, 'list_http'); const result = parseCacheList(response.data, prefix, cursor);
      history.push(result.next); cursors.set(prefix, history); counters.metadataPages++;
      for (const row of result.objects) { need(!listed.has(row.key), 'list_repeated'); Object.freeze(row); listed.set(row.key, row); }
      return result;
    },
    async inspect(object) {
      need(mode === 'audit' && listed.get(object?.key) === object && cacheKeyGroup(object.key)
        && Date.parse(object.lastModified) <= cutoff && counters.bodyInspections < LIMITS.inspections, 'inspection_scope');
      const group = cacheKeyGroup(object.key), maximum = group === 'queries' ? LIMITS.queryBytes : LIMITS.detailBytes;
      need(object.size > 0 && object.size <= maximum, 'inspection_size'); counters.bodyInspections++;
      const response = await request('GET', object.key, {}, undefined, {'if-match': object.etag}, maximum);
      if ([404, 409, 412].includes(response.status)) return {changed: true};
      need(response.status === 200, 'inspection_http');
      if (response.etag !== object.etag || response.data.length !== object.size || !response.lastModified
        || Date.parse(response.lastModified) > cutoff) return {changed: true};
      return {changed: false, ...inspectCachePayload(response.data, group, cutoff)};
    },
    async createCanary() {
      need(mode === 'canary' && privacy && versioning && !created && puts === 0 && versioning.mfaDelete !== 'enabled', 'canary_create_scope');
      // Suspended buckets reuse the mutable null version. Do not create debris
      // when the requested immutable version fence cannot be demonstrated.
      need(versioning.state !== 'suspended', 'canary_suspended'); puts++; created = true;
      const result = await request('PUT', key, {}, bodies[0], {'content-type': 'application/json', 'x-amz-acl': 'private', 'if-none-match': '*'}, 4096);
      need([200, 201].includes(result.status), 'canary_create');
      return remember(await request('GET', key, {}, undefined, {}, LIMITS.canaryBytes), 1);
    },
    async updateCanary(first) {
      need(created && puts === 1 && known.get(1) === first, 'canary_update_scope'); puts++;
      const result = await request('PUT', key, {}, bodies[1], {'content-type': 'application/json', 'x-amz-acl': 'private',
        'if-match': first.etag.slice(1, -1)}, 4096);
      need([200, 201].includes(result.status), 'canary_update');
      const second = remember(await request('GET', key, {}, undefined, {}, LIMITS.canaryBytes), 2);
      need(second.etag !== first.etag, 'canary_etag_unchanged');
      return second;
    },
    async readCanary(value) {
      need(created && known.get(value?.sequence) === value, 'canary_read_scope');
      const query = versioning.state === 'enabled' ? (need(value.versionId && versions.get(value.versionId) === value, 'canary_version_fence'), {versionId: value.versionId}) : {};
      const result = await request('GET', key, query, undefined, {}, LIMITS.canaryBytes);
      need(versioning.state === 'enabled' ? result.status === 404 || result.versionId === value.versionId
        : result.versionId === null || result.versionId === 'null', 'canary_version_changed');
      if (result.status === 404) return {found: false};
      need(result.status === 200 && result.etag === value.etag && result.data.equals(bodies[value.sequence - 1])
        && (versioning.state !== 'enabled' || result.versionId === value.versionId), 'canary_preservation');
      return {found: true};
    },
    async deleteCanary(value, condition) {
      need(created && puts === 2 && known.get(value?.sequence) === value
        && [known.get(1)?.etag, known.get(2)?.etag].includes(condition) && etag(condition), 'canary_delete_scope');
      const query = versioning.state === 'enabled' ? (need(value.versionId && versions.get(value.versionId) === value, 'canary_version_fence'), {versionId: value.versionId}) : {};
      need(versioning.state === 'enabled' || versioning.state === 'never_enabled', 'canary_version_fence');
      const result = await request('DELETE', key, query, undefined, {'if-match': condition}, 4096);
      return {status: result.status, unexpectedVersioning: result.deleteMarker === 'true'
        || versioning.state === 'never_enabled' && immutableVersion(result.versionId)
        || versioning.state === 'enabled' && result.versionId !== null && result.versionId !== value.versionId};
    },
    async versioningUnchanged() {
      need(created, 'canary_read_scope');
      const response = await request('GET', null, {versioning: ''}); need(response.status === 200, 'versioning_http');
      return JSON.stringify(parseVersioning(response.data)) === JSON.stringify(versioning);
    },
    knownCanaryVersions: () => [...versions.values()],
  });
}

export function verifyInvocation(mode, {root = ROOT, environment = process.env} = {}) {
  need(['audit', 'canary'].includes(mode), 'mode');
  need(environment.GITHUB_WORKFLOW_REF === 'jeep-jim/AvtoCena/.github/workflows/japan-cache-retention-' + mode + '.yml@refs/heads/main'
    && environment.GITHUB_JOB === 'inspect', 'workflow');
  const result = verifyReadonlyInvocation({root, env: environment,
    markerPath: '.github/market-runs/japan-cache-retention-' + mode + '.json', operation: 'japan-cache-retention-' + mode + '-v1'});
  need(/^[1-9][0-9]{0,19}$/.test(environment.GITHUB_RUN_ID ?? '') && environment.GITHUB_RUN_ATTEMPT === '1', 'run');
  return {...result, runId: environment.GITHUB_RUN_ID, attempt: '1'};
}

export async function runJapanCacheRetention({mode, invocation, environment = process.env, fetcher, now = Date.now, nonce}) {
  const report = {version: 1, kind: 'japan-cache-retention-' + mode + '-v1', mode, controllerSha: invocation.sourceSha,
    approvedControllerSha: invocation.approvedSourceSha, runId: invocation.runId, attempt: invocation.attempt,
    startedAt: new Date(now()).toISOString(), finishedAt: null, completed: false, status: 'failed',
    cacheMutations: 0, directSupplierRequests: 0, rawPayloadsPersisted: false, cacheDeletionEnabled: false,
    versionHistoryInventoried: false, hostDiskMeasured: false, storage: null, inventory: [], inspections: null, canary: null};
  let io;
  try {
    io = createJapanCacheAuditStorage({mode, owner: {runId: invocation.runId, attempt: invocation.attempt, revision: invocation.sourceSha}, environment, fetcher, now, nonce});
    report.storage = await io.settings();
    if (mode === 'audit') {
      const candidates = [];
      for (const prefix of CACHE_PREFIXES) {
        const group = prefix.split('/').at(-2), summary = {group, objects: 0, bytes: 0, metadataOlderThanSevenDays: 0,
          olderBytes: 0, unrecognizedKeys: 0, oversizedInspectionCandidates: 0, complete: false};
        let cursor = null;
        for (let page = 0; page < LIMITS.listPagesPerPrefix; page++) {
          const result = await io.list(prefix, cursor);
          for (const row of result.objects) {
            summary.objects++; summary.bytes += row.size;
            need(Number.isSafeInteger(summary.bytes), 'inventory_size');
            if (!cacheKeyGroup(row.key)) { summary.unrecognizedKeys++; continue; }
            if (Date.parse(row.lastModified) <= io.cutoff) {
              summary.metadataOlderThanSevenDays++; summary.olderBytes += row.size;
              if (row.size > 0 && row.size <= (group === 'queries' ? LIMITS.queryBytes : LIMITS.detailBytes)) candidates.push(row);
              else summary.oversizedInspectionCandidates++;
            }
          }
          if (!result.truncated) { summary.complete = true; break; } cursor = result.next;
        }
        report.inventory.push(summary);
      }
      const inspection = {attempted: 0, changedDuringRead: 0, snapshots: 0, expired: 0, retained: 0, invalid: 0,
        eligibleListedObjects: candidates.length, limited: candidates.length > LIMITS.inspections};
      // This is a bounded sample of already stored replies, not an inventory
      // scan or a source crawl. Never claim these eight reads describe all AJ.
      for (const row of candidates.slice(0, LIMITS.inspections)) {
        const result = await io.inspect(row); inspection.attempted++;
        if (result.changed) inspection.changedDuringRead++;
        else for (const key of ['snapshots', 'expired', 'retained', 'invalid']) inspection[key] += result[key];
      }
      report.inspections = inspection; report.status = 'bounded_audit_complete'; report.completed = true;
    } else {
      const canary = {syntheticKey: io.syntheticKey, conditionalHeaderFormat: 'quoted',
        target: report.storage.versioning.state === 'enabled' ? 'immutable_version' : 'current_object',
        tested: false, staleConditionRejected: false, updatedObjectPreserved: false, matchingConditionDeleted: false,
        supportedForTestedTarget: false, currentObjectConditionalDeleteVerified: false, knownVersionsRemoved: 0, versioningChanged: false,
        residuePossible: false, maximumPayloadBytesWritten: 0, outcome: 'not_tested'};
      report.canary = canary;
      if (report.storage.versioning.state === 'suspended' || report.storage.versioning.mfaDelete === 'enabled') {
        canary.outcome = 'version_fence_unavailable'; report.status = 'capability_not_verified'; report.completed = true;
      } else {
        canary.residuePossible = true; canary.maximumPayloadBytesWritten = 2 * LIMITS.canaryBytes;
        const first = await io.createCanary(), second = await io.updateCanary(first);
        canary.versioningChanged = !await io.versioningUnchanged();
        need(!canary.versioningChanged, 'canary_version_changed');
        const stale = await io.deleteCanary(second, first.etag); canary.tested = true;
        canary.versioningChanged = stale.unexpectedVersioning;
        need(!canary.versioningChanged, 'canary_version_changed');
        canary.staleConditionRejected = [409, 412].includes(stale.status);
        const preserved = await io.readCanary(second); canary.updatedObjectPreserved = preserved.found;
        if (canary.staleConditionRejected && preserved.found) {
          const current = await io.deleteCanary(second, second.etag);
          canary.versioningChanged ||= current.unexpectedVersioning;
          const after = await io.readCanary(second);
          canary.matchingConditionDeleted = [200, 204].includes(current.status) && !after.found;
          canary.supportedForTestedTarget = canary.matchingConditionDeleted && !canary.versioningChanged;
          canary.currentObjectConditionalDeleteVerified = canary.supportedForTestedTarget && canary.target === 'current_object';
          canary.outcome = canary.matchingConditionDeleted ? 'verified' : 'matching_condition_not_verified';
        } else canary.outcome = !preserved.found ? 'stale_precondition_not_enforced' : 'stale_condition_not_verified';
        if (report.storage.versioning.state === 'enabled') {
          // Only versions already read back as this run's synthetic payloads.
          // No null-version, bare DELETE, version listing or fallback deletion.
          let allRemoved = true;
          for (const version of io.knownCanaryVersions()) {
            try {
              if ((await io.readCanary(version)).found) {
                const removed = await io.deleteCanary(version, version.etag);
                need([200, 204].includes(removed.status) && !removed.unexpectedVersioning && !(await io.readCanary(version)).found, 'canary_cleanup');
              }
              canary.knownVersionsRemoved++;
            } catch { allRemoved = false; }
          }
          canary.residuePossible = !allRemoved;
        } else canary.residuePossible = !canary.matchingConditionDeleted && preserved.found;
        canary.versioningChanged ||= !await io.versioningUnchanged();
        if (canary.versioningChanged) {
          canary.supportedForTestedTarget = false; canary.currentObjectConditionalDeleteVerified = false;
          canary.residuePossible = true; canary.outcome = 'versioning_changed';
        }
        report.status = canary.supportedForTestedTarget ? 'capability_observed' : 'capability_not_verified'; report.completed = true;
      }
    }
  } catch (error) {
    report.errorCode = safeError(error);
    if (report.canary) {
      // A failed closing settings check is not a complete capability proof.
      report.canary.supportedForTestedTarget = false;
      report.canary.currentObjectConditionalDeleteVerified = false;
      report.canary.residuePossible ||= Boolean(io?.stats().syntheticPuts);
      report.canary.versioningChanged ||= report.errorCode === 'japan_cache_audit_canary_version_changed';
      report.canary.outcome = report.canary.versioningChanged ? 'versioning_changed' : 'probe_incomplete';
    }
  }
  report.finishedAt = new Date(now()).toISOString(); report.requests = io?.stats() ?? {requests: 0, responseBytes: 0, metadataPages: 0, bodyInspections: 0, syntheticPuts: 0, syntheticDeletes: 0};
  need(Buffer.byteLength(JSON.stringify(report)) <= LIMITS.reportBytes, 'report_size'); return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && ['--verify-audit', '--audit', '--verify-canary', '--canary'].includes(process.argv[2]), 'arguments');
    const mode = process.argv[2].endsWith('canary') ? 'canary' : 'audit', invocation = verifyInvocation(mode);
    if (process.argv[2].startsWith('--verify-')) process.stdout.write(JSON.stringify({...invocation, mode, cacheDeletionEnabled: false}) + '\n');
    else {
      const report = await runJapanCacheRetention({mode, invocation});
      const raw = JSON.stringify(report) + '\n';
      await fs.writeFile(path.join(ROOT, 'japan-cache-retention-' + mode + '-report.json'), raw, {flag: 'wx', mode: 0o600});
      process.stdout.write(raw);
      if (!report.completed || mode === 'canary' && !report.canary?.supportedForTestedTarget) process.exitCode = 1;
    }
  } catch (error) { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; }
}
