// One fixed, read-only incident investigation. No application imports or supplier requests.
// S3 API: GetBucketVersioning, ListObjectVersions (full-key prefix), GetObject(versionId).
// https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetBucketVersioning.html
// https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html
// https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ENDPOINT = 'https://s3.regru.cloud', BUCKET = 'avtocena-staging-8120751';
const PREFIX = 'migration-staging/full-20261011/', REGION = 'us-east-1';
const FROM = '2026-11-25T16:02:00.000Z', TO = '2026-11-25T16:02:30.000Z';
const LIMIT = Object.freeze({requests: 14, keys: 64, getVersions: 4, bodyBytes: 65536,
  totalBytes: 1048576, totalMs: 45000, requestMs: 5000, outputBytes: 8192});
const KEYS = Object.freeze([...Array.from({length: 8}, (_, i) =>
  `${PREFIX}integrations/ajes/catalog-failure-pages/stats-list-${i + 1}.json`),
  `${PREFIX}integrations/ajes/catalog-failure-stats.json`]);
// Derived offline from exact candidate 4302f59a0312f35a64fc3cb9c5b25f9463fa9294,
// ajesCatalogQuery({market:'japan',powerTo:'160',page:'1',pageSize:'3',sort:'updatedAt'})
// then ajesQuery({...query,page:1..8},null), with Date fixed to 2026-11-25.
// ajes-query.ts SHA256: 53b5542d922b4a55fae4b790d50765e078bb110c1aba5b76d9c28cf668a37ebe.
// No SQL text is embedded or emitted. SQL/time correlation cannot identify a visitor or run.
export const POWER_SQL_HASHES = Object.freeze([
  '98fd74963ab95ca4ef574fa23af86193ad036bbd8370271b19b00e62913a206b',
  '2100c4b361a631c18ed048e4c93a08ecce0fe0dd7d1b327618d0bbfdf0a1159c',
  '741ed39719fc4eb32380719a2eb4cd422abda28d4bfcade3b3d27f5cac0d0095',
  '716935190cee322814b88fe99d245209126a1c6352bb42a7cf906b0cf6b62476',
  'b8ff4010854c7f2646f87a727199632ec7216bdb55c6ed58db28b81a298a1145',
  '0b75b106d5d647a94d8c68c396f91a47ada6e0f88d323d5c3bc55926d9e0cd31',
  'ebb016e1a24fba877083b769f3c417d0e43c0fbeee8c34a465281b267fe11e9f',
  '9799b6be01dcc0625b9b21265e7e110ca798f706c41ad0c2c3b2fac00f87050b',
]);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
class DiagnosticError extends Error { constructor(code, httpStatus = null) { super(code); this.code = code; this.httpStatus = httpStatus; } }
function need(value, code) { if (!value) throw new DiagnosticError(code); }
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value.replace(/(?<!\.\d{3})Z$/, '.000Z') ? ms : null;
}
const inWindow = value => time(value) !== null && time(value) >= Date.parse(FROM) && time(value) <= Date.parse(TO);

