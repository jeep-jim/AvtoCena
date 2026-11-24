import {createHash, createHmac} from 'node:crypto';
import https from 'node:https';

export class InventoryError extends Error {
  constructor(code) { super(code); this.name = 'InventoryError'; this.code = code; }
}
export const need = (ok, code) => { if (!ok) throw new InventoryError(code); };
export const hash = value => createHash('sha256').update(value).digest('hex');
export const safeKey = key => typeof key === 'string' && key.length <= 1024
  && /^[A-Za-z0-9_.\/-]+$/.test(key) && key.split('/').every(p => p && p !== '.' && p !== '..');
export const safePrefix = prefix => typeof prefix === 'string' && prefix.endsWith('/')
  && safeKey(prefix.slice(0, -1));
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value);
const integerText = text => typeof text === 'string' && /^(0|[1-9]\d*)$/.test(text) && Number.isSafeInteger(Number(text));
const aws = text => encodeURIComponent(text).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key, text) => createHmac('sha256', key).update(text).digest();

// Deliberately no caller-supplied origin, arbitrary bucket, PUT or DELETE surface.
export function storageConfiguration(env = process.env) {
  need(env.YC_OBJECT_STORAGE_ENDPOINT === 'https://s3.regru.cloud'
    && env.YC_OBJECT_STORAGE_REGION === 'us-east-1'
    && env.YC_OBJECT_STORAGE_BUCKET === 'avtocena-staging-8120751'
    && ['migration-staging/full-20261011', 'migration-staging/full-20261011/'].includes(env.YC_OBJECT_STORAGE_PREFIX),
  'inventory_storage_scope');
  need(opaque(env.YC_OBJECT_STORAGE_ACCESS_KEY_ID) && opaque(env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY), 'inventory_credentials_missing');
  return Object.freeze({endpoint: env.YC_OBJECT_STORAGE_ENDPOINT, region: env.YC_OBJECT_STORAGE_REGION,
    bucket: env.YC_OBJECT_STORAGE_BUCKET, prefix: 'migration-staging/full-20261011/',
    accessKeyId: env.YC_OBJECT_STORAGE_ACCESS_KEY_ID, secret: env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY});
}

function xmlText(raw) {
  need(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw), 'inventory_list_xml');
  return raw.replace(/&([^;]+);/g, (_, entity) => {
    const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
    if (Object.hasOwn(named, entity)) return named[entity];
    need(/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity), 'inventory_list_xml');
    const number = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    need(Number.isInteger(number) && number > 0 && number <= 0x10ffff
      && !(number >= 0xd800 && number <= 0xdfff) && (number >= 32 || [9, 10, 13].includes(number)), 'inventory_list_xml');
    return String.fromCodePoint(number);
  });
}

/** Strict small XML tree for ListObjectsV2, not regex extraction of successful-looking fields.
 * Reject DTD/entity expansion, malformed nesting, duplicate scalar fields and partial XML.
 * AWS explicitly permits an HTTP 200 containing invalid XML: API_ListObjectsV2.html. */
