import assert from 'node:assert/strict';

export const OWNED_RAW_READ_TARGET = Object.freeze({origin: 'https://s3.regru.cloud',
  bucket: 'avtocena-staging-8120751', prefix: 'migration-staging/full-20261011/'});
const SIGNED_FIELDS = ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature'];

function ownedKey(key) {
  assert.ok(typeof key === 'string' && key.length <= 700 && /^catalog\/[a-zA-Z0-9_./-]+$/.test(key)
    && !key.split('/').some(part => !part || part === '.' || part === '..'), 'owned_json_key');
  const allowed = [
    /^catalog\/intake-staging\/encar\/\d{1,20}\/[1-9]\d{0,5}\/(?:pages|page-receipts)\/[1-9]\d*\.json$/,
    /^catalog\/recovery-raw-spool\/v1\/[a-f0-9]{64}\/(?:complete\.json|chunks\/[1-9]\d*\/(?:data|commit)\.json)$/,
    /^catalog\/raw-feed-coordination\/v1\/contributions\/gen_\d+_[a-z0-9-]+\/[a-zA-Z0-9_-]+\/(?:internal\.json|manifest\.json|rows\/\d{4}\.json)$/,
    /^catalog\/generations\/gen_\d+_[a-z0-9-]+\/offers\/(?:china|korea|uae|europe|georgia)\/[a-zA-Z0-9_-]+\.json$/,
    /^catalog\/internal\/offers\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.json$/,
    /^catalog\/nonjp-intake\/v1\/(?:china|korea|uae|europe|georgia)\/\d{1,20}\/[1-9]\d{0,5}\/(?:complete\.json|source-input\.json|files\/report\.json\/\d+-[a-f0-9]{64}\.json)$/,
    /^catalog\/intake-staging\/encar\/\d{1,20}\/[1-9]\d{0,5}\/complete\.json$/,
    /^catalog\/paid-encar-reports\/v1\/[1-9]\d{0,15}\/complete\.json$/,
    /^catalog\/provider-snapshots\/che168\/[a-f0-9]{64}\/manifest\.json$/,
    /^catalog\/provider-replicas\/che168\/[a-f0-9-]{36}\/manifest\.json$/,
  ];
  assert.ok(allowed.some(pattern => pattern.test(key)), 'owned_json_key_scope');
  return key;
}

export function assertOwnedSignedReadUrl(value, key) {
  ownedKey(key);
  let url;
  try {url = new URL(value);} catch {throw Error('owned_json_url');}
  const expectedPath = '/' + OWNED_RAW_READ_TARGET.bucket + '/' + (OWNED_RAW_READ_TARGET.prefix + key).split('/').map(encodeURIComponent).join('/');
  assert.ok(url.origin === OWNED_RAW_READ_TARGET.origin && !url.username && !url.password && !url.hash
    && url.pathname === expectedPath && [...url.searchParams.keys()].length === SIGNED_FIELDS.length
    && SIGNED_FIELDS.every(name => url.searchParams.getAll(name).length === 1), 'owned_json_target');
  assert.ok(url.searchParams.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256'
    && url.searchParams.get('X-Amz-SignedHeaders') === 'host'
    && /^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') || '')
    && /^\d{8}T\d{6}Z$/.test(url.searchParams.get('X-Amz-Date') || '')
    && /^[^/\s]+\/\d{8}\/[a-z0-9-]+\/s3\/aws4_request$/.test(url.searchParams.get('X-Amz-Credential') || '')
    && Number(url.searchParams.get('X-Amz-Expires')) >= 60
    && Number(url.searchParams.get('X-Amz-Expires')) <= 300, 'owned_json_signature');
  return url.toString();
}

/** Strictly owned immutable JSON only. The signed URL is never returned or
 * logged. Identity encoding makes the wire and decoded byte cap identical;
 * gzip-base64 archive parts have their own separate inflation bound. */
export async function readOwnedJsonBounded({storage, key, maxBytes, deadline = Date.now() + 30000, fetcher = globalThis.fetch}) {
  ownedKey(key);
  assert.ok(storage?.driver === 'object' && Number.isSafeInteger(maxBytes) && maxBytes > 0
    && maxBytes <= 64 * 1024 * 1024 && Number.isFinite(deadline) && deadline > Date.now(), 'owned_json_read_bound');
  // A coordinated raw session implements this method inside its existing
  // permission/drain queue. It does not expose a detached raw download URL.
  if (typeof storage.readJsonBounded === 'function') return storage.readJsonBounded(key, maxBytes, {deadline});
  assert.equal(typeof storage.createBinaryDownloadUrl, 'function', 'owned_json_signer_required');
  let signed;
  try {signed = await storage.createBinaryDownloadUrl(key, 120);} catch {throw Error('owned_json_sign_failed');}
  const url = assertOwnedSignedReadUrl(signed, key), controller = new AbortController();
  let reader, timer, cancelled = false;
  const cancel = reason => {
    cancelled = true; controller.abort();
    // An uncooperative body cancellation must not extend the hard deadline.
    // Abort the owned GET immediately and observe cancellation without waiting
    // for a second, potentially unbounded stream implementation promise.
    try {void reader?.cancel(reason).catch(() => {});} catch {}
  };
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {void cancel('owned_json_deadline'); reject(Error('owned_json_deadline'));}, Math.max(1, deadline - Date.now()));
  });
  const consume = async () => {
    let response;
    try {response = await fetcher(url, {method: 'GET', redirect: 'error', headers: {'accept-encoding': 'identity'}, signal: controller.signal});}
    catch {throw Error(cancelled ? 'owned_json_deadline' : 'owned_json_transport');}
    reader = response.body?.getReader();
    if (cancelled) {await cancel('owned_json_deadline'); throw Error('owned_json_deadline');}
    assert.equal(response.redirected, false, 'owned_json_redirect');
    if (response.url) assertOwnedSignedReadUrl(response.url, key);
    if (response.status === 404) {await cancel('owned_json_absent'); return {found: false, value: null, bytes: 0};}
    if (response.status !== 200) {await cancel('owned_json_http'); throw Error('owned_json_http_' + response.status);}
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') {await cancel('owned_json_encoding'); throw Error('owned_json_encoding');}
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      await cancel('owned_json_bytes'); throw Error('owned_json_bytes');
    }
    assert.ok(reader, 'owned_json_body_missing');
    const chunks = []; let bytes = 0;
    while (true) {
      let next;
      try {next = await reader.read();} catch {throw Error(cancelled ? 'owned_json_deadline' : 'owned_json_transport');}
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {await cancel('owned_json_bytes'); throw Error('owned_json_bytes');}
      chunks.push(next.value);
    }
    if (cancelled || Date.now() > deadline) throw Error('owned_json_deadline');
    if (length !== null && bytes !== Number(length)) throw Error('owned_json_length');
    let value;
    try {value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, bytes)));}
    catch {throw Error('owned_json_malformed');}
    return {found: true, value, bytes};
  };
  try {return await Promise.race([consume(), timeout]);}
  catch (error) {await cancel('owned_json_failed'); throw error;}
  finally {clearTimeout(timer); try {reader?.releaseLock();} catch {}}
}
