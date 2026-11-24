import {signRawGcS3Request} from '../lib/catalog-raw-gc-s3.mjs';
import {privateOwnerAcl, nonGrantingPolicy} from './private-storage.mjs';
import {chinaGenerationRoot, CHINA_GENERATION_FILES} from './generation-storage.mjs';
import {FAILED_DAILY_PREFIX, FAILED_DAILY_QUEUE_KEY, HASH, natural, encoded, digest, equal, need, observation, etag, absent, validateHeader, validateSlot, validateReplacement, tombstone} from './failed-daily-contract.mjs';

const DOCUMENT_LIMIT = 24 * 1024 * 1024, PART = 8 * 1024 * 1024;
const recordKey = id => { need(HASH.test(id ?? ''), 'attempt_id'); return FAILED_DAILY_PREFIX + 'attempts/' + id + '/state.json'; };
const journalKey = (id, index) => { recordKey(id); need(natural(index) && index > 0, 'journal_index'); return FAILED_DAILY_PREFIX + 'attempts/' + id + '/journal/' + index + '.json'; };
const evidenceKey = id => { recordKey(id); return FAILED_DAILY_PREFIX + 'attempts/' + id + '/private-evidence.json'; };

/** A separate cleanup capability. The original generation writer remains
 * create-only; this capability has no DELETE, list, arbitrary key or arbitrary
 * replacement body. Every payload replacement is a bound permanent tombstone. */