function xmlTree(bytes) {
  let xml;
  try { xml = new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { throw new InventoryError('inventory_list_xml'); }
  xml = xml.replace(/^\uFEFF/, '').replace(/^\s*<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/i, '');
  need(!/<!|<\?|&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(xml), 'inventory_list_xml');
  const stack = [], roots = [];
  let position = 0;
  for (const token of xml.matchAll(/<[^<>]*>|[^<>]+/g)) {
    need(token.index === position, 'inventory_list_xml'); position += token[0].length;
    const text = token[0];
    if (!text.startsWith('<')) {
      if (!stack.length) need(!text.trim(), 'inventory_list_xml');
      else stack.at(-1).text += xmlText(text);
      continue;
    }
    const close = text.match(/^<\/([A-Za-z][A-Za-z0-9]*)\s*>$/);
    if (close) { need(stack.length > 0 && stack.at(-1).name === close[1], 'inventory_list_xml'); stack.pop(); continue; }
    const open = text.match(/^<([A-Za-z][A-Za-z0-9]*)(?:\s+xmlns=["']http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/["'])?\s*(\/?)>$/);
    need(open, 'inventory_list_xml');
    const node = {name: open[1], text: '', children: []};
    if (stack.length) stack.at(-1).children.push(node); else roots.push(node);
    if (!open[2]) stack.push(node);
  }
  need(position === xml.length && stack.length === 0 && roots.length === 1
    && roots[0].name === 'ListBucketResult' && !roots[0].text.trim(), 'inventory_list_xml');
  return roots[0];
}
function scalar(node, name, required = true) {
  const found = node.children.filter(child => child.name === name);
  need(found.length <= 1 && (!required || found.length === 1), 'inventory_list_fields');
  if (!found.length) return null;
  need(found[0].children.length === 0, 'inventory_list_fields');
  return found[0].text;
}

export function parseListPage(bytes, {bucket, physicalPrefix, configuredPrefix, continuationToken = null, maxKeys = 1000}) {
  need(safePrefix(physicalPrefix) && safePrefix(configuredPrefix) && physicalPrefix.startsWith(configuredPrefix), 'inventory_list_scope');
  const root = xmlTree(bytes);
  const known = new Set(['Name', 'Prefix', 'KeyCount', 'MaxKeys', 'IsTruncated', 'ContinuationToken', 'NextContinuationToken',
    'Contents', 'Delimiter', 'StartAfter', 'EncodingType']);
  need(root.children.every(child => known.has(child.name)), 'inventory_list_fields');
  need(scalar(root, 'Name') === bucket && scalar(root, 'Prefix') === physicalPrefix, 'inventory_list_identity');
  const keyCount = scalar(root, 'KeyCount'), max = scalar(root, 'MaxKeys'), truncated = scalar(root, 'IsTruncated');
  need(integerText(keyCount) && integerText(max) && Number(max) === maxKeys
    && Number(keyCount) <= maxKeys && ['true', 'false'].includes(truncated), 'inventory_list_fields');
  need([scalar(root, 'Delimiter', false), scalar(root, 'StartAfter', false), scalar(root, 'EncodingType', false)]
    .every(value => value === null || value === ''), 'inventory_list_unrequested_mode');
  const echoed = scalar(root, 'ContinuationToken', false), next = scalar(root, 'NextContinuationToken', false);
  need(continuationToken === null ? echoed === null || echoed === '' : echoed === continuationToken, 'inventory_list_token_identity');
  need(truncated === 'true' ? opaque(next) && next !== continuationToken : next === null || next === '', 'inventory_list_next_token');
  const rows = [], keys = new Set();
  for (const node of root.children.filter(child => child.name === 'Contents')) {
    need(!node.text.trim(), 'inventory_list_fields');
    const full = scalar(node, 'Key'), size = scalar(node, 'Size'), etag = scalar(node, 'ETag'), lastModified = scalar(node, 'LastModified');
    need(typeof full === 'string' && full.startsWith(physicalPrefix) && full.startsWith(configuredPrefix), 'inventory_list_key_scope');
    const key = full.slice(configuredPrefix.length);
    need(safeKey(key) && !keys.has(key), 'inventory_list_duplicate_or_unsafe_key');
    need(integerText(size) && opaque(etag) && typeof lastModified === 'string' && Number.isFinite(Date.parse(lastModified)), 'inventory_list_object_metadata');
    keys.add(key); rows.push({key, size: Number(size), etag, lastModified});
  }
  need(rows.length === Number(keyCount), 'inventory_list_count');
  return {objects: rows, truncated: truncated === 'true', nextToken: truncated === 'true' ? next : null,
    responseSha256: hash(bytes), keyCount: rows.length};
}

function rawHttps(url, headers, {method, maxBytes, timeoutMs}) {
  return new Promise((resolve, reject) => {
    let settled = false, request;
    const fail = code => { if (!settled) { settled = true; clearTimeout(timer); request?.destroy(); reject(new InventoryError(code)); } };
    const timer = setTimeout(() => fail('inventory_transport_timeout'), timeoutMs);
    const done = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    try {
      request = https.request(url, {method, headers}, response => {
        const chunks = []; let count = 0;
        response.on('data', chunk => {
          count += chunk.length;
          if (count > maxBytes) return fail('inventory_object_byte_limit');
          chunks.push(chunk);
        });
        response.on('end', () => done({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks, count)}));
        response.on('aborted', () => fail('inventory_transport_truncated'));
        response.on('error', () => fail('inventory_transport_failed'));
      });
      request.on('error', () => fail('inventory_transport_failed'));
      request.end();
    } catch { fail('inventory_transport_failed'); }
    request?.on('close', () => { if (settled) clearTimeout(timer); });
  });
}
function header(headers, name) {
  const value = headers[name];
  need(value === undefined || typeof value === 'string', 'inventory_response_headers');
  return value ?? null;
}
function metadata(response) {
  const etag = header(response.headers, 'etag'), size = header(response.headers, 'content-length');
  need(opaque(etag) && integerText(size), 'inventory_object_metadata');
  const versionId = header(response.headers, 'x-amz-version-id');
  need(versionId === null || opaque(versionId), 'inventory_object_metadata');
  return {found: true, etag, size: Number(size), versionId,
    contentType: header(response.headers, 'content-type'), contentEncoding: header(response.headers, 'content-encoding'),
    lastModified: header(response.headers, 'last-modified')};
}

export function createInventoryStorage({env = process.env, scope, request = rawHttps, clock = Date.now,
  deadline = Date.now() + 20 * 60000, timeoutMs = 30000} = {}) {
  const config = storageConfiguration(env);
  need(scope && typeof scope.canRead === 'function' && typeof scope.canList === 'function', 'inventory_read_scope_required');
  need(Number.isFinite(deadline) && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'inventory_transport_budget');
  let requests = 0;
  async function signed(method, relative, query, extra = {}, maxBytes = 32 * 1024 * 1024) {
    need(['GET', 'HEAD'].includes(method), 'inventory_method_forbidden');
    need(clock() < deadline, 'inventory_deadline');
    const listing = relative === null;
    need(listing ? scope.canList(query.relativePrefix) : safeKey(relative) && scope.canRead(relative, method), 'inventory_source_forbidden');
    const params = {...query}; delete params.relativePrefix;
    const canonical = Object.entries(params).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${aws(k)}=${aws(v)}`).join('&');
    const pathname = '/' + config.bucket + (listing ? '' : '/' + (config.prefix + relative).split('/').map(aws).join('/'));
    const url = new URL(config.endpoint + pathname + (canonical ? '?' + canonical : ''));
    const now = new Date(clock()).toISOString().replace(/[:-]|\.\d{3}/g, ''), day = now.slice(0, 8);
    const headers = {host: url.host, 'x-amz-content-sha256': hash(''), 'x-amz-date': now, 'accept-encoding': 'identity', ...extra};
    const names = Object.keys(headers).sort(), signedHeaders = names.join(';');
    const canonicalHeaders = names.map(name => `${name}:${String(headers[name]).trim()}\n`).join('');
    const credentialScope = `${day}/${config.region}/s3/aws4_request`;
    const canonicalRequest = [method, pathname, canonical, canonicalHeaders, signedHeaders, hash('')].join('\n');
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + config.secret, day), config.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(['AWS4-HMAC-SHA256', now, credentialScope, hash(canonicalRequest)].join('\n')).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    let response;
    try { requests++; response = await request(url, headers, {method, maxBytes, timeoutMs: Math.min(timeoutMs, deadline - clock())}); }
    catch (error) { throw error instanceof InventoryError ? error : new InventoryError('inventory_transport_failed'); }
    need(response && Number.isInteger(response.status) && response.headers && Buffer.isBuffer(response.body), 'inventory_transport_response');
    need(response.body.length <= maxBytes, 'inventory_object_byte_limit');
    // Never follow redirects, retry without conditions, or report response bodies/URLs.
    need([200, 404, 412].includes(response.status), 'inventory_http_status');
    return response;
  }
  return Object.freeze({
    scopeFingerprint: hash(JSON.stringify([config.endpoint, config.region, config.bucket, config.prefix])),
    metrics: () => ({requests}),
    async head(key) {
      const response = await signed('HEAD', key, {}, {}, 0);
      if (response.status === 404) return {found: false};
      need(response.status === 200, 'inventory_source_changed');
      return metadata(response);
    },
    async get(key, {ifMatch, versionId = null, maxBytes = 32 * 1024 * 1024} = {}) {
      need(opaque(ifMatch) && (versionId === null || opaque(versionId)), 'inventory_conditional_read_required');
      need(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'inventory_object_byte_limit');
      const response = await signed('GET', key, versionId === null ? {} : {versionId}, {'if-match': ifMatch}, maxBytes);
      need(response.status === 200, 'inventory_source_changed');
      const meta = metadata(response);
      need(meta.etag === ifMatch && (versionId === null || meta.versionId === versionId)
        && meta.size === response.body.length, 'inventory_get_identity');
      return {...meta, data: response.body, sha256: hash(response.body)};
    },
    async listPage(prefix, continuationToken = null) {
      need(safePrefix(prefix) && scope.canList(prefix) && (continuationToken === null || opaque(continuationToken)), 'inventory_list_scope');
      const physicalPrefix = config.prefix + prefix;
      const query = {'list-type': '2', prefix: physicalPrefix, 'max-keys': '1000', relativePrefix: prefix};
      if (continuationToken !== null) query['continuation-token'] = continuationToken;
      const response = await signed('GET', null, query, {}, 2 * 1024 * 1024);
      need(response.status === 200, 'inventory_list_http_status');
      return parseListPage(response.body, {bucket: config.bucket, physicalPrefix, configuredPrefix: config.prefix, continuationToken});
    },
  });
}