// Small bounded XML tree, not a permissive regex extractor: no DTD or custom entities,
// CDATA, processing instructions, mixed content or unbounded recursion.
export function parseXml(text) {
  need(Buffer.byteLength(text) <= LIMIT.bodyBytes, 'xml_limit');
  text = text.replace(/^\uFEFF/, '').replace(/^<\?xml\s+version=['"]1\.0['"](?:\s+encoding=['"]UTF-8['"])?\s*\?>\s*/i, '');
  need(!/<[!?]/.test(text) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text), 'xml_invalid');
  const document = {name: '', children: [], text: ''}, stack = [document];
  const tokens = text.match(/<[^>]*>|[^<]+/g) ?? [];
  need(tokens.join('') === text && tokens.length <= 4096, 'xml_invalid');
  let nodes = 0;
  const decode = value => {
    need(!/&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/.test(value), 'xml_invalid');
    return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity) => {
      if (!entity.startsWith('#')) return {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[entity];
      const n = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      need(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff), 'xml_invalid');
      return String.fromCodePoint(n);
    });
  };
  for (const token of tokens) {
    if (!token.startsWith('<')) { stack.at(-1).text += decode(token); continue; }
    const close = /^<\/([A-Za-z][A-Za-z0-9]*)\s*>$/.exec(token);
    if (close) {
      need(stack.length > 1 && stack.at(-1).name === close[1]
        && (!stack.at(-1).children.length || !stack.at(-1).text.trim()), 'xml_invalid');
      stack.pop(); continue;
    }
    const open = /^<([A-Za-z][A-Za-z0-9]*)(\s+xmlns=(?:"[^"<>&]*"|'[^'<>&]*'))?\s*(\/?)>$/.exec(token);
    need(open && (!open[2] || stack.length === 1) && ++nodes <= 1600 && stack.length <= 5, 'xml_invalid');
    const node = {name: open[1], children: [], text: ''}; stack.at(-1).children.push(node);
    if (!open[3]) stack.push(node);
  }
  need(stack.length === 1 && document.children.length === 1 && !document.text.trim()
    && !document.children[0].text.trim(), 'xml_invalid');
  return document.children[0];
}
function field(node, name, optional = false) {
  const matches = node.children.filter(child => child.name === name);
  need(matches.length === 1 || optional && matches.length === 0, 'xml_invalid');
  if (!matches.length) return null;
  need(!matches[0].children.length && !node.text.trim(), 'xml_invalid');
  return matches[0].text;
}
function versions(text, key) {
  const root = parseXml(text);
  need(root.name === 'ListVersionsResult', 'xml_invalid');
  need(field(root, 'Name') === BUCKET && field(root, 'EncodingType') === 'url', 'listing_scope');
  const decoded = value => { try { return decodeURIComponent(value); } catch { throw new DiagnosticError('xml_invalid'); } };
  need(decoded(field(root, 'Prefix')) === key && field(root, 'MaxKeys') === String(LIMIT.keys), 'listing_scope');
  need(!root.children.some(child => child.name === 'CommonPrefixes'), 'listing_scope');
  const truncated = field(root, 'IsTruncated'); need(['true', 'false'].includes(truncated), 'xml_invalid');
  const entries = root.children.filter(child => ['Version', 'DeleteMarker'].includes(child.name));
  need(entries.length <= LIMIT.keys, 'listing_limit');
  const selected = [];
  for (const entry of entries) {
    need(decoded(field(entry, 'Key')) === key, 'listing_scope');
    const versionId = field(entry, 'VersionId'), lastModified = field(entry, 'LastModified');
    need(/^[\x21-\x7e]{1,1024}$/.test(versionId) && time(lastModified) !== null, 'xml_invalid');
    if (entry.name === 'DeleteMarker') continue;
    const sizeText = field(entry, 'Size'); need(/^\d{1,10}$/.test(sizeText), 'xml_invalid');
    const size = Number(sizeText);
    if (inWindow(lastModified) && size > 0 && size <= LIMIT.bodyBytes) selected.push({key, versionId, lastModified, size});
  }
  return {present: entries.length > 0, truncated: truncated === 'true', selected};
}
function matchingRecord(value, version) {
  if (!value || value.table !== 'stats' || value.kind !== 'list' || value.pageSize !== 3
      || !Number.isInteger(value.page) || value.page < 1 || value.page > 8
      || !inWindow(value.startedAt) || !inWindow(value.finishedAt) || time(value.finishedAt) < time(value.startedAt)
      || time(value.finishedAt) > time(version.lastModified) + 999
      || typeof value.sql !== 'string' || Buffer.byteLength(value.sql) !== (value.page <= 4 ? 1074 : 1075)
      || hash(value.sql) !== POWER_SQL_HASHES[value.page - 1]) return null;
  const expectedKey = KEYS[value.page - 1];
  if (version.key !== expectedKey && version.key !== KEYS[8]) return null;
  const outcomes = /^(?:http_[1-5]\d{2}|visitor_restricted|request_failed|request_timeout|connect_timeout|quota_exhausted|quota_busy|local_busy|invalid_response|empty_response|query_too_large|response_too_large|identity_mismatch)$/;
  return {objectLastModified: version.lastModified, startedAt: value.startedAt, finishedAt: value.finishedAt,
    kind: 'list', page: value.page, pageSize: 3,
    outcome: typeof value.outcome === 'string' && outcomes.test(value.outcome) ? value.outcome : null,
    httpStatus: Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null,
    providerCode: typeof value.providerCode === 'string' && /^(?:bot|ban)\d{0,13}$/.test(value.providerCode) ? value.providerCode : null,
    sqlSha256: POWER_SQL_HASHES[value.page - 1], sqlBytes: Buffer.byteLength(value.sql)};
}