export function createFailedDailyStorage({environment = process.env, fetcher = globalThis.fetch, now = () => new Date().toISOString(), deadlineAt = null} = {}) {
  for (const [name, expected] of Object.entries({YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
    YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/'}))
    need(environment[name] === expected, 'storage_configuration');
  const accessKeyId = environment.YC_OBJECT_STORAGE_ACCESS_KEY_ID, secretAccessKey = environment.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  need(typeof accessKeyId === 'string' && /^[A-Za-z0-9_+=./-]{1,256}$/.test(accessKeyId)
    && typeof secretAccessKey === 'string' && secretAccessKey.length > 0 && secretAccessKey.length <= 1024 && !/[\r\n\x00]/.test(secretAccessKey), 'credentials');
  need(typeof fetcher === 'function' && typeof now === 'function' && (deadlineAt === null || Number.isFinite(Date.parse(deadlineAt))), 'storage_arguments');
  let privacy;
  async function request(method, key, query = {}, body, headers = {}, maximum = DOCUMENT_LIMIT) {
    const left = deadlineAt === null ? 30000 : Date.parse(deadlineAt) - Date.parse(now());
    need(left > 0, 'deadline');
    const physical = '/avtocena-staging-8120751' + (key === null ? '' : '/migration-staging/full-20261011/' + key);
    const signed = signRawGcS3Request({method, host: 's3.regru.cloud', path: physical, query, body: body ?? '', headers,
      region: 'us-east-1', accessKeyId, secretAccessKey, at: Date.parse(now())});
    let response;
    try { response = await fetcher('https://s3.regru.cloud' + signed.canonicalPath + (signed.canonicalQuery ? '?' + signed.canonicalQuery : ''),
      {method, headers: signed.headers, body, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(30000, Math.floor(left))))}); }
    catch { throw Error('china_failed_daily_storage_transport'); }
    const chunks = []; let bytes = 0;
    try { for await (const chunk of response.body ?? []) { bytes += chunk.byteLength; need(bytes <= maximum, 'response_size'); chunks.push(Buffer.from(chunk)); } }
    catch { throw Error('china_failed_daily_storage_incomplete'); }
    return {status: response.status, data: Buffer.concat(chunks, bytes), etag: response.headers.get('etag')};
  }
  async function assertPrivateBucket() {
    const acl = await request('GET', null, {acl: ''}, undefined, {}, 65536); need(acl.status === 200, 'bucket_acl');
    const policy = await request('GET', null, {policy: ''}, undefined, {}, 65536);
    const next = {owner: privateOwnerAcl(acl.data.toString()), policySha256: nonGrantingPolicy(policy.status, policy.data.toString())};
    if (privacy) need(equal(privacy, next), 'privacy_changed'); else privacy = next;
    return {verified: true};
  }
  async function raw(key, maximum) {
    need(privacy, 'privacy_not_checked');
    const acl = await request('GET', key, {acl: ''}, undefined, {}, 65536);
    need(acl.status === 404 || acl.status === 200 && privateOwnerAcl(acl.data.toString()) === privacy.owner, 'object_acl');
    const value = await request('GET', key, {}, undefined, {}, maximum);
    if (acl.status === 404) { need(value.status === 404, 'missing_changed'); return {found: false, data: null, etag: null, size: null}; }
    need(value.status === 200 && etag(value.etag) && value.data.length > 0, 'storage_read');
    return {found: true, data: value.data, etag: value.etag, size: value.data.length};
  }
  async function readDocument(key) {
    const value = await raw(key, DOCUMENT_LIMIT); if (!value.found) return absent();
    let parsed; try { parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(value.data)); } catch { throw Error('china_failed_daily_document_json'); }
    need(value.data.equals(encoded(parsed)), 'document_canonical');
    return observation({found: true, etag: value.etag, sha256: digest(value.data), value: parsed});
  }
  async function putDocument(key, previous, next) {
    need(privacy, 'privacy_not_checked'); observation(previous); const body = encoded(next); need(body.length <= DOCUMENT_LIMIT, 'document_size');
    const condition = previous.found ? {'if-match': previous.etag.slice(1, -1)} : {'if-none-match': '*'};
    const value = await request('PUT', key, {}, body, {'content-type': 'application/json', 'x-amz-acl': 'private', ...condition}, 65536);
    need(value.status !== 409 && value.status !== 412, 'storage_conflict');
    need(value.status === 200 || value.status === 201, 'storage_write');
  }
  function payloadKey(header, key) {
    validateHeader(header); const root = chinaGenerationRoot(header.owner);
    need(key === root + '/complete.json' || CHINA_GENERATION_FILES.some(name => {
      const prefix = root + '/files/' + name + '/';
      return typeof key === 'string' && key.startsWith(prefix) && /^[0-9]+-[a-f0-9]{64}$/.test(key.slice(prefix.length));
    }), 'payload_key');
    return key;
  }
  return Object.freeze({
    assertPrivateBucket,
    readQueue: () => readDocument(FAILED_DAILY_QUEUE_KEY),
    compareAndSwapQueue: (previous, next) => putDocument(FAILED_DAILY_QUEUE_KEY, previous, next),
    readRecord: id => readDocument(recordKey(id)),
    compareAndSwapRecord: (id, previous, next) => putDocument(recordKey(id), previous, next),
    readJournal: (id, index) => readDocument(journalKey(id, index)),
    createJournal: (id, index, next) => putDocument(journalKey(id, index), absent(), next),
    readEvidence: id => readDocument(evidenceKey(id)),
    createEvidence: (id, next) => putDocument(evidenceKey(id), absent(), next),
    getPayload: (header, key) => raw(payloadKey(header, key), PART),
    async putTombstone({record, slot, previous, marker, assertAuthority}) {
      validateHeader(record.header); validateSlot(slot, record.header); validateReplacement(record.replacement, record);
      need(record.phase === 'failed' && HASH.test(record.closedJournalSha256 ?? '')
        && equal(marker, tombstone(record.header, record.closedJournalSha256, slot, record.replacement))
        && typeof assertAuthority === 'function', 'retirement_scope');
      need(previous && typeof previous.found === 'boolean' && (previous.found ? etag(previous.etag) : previous.etag === null), 'payload_observation');
      await assertAuthority(); const body = encoded(marker); need(body.length <= 1024, 'tombstone_size');
      const condition = previous.found ? {'if-match': previous.etag.slice(1, -1)} : {'if-none-match': '*'};
      const result = await request('PUT', payloadKey(record.header, slot.key), {}, body,
        {'content-type': 'application/json', 'x-amz-acl': 'private', ...condition}, 65536);
      need(result.status !== 409 && result.status !== 412, 'storage_conflict');
      need(result.status === 200 || result.status === 201, 'tombstone_write');
    },
  });
}
