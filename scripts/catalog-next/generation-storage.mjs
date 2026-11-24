import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {signRawGcS3Request} from '../lib/catalog-raw-gc-s3.mjs';
import {privateOwnerAcl, nonGrantingPolicy} from './private-storage.mjs';

export const CHINA_GENERATION_FILES = Object.freeze([
  'DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'GENERATION.json',
  'RECONCILIATION.json', 'RUNTIME_CONTEXT.json', 'SOURCE.json', 'china-market.json',
  'cny-anchors.json', 'details.sqlite', 'editorial.json', 'exchange-rates.json',
  'query.sqlite', 'source.sqlite',
]);
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => assert(value, 'china_generation_storage_' + code);

export function chinaGenerationRoot(owner) {
  need(owner && /^[1-9]\d{0,19}$/.test(owner.runId ?? '') && /^[1-9]\d{0,5}$/.test(owner.attempt ?? '') &&
    /^[a-f0-9]{40}$/.test(owner.revision ?? ''), 'owner');
  return `catalog/market-rebuild/v1/china/runs/${owner.runId}/${owner.attempt}/generation`;
}

/** Private create-only transport for one complete China generation. Neither
 * live heads nor any other market are addressable. No list/delete capability. */
export function createPrivateChinaGenerationStorage({owner, environment = process.env, fetcher = fetch}) {
  const root = chinaGenerationRoot(owner);
  for (const [key, value] of Object.entries({YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud',
    YC_OBJECT_STORAGE_REGION: 'us-east-1', YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751',
    YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/'})) need(environment[key] === value, 'configuration');
  const accessKeyId = environment.YC_OBJECT_STORAGE_ACCESS_KEY_ID, secretAccessKey = environment.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  need(typeof accessKeyId === 'string' && accessKeyId.length > 0 && typeof secretAccessKey === 'string' && secretAccessKey.length > 0, 'credentials');
  const valid = key => key === root + '/complete.json' || CHINA_GENERATION_FILES.some(name =>
    key.startsWith(root + '/files/' + name + '/') && /^[0-9]+-[a-f0-9]{64}$/.test(key.slice((root + '/files/' + name + '/').length)));
  let privacy;
  const request = async (method, key, query = {}, body, headers = {}, limit = 64 * 1024) => {
    need(key === null || valid(key), 'key');
    const target = '/avtocena-staging-8120751' + (key === null ? '' : '/migration-staging/full-20261011/' + key);
    const signed = signRawGcS3Request({method, host: 's3.regru.cloud', path: target, query, body: body ?? '', headers,
      region: 'us-east-1', accessKeyId, secretAccessKey, at: Date.now()});
    let response;
    try { response = await fetcher('https://s3.regru.cloud' + signed.canonicalPath +
      (signed.canonicalQuery ? '?' + signed.canonicalQuery : ''), {method, headers: signed.headers, body,
      redirect: 'error', signal: AbortSignal.timeout(60000)}); }
    catch { throw Error('china_generation_storage_transport'); }
    const chunks = []; let bytes = 0;
    try { for await (const chunk of response.body ?? []) {
      bytes += chunk.byteLength; need(bytes <= limit, 'response_size'); chunks.push(Buffer.from(chunk));
    }} catch { throw Error('china_generation_storage_incomplete'); }
    return {status: response.status, data: Buffer.concat(chunks, bytes)};
  };
  const assertPrivateBucket = async () => {
    const acl = await request('GET', null, {acl: ''}); need(acl.status === 200, 'bucket_acl');
    const currentOwner = privateOwnerAcl(acl.data.toString());
    const policy = await request('GET', null, {policy: ''});
    const current = {owner: currentOwner, policySha256: nonGrantingPolicy(policy.status, policy.data.toString())};
    if (privacy) need(JSON.stringify(current) === JSON.stringify(privacy), 'privacy_changed'); else privacy = current;
    return {verified: true};
  };
  const getBinary = async key => {
    need(privacy, 'privacy_not_checked');
    const acl = await request('GET', key, {acl: ''});
    need(acl.status === 200 && privateOwnerAcl(acl.data.toString()) === privacy.owner, 'object_acl');
    const result = await request('GET', key, {}, undefined, {}, 8 * 1024 * 1024);
    need(result.status === 200 && result.data.length > 0, 'read');
    return {data: result.data, size: result.data.length, checksum: hash(result.data)};
  };
  const putBinary = async (key, bytes, contentType, condition) => {
    need(privacy && valid(key) && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, 'write');
    need(JSON.stringify(condition) === JSON.stringify({ifNoneMatch: '*'}), 'create_only');
    const result = await request('PUT', key, {}, bytes,
      {'content-type': contentType, 'if-none-match': '*', 'x-amz-acl': 'private'});
    need(result.status === 200 || result.status === 201, 'create_failed');
    return {size: bytes.length, checksum: hash(bytes)};
  };
  return {root, assertPrivateBucket, getBinary, putBinary};
}