export async function diagnose({fetcher = globalThis.fetch, env = process.env, now = Date.now} = {}) {
  const report = {version: 1, status: 'diagnostic_failed', window: {from: FROM, to: TO},
    versioning: 'unverified', versionsPresent: false, historyTruncated: false, windowVersions: 0,
    requests: 0, responseBytes: 0, versionReads: 0, attribution: 'time_and_sql_only', records: []};
  const deadline = now() + LIMIT.totalMs;
  const globalController = new AbortController(), globalTimer = setTimeout(() => globalController.abort(), LIMIT.totalMs);
  async function get(key, params, maxBytes, expectedVersion = null) {
    need(now() < deadline && !globalController.signal.aborted, 'deadline');
    need(report.requests < LIMIT.requests, 'request_limit');
    need(key === null || KEYS.includes(key), 'request_scope');
    const query = Object.entries(params).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
    const url = new URL(`${ENDPOINT}/${BUCKET}${key === null ? '' : '/' + key.split('/').map(encode).join('/')}`);
    url.search = query;
    const stamp = new Date(now()).toISOString().replace(/[:-]|\.\d{3}/g, ''), day = stamp.slice(0, 8);
    const scope = `${day}/${REGION}/s3/aws4_request`, payloadHash = hash('');
    const headers = {host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp};
    const names = Object.keys(headers).sort(), canonicalHeaders = names.map(name => `${name}:${headers[name]}\n`).join('');
    const canonical = ['GET', url.pathname, query, canonicalHeaders, names.join(';'), payloadHash].join('\n');
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + env.REGCLOUD_S3_SECRET_ACCESS_KEY, day), REGION), 's3'), 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(['AWS4-HMAC-SHA256', stamp, scope, hash(canonical)].join('\n')).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.REGCLOUD_S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
    headers['accept-encoding'] = 'identity';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(LIMIT.requestMs, deadline - now()));
    const signal = AbortSignal.any([controller.signal, globalController.signal]);
    let response, reader;
    report.requests++;
    try {
      response = await fetcher(url, {method: 'GET', headers, redirect: 'error', signal});
      if (response.status !== 200) throw new DiagnosticError('storage_http_failed', response.status);
      need(!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity', 'response_encoding');
      if (expectedVersion !== null) need(response.headers.get('x-amz-version-id') === expectedVersion, 'version_binding');
      const declared = response.headers.get('content-length');
      need(declared === null || /^\d{1,10}$/.test(declared) && Number(declared) <= maxBytes
        && Number(declared) + report.responseBytes <= LIMIT.totalBytes, 'byte_limit');
      reader = response.body?.getReader(); need(reader, 'response_empty');
      const chunks = []; let bytes = 0;
      while (true) {
        const item = await reader.read(); if (item.done) break;
        need(bytes + item.value.byteLength <= maxBytes && report.responseBytes + item.value.byteLength <= LIMIT.totalBytes, 'byte_limit');
        bytes += item.value.byteLength; report.responseBytes += item.value.byteLength; chunks.push(item.value);
      }
      need(declared === null || bytes === Number(declared), 'response_size');
      return Buffer.concat(chunks, bytes);
    } catch (error) {
      if (signal.aborted || now() >= deadline) throw new DiagnosticError('deadline');
      if (error instanceof DiagnosticError) throw error;
      throw new DiagnosticError('storage_read_failed');
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {}); else if (response?.body) void response.body.cancel().catch(() => {});
    }
  }
  try {
    need(typeof env.REGCLOUD_S3_ACCESS_KEY_ID === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(env.REGCLOUD_S3_ACCESS_KEY_ID)
      && typeof env.REGCLOUD_S3_SECRET_ACCESS_KEY === 'string' && env.REGCLOUD_S3_SECRET_ACCESS_KEY.length >= 16
      && env.REGCLOUD_S3_SECRET_ACCESS_KEY.length <= 256, 'credentials_missing');
    const root = parseXml(new TextDecoder('utf-8', {fatal: true}).decode(await get(null, {versioning: ''}, 4096)));
    need(root.name === 'VersioningConfiguration', 'xml_invalid');
    const state = field(root, 'Status', true);
    need(state === null || ['Enabled', 'Suspended'].includes(state), 'xml_invalid');
    report.versioning = state ?? 'never_enabled';
    if (state === null) { report.status = 'versioning_not_enabled'; return report; }
    const selected = [];
    for (const key of KEYS) {
      const body = await get(null, {versions: '', prefix: key, 'max-keys': String(LIMIT.keys), 'encoding-type': 'url'}, LIMIT.bodyBytes);
      const listing = versions(new TextDecoder('utf-8', {fatal: true}).decode(body), key);
      report.versionsPresent ||= listing.present; report.historyTruncated ||= listing.truncated;
      selected.push(...listing.selected);
    }
    report.windowVersions = selected.length;
    report.historyTruncated ||= selected.length > LIMIT.getVersions;
    for (const version of selected.slice(0, LIMIT.getVersions)) {
      report.versionReads++;
      const body = await get(version.key, {versionId: version.versionId}, LIMIT.bodyBytes, version.versionId);
      need(body.length === version.size, 'version_binding');
      const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body));
      const record = matchingRecord(value, version);
      if (record && !report.records.some(previous => JSON.stringify(previous) === JSON.stringify(record))) report.records.push(record);
    }
    report.status = report.records.length ? 'matching_power_failures' : report.historyTruncated ? 'bounded_history_incomplete'
      : selected.length ? 'no_matching_power_failure' : 'no_matching_window_versions';
  } catch (error) {
    report.errorCode = error instanceof DiagnosticError ? error.code : 'diagnostic_failed';
    report.httpStatus = error instanceof DiagnosticError ? error.httpStatus : null;
  } finally { clearTimeout(globalTimer); }
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let report;
  const workflow = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-ajes-failure-versions-20261125.yml@refs/heads/main';
  if (process.argv.length !== 3 || process.argv[2] !== '--run' || process.env.GITHUB_ACTIONS !== 'true'
      || process.env.GITHUB_REPOSITORY_ID !== '1289722938' || process.env.GITHUB_REF !== 'refs/heads/main'
      || process.env.GITHUB_RUN_ATTEMPT !== '1' || process.env.GITHUB_WORKFLOW_REF !== workflow
      || !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) {
    report = {version: 1, status: 'diagnostic_failed', errorCode: 'invocation_rejected'};
  } else report = await diagnose();
  const output = JSON.stringify(report);
  if (Buffer.byteLength(output) > LIMIT.outputBytes) {
    process.stdout.write('{"version":1,"status":"diagnostic_failed","errorCode":"output_limit"}\n'); process.exitCode = 1;
  } else { process.stdout.write(output + '\n'); process.exitCode = report.status === 'diagnostic_failed' ? 1 : 0; }
}
