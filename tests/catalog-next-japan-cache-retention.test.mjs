import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {TARGET, CACHE_PREFIXES, LIMITS, cacheKeyGroup, parseAuditXml, parseVersioning, summarizeLifecycle,
  parseCacheList, inspectCachePayload, createJapanCacheAuditStorage, runJapanCacheRetention, verifyInvocation} from '../scripts/catalog-next/japan-cache-retention-audit.mjs';
import {signRawGcS3Request, signSyntheticS3DeleteRequest} from '../scripts/lib/catalog-raw-gc-s3.mjs';

const now = Date.parse('2026-11-27T12:00:00.000Z'), old = new Date(now - 8 * 86400000).toISOString();
const env = {REGCLOUD_S3_ACCESS_KEY_ID: 'UNITTESTKEY', REGCLOUD_S3_SECRET_ACCESS_KEY: 'private-canary-secret'};
const owner = {runId: '12345', attempt: '1', revision: 'a'.repeat(40)};
const invocation = {sourceSha: owner.revision, approvedSourceSha: owner.revision, runId: owner.runId, attempt: owner.attempt};
const nonce = 'b'.repeat(48), sha = value => createHash('sha256').update(value).digest('hex');
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ACL = '<AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>owner</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
const error = code => '<Error><Code>' + code + '</Code></Error>';
const response = (body = '', status = 200, headers = {}) => new Response([204, 304].includes(status) ? null : body,
  {status, headers: {...([204, 304].includes(status) ? {} : {'content-length': String(Buffer.byteLength(body))}), ...headers}});
function listXml(prefix, objects, cursor = null, next = null) {
  return '<ListBucketResult><Name>' + TARGET.bucket + '</Name><Prefix>' + xml(encodeURIComponent(TARGET.prefix + prefix))
    + '</Prefix><MaxKeys>' + LIMITS.listKeys + '</MaxKeys><KeyCount>' + objects.length + '</KeyCount><EncodingType>url</EncodingType>'
    + '<IsTruncated>' + Boolean(next) + '</IsTruncated>' + (cursor ? '<ContinuationToken>' + xml(cursor) + '</ContinuationToken>' : '')
    + (next ? '<NextContinuationToken>' + xml(next) + '</NextContinuationToken>' : '')
    + objects.map(row => '<Contents><Key>' + xml(encodeURIComponent(TARGET.prefix + row.key)) + '</Key><ETag>' + xml(row.etag)
      + '</ETag><Size>' + row.body.length + '</Size><LastModified>' + row.at + '</LastModified><Type>Normal</Type></Contents>').join('')
    + '</ListBucketResult>';
}
function fakeStorage({versioning = 'never_enabled', lifecycle = null, ignoreDeleteCondition = false,
  rejectDelete = false, missingVersionHeader = false, versioningDrift = false, changedCache = false,
  transportError = false, invalidAcl = false, unexpectedVersionHeader = false, versioningErrorAtRead = null,
  versioningDriftAtRead = 2, staleRejectedStatus = 412} = {}) {
  const calls = [], cache = new Map(), synthetic = new Map(); let sequence = 0, settingsReads = 0;
  const seed = (key, value, at = old) => {
    const body = Buffer.from(JSON.stringify(value)); cache.set(key, {key, body, etag: '"' + sha(body) + '"', at});
  };
  const fetcher = async (input, options) => {
    const url = new URL(input), method = options.method, headers = new Headers(options.headers);
    assert.equal(url.origin, TARGET.endpoint); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(headers.get('accept-encoding'), 'identity');
    calls.push({method, path: decodeURIComponent(url.pathname), query: Object.fromEntries(url.searchParams), headers});
    if (transportError) throw Error('private-canary-secret SQL SELECT visitorIp=203.0.113.17 https://private.example/feed');
    const bucket = '/' + TARGET.bucket;
    if (url.pathname === bucket) {
      assert.equal(method, 'GET');
      if (url.searchParams.has('acl')) return response(invalidAcl ? '<AccessControlPolicy><private>SECRET</private></AccessControlPolicy>' : ACL);
      if (url.searchParams.has('policy')) return response(error('NoSuchBucketPolicy'), 404);
      if (url.searchParams.has('versioning')) {
        settingsReads++;
        if (settingsReads === versioningErrorAtRead) throw Error('PRIVATE versioning response lost');
        const state = versioningDrift && settingsReads >= versioningDriftAtRead ? 'Enabled' : {never_enabled: null, enabled: 'Enabled', suspended: 'Suspended'}[versioning];
        return response('<VersioningConfiguration>' + (state ? '<Status>' + state + '</Status>' : '') + '</VersioningConfiguration>');
      }
      if (url.searchParams.has('lifecycle')) return lifecycle ? response(lifecycle) : response(error('NoSuchLifecycleConfiguration'), 404);
      assert.equal(url.searchParams.get('list-type'), '2');
      const prefix = url.searchParams.get('prefix').slice(TARGET.prefix.length);
      assert(CACHE_PREFIXES.includes(prefix));
      const cursor = url.searchParams.get('continuation-token'), offset = cursor ? Number(cursor.slice(1)) : 0;
      const all = [...cache.values()].filter(row => row.key.startsWith(prefix)), rows = all.slice(offset, offset + LIMITS.listKeys);
      const next = offset + rows.length < all.length ? 'n' + (offset + rows.length) : null;
      return response(listXml(prefix, rows, cursor, next));
    }
    const full = decodeURIComponent(url.pathname); assert(full.startsWith(bucket + '/' + TARGET.prefix));
    const key = full.slice((bucket + '/' + TARGET.prefix).length);
    if (key.startsWith('catalog/partner-cache/ajes/')) {
      assert.equal(method, 'GET', 'actual cache mutation is always forbidden');
      assert.deepEqual([...url.searchParams.keys()], []);
      const row = cache.get(key); if (!row) return response(error('NoSuchKey'), 404);
      if (changedCache) return response(error('PreconditionFailed'), 412);
      assert.equal(headers.get('if-match'), row.etag);
      return response(row.body, 200, {etag: row.etag, 'last-modified': row.at});
    }
    assert.match(key, /^catalog\/operations\/ajes-cache-retention-canary\/v1\/12345\/1\/[a-f0-9]{48}\.json$/);
    const versions = synthetic.get(key) ?? [];
    const versionId = url.searchParams.get('versionId');
    const current = versionId ? versions.find(row => row.versionId === versionId) : versions.at(-1);
    if (method === 'PUT') {
      assert.equal(versionId, null); assert.equal(headers.get('x-amz-acl'), 'private');
      if (headers.has('if-none-match')) {
        assert.equal(headers.get('if-none-match'), '*'); if (current) return response(error('PreconditionFailed'), 412);
      } else {
        assert(current); assert.equal(headers.get('if-match'), current.etag.slice(1, -1), 'existing REG PUT wire convention');
      }
      const body = Buffer.from(options.body); assert(body.length <= LIMITS.canaryBytes);
      const row = {body, etag: '"' + sha(body) + '"', versionId: versioning === 'enabled' || unexpectedVersionHeader ? 'v' + ++sequence : null};
      synthetic.set(key, row.versionId ? [...versions, row] : [row]);
      return response('', 200, {etag: row.etag, ...(row.versionId ? {'x-amz-version-id': row.versionId} : {})});
    }
    if (method === 'GET') {
      if (!current) return response(error(versionId ? 'NoSuchVersion' : 'NoSuchKey'), 404);
      return response(current.body, 200, {etag: current.etag,
        ...(!missingVersionHeader && current.versionId ? {'x-amz-version-id': current.versionId} : {})});
    }
    assert.equal(method, 'DELETE'); assert(headers.get('authorization').includes('if-match'));
    if (versioning === 'enabled' || unexpectedVersionHeader) assert(versionId, 'versioned canaries never use bare DELETE');
    if (rejectDelete) return response(error('NotImplemented'), 501);
    if (!current) return response('', 204);
    if (!ignoreDeleteCondition && headers.get('if-match') !== current.etag) return response(error('PreconditionFailed'), staleRejectedStatus);
    synthetic.set(key, versions.filter(row => row !== current));
    return response('', 204, current.versionId ? {'x-amz-version-id': current.versionId} : {});
  };
  return {calls, cache, synthetic, seed, fetcher};
}
const run = (mode, fake, options = {}) => runJapanCacheRetention({mode, invocation, environment: env, fetcher: fake.fetcher, now: () => now, nonce, ...options});

test('each mode binds the exact workflow and inspect job before credentials or requests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-cache-invocation-'));
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  try {
    git(['init', '--quiet']);
    git(['-c', 'user.name=Offline test', '-c', 'user.email=offline@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'fixture']);
    const source = git(['rev-parse', 'HEAD']);
    const base = {GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938', GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: source, EXPECTED_CONTROLLER_SHA: source,
      GITHUB_RUN_ID: owner.runId, GITHUB_JOB: 'inspect'};
    for (const mode of ['audit', 'canary']) {
      const environment = {...base, GITHUB_WORKFLOW_REF: 'jeep-jim/AvtoCena/.github/workflows/japan-cache-retention-' + mode + '.yml@refs/heads/main'};
      assert.equal(verifyInvocation(mode, {root, environment}).sourceSha, source);
      for (const changed of [{GITHUB_JOB: 'cleanup'}, {GITHUB_JOB: undefined},
        {GITHUB_WORKFLOW_REF: environment.GITHUB_WORKFLOW_REF.replace(mode + '.yml', (mode === 'audit' ? 'canary' : 'audit') + '.yml')},
        {GITHUB_WORKFLOW_REF: environment.GITHUB_WORKFLOW_REF.replace('@refs/heads/main', '@refs/heads/other')},
        {GITHUB_WORKFLOW_REF: undefined}])
        assert.throws(() => verifyInvocation(mode, {root, environment: {...environment, ...changed}}), /japan_cache_audit_workflow/);
    }
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test('existing signer keeps its method fence; the new pure delete signer signs the exact condition', () => {
  const args = {method: 'DELETE', host: 's3.regru.cloud', path: '/bucket/canary', region: 'us-east-1',
    accessKeyId: 'TEST', secretAccessKey: 'SECRET', at: now, headers: {'if-match': '"old"'}};
  assert.throws(() => signRawGcS3Request(args), /raw_gc_s3_method/);
  const first = signSyntheticS3DeleteRequest(args), second = signSyntheticS3DeleteRequest({...args, headers: {'if-match': '"new"'}});
  assert(first.headers.authorization.includes('SignedHeaders=host;if-match;'));
  assert.notEqual(first.signature, second.signature);
  assert.throws(() => signSyntheticS3DeleteRequest({...args, method: 'PUT'}), /synthetic_s3_delete_method/);
});

test('audit inventories only bounded AJ prefixes and inspects at most eight expired bodies without logging them', async () => {
  const fake = fakeStorage();
  for (let i = 0; i < 12; i++) fake.seed(CACHE_PREFIXES[0] + 'private-' + i + '.json',
    {observedAt: old, items: [{id: 'PRIVATE-ID', frameNumber: 'PRIVATE-FRAME', sql: 'SELECT PRIVATE', ip: '203.0.113.17'}]});
  fake.seed(CACHE_PREFIXES[1] + 'fresh.json', {observedAt: new Date(now).toISOString(), items: []}, new Date(now).toISOString());
  const before = [...fake.cache].map(([key, value]) => [key, value.body.toString()]);
  const report = await run('audit', fake);
  assert.equal(report.completed, true); assert.equal(report.requests.bodyInspections, 8);
  assert.equal(report.inspections.expired, 8); assert.equal(report.inspections.limited, true);
  assert.equal(report.inventory[0].objects, 12); assert.equal(report.inventory[1].metadataOlderThanSevenDays, 0);
  assert(fake.calls.every(row => row.method === 'GET'));
  assert.deepEqual([...fake.cache].map(([key, value]) => [key, value.body.toString()]), before);
  const publicText = JSON.stringify(report);
  for (const forbidden of ['PRIVATE', 'SELECT', '203.0.113.17', 'private-', env.REGCLOUD_S3_ACCESS_KEY_ID, env.REGCLOUD_S3_SECRET_ACCESS_KEY])
    assert.equal(publicText.includes(forbidden), false, forbidden);
  assert.equal(report.cacheMutations, 0); assert.equal(report.versionHistoryInventoried, false); assert.equal(report.hostDiskMeasured, false);
});

test('query inspection distinguishes expired and usable snapshots, never equates object age with entry expiry', async () => {
  const fake = fakeStorage(), fresh = new Date(now - 60000).toISOString();
  fake.seed(CACHE_PREFIXES[2] + '0.json', {hash: 'a'.repeat(64), value: {observedAt: fresh, items: []},
    previous: [{hash: 'b'.repeat(64), value: {observedAt: old, items: []}}]});
  const report = await run('audit', fake);
  assert.equal(report.inspections.expired, 1); assert.equal(report.inspections.retained, 1);
  assert.equal(report.cacheDeletionEnabled, false);
  assert.deepEqual(inspectCachePayload(Buffer.from('{bad private'), 'stats', now - 7 * 86400000), {snapshots: 0, expired: 0, retained: 0, invalid: 1});
  assert.equal(inspectCachePayload(Buffer.from(JSON.stringify({observedAt: '2026-02-30T00:00:00Z', items: []})), 'stats', now - 7 * 86400000).invalid, 1);
  assert.equal(inspectCachePayload(Buffer.from(JSON.stringify({observedAt: new Date(now + 1000).toISOString(), items: []})), 'stats', now - 7 * 86400000).invalid, 1);
});

test('changed cache ETag is a counted skip with no retry, replacement or deletion', async () => {
  const fake = fakeStorage({changedCache: true}); fake.seed(CACHE_PREFIXES[0] + 'one.json', {observedAt: old, items: []});
  const report = await run('audit', fake);
  assert.equal(report.completed, true); assert.equal(report.inspections.changedDuringRead, 1);
  assert.equal(report.inspections.snapshots, 0); assert.equal(report.requests.bodyInspections, 1);
  assert(fake.calls.every(row => row.method === 'GET'));
});

test('metadata pagination is bounded and honestly marked incomplete', async () => {
  const fake = fakeStorage();
  for (let i = 0; i < 250; i++) fake.seed(CACHE_PREFIXES[0] + i + '.json', {observedAt: old, items: []});
  const report = await run('audit', fake);
  assert.equal(report.inventory[0].objects, 200); assert.equal(report.inventory[0].complete, false);
  assert.equal(report.requests.metadataPages, 4); assert.equal(report.requests.bodyInspections, 8);
});

test('audit capability rejects forged/unlisted/fresh body reads and has no cache mutation method', async () => {
  const fake = fakeStorage(); fake.seed(CACHE_PREFIXES[0] + 'fresh.json', {observedAt: new Date(now).toISOString(), items: []}, new Date(now).toISOString());
  const io = createJapanCacheAuditStorage({mode: 'audit', owner, environment: env, fetcher: fake.fetcher, now: () => now, nonce});
  await io.settings(); const listed = await io.list(CACHE_PREFIXES[0]); const before = fake.calls.length;
  await assert.rejects(io.inspect({...listed.objects[0], lastModified: old}), /inspection_scope/);
  await assert.rejects(io.inspect(listed.objects[0]), /inspection_scope/);
  await assert.rejects(io.createCanary(), /canary_create_scope/);
  assert.equal(io.deleteJson, undefined); assert.equal(io.writeJson, undefined); assert.equal(io.request, undefined);
  assert.equal(fake.calls.length, before);
});

test('unversioned synthetic canary proves stale rejection and current deletion on its own nonce only', async () => {
  const fake = fakeStorage(); const report = await run('canary', fake);
  assert.equal(report.completed, true); assert.equal(report.canary.supportedForTestedTarget, true);
  assert.equal(report.canary.currentObjectConditionalDeleteVerified, true); assert.equal(report.canary.residuePossible, false);
  assert.equal(report.requests.syntheticPuts, 2); assert.equal(report.requests.syntheticDeletes, 2);
  assert.equal(report.requests.bodyInspections, 0); assert.equal(report.requests.metadataPages, 0);
  assert(fake.calls.filter(row => ['PUT', 'DELETE'].includes(row.method)).every(row => row.path.includes('/catalog/operations/ajes-cache-retention-canary/v1/12345/1/')));
  assert.equal([...fake.synthetic.values()].flat().length, 0);
});

test('ignored stale precondition is unsupported, never followed by a real-cache delete or a second current delete', async () => {
  const fake = fakeStorage({ignoreDeleteCondition: true}); const report = await run('canary', fake);
  assert.equal(report.completed, true); assert.equal(report.canary.supportedForTestedTarget, false);
  assert.equal(report.canary.outcome, 'stale_precondition_not_enforced'); assert.equal(report.requests.syntheticDeletes, 1);
  assert.equal(report.cacheMutations, 0);
});

test('unsupported conditional deletion leaves only bounded synthetic residue and does not retry unconditionally', async () => {
  const fake = fakeStorage({rejectDelete: true}); const report = await run('canary', fake);
  assert.equal(report.canary.supportedForTestedTarget, false); assert.equal(report.canary.residuePossible, true);
  assert.equal(report.requests.syntheticDeletes, 1); assert.equal([...fake.synthetic.values()].flat().length, 1);
  assert(fake.calls.filter(row => row.method === 'DELETE').every(row => row.headers.has('if-match')));
});

test('enabled versioning uses only read-back non-null version IDs and reports scope separately', async () => {
  const fake = fakeStorage({versioning: 'enabled'}); const report = await run('canary', fake);
  assert.equal(report.completed, true); assert.equal(report.canary.target, 'immutable_version');
  assert.equal(report.canary.supportedForTestedTarget, true); assert.equal(report.canary.currentObjectConditionalDeleteVerified, false);
  assert.equal(report.canary.knownVersionsRemoved, 2); assert.equal(report.canary.residuePossible, false);
  assert(fake.calls.filter(row => row.method === 'DELETE').every(row => ['v1', 'v2'].includes(row.query.versionId)));
  assert.equal([...fake.synthetic.values()].flat().length, 0);
});

test('suspended bucket creates nothing; missing version IDs stop before DELETE and record tiny residue', async () => {
  const suspended = fakeStorage({versioning: 'suspended'}), skipped = await run('canary', suspended);
  assert.equal(skipped.completed, true); assert.equal(skipped.canary.outcome, 'version_fence_unavailable');
  assert.equal(skipped.requests.syntheticPuts, 0); assert.equal(skipped.requests.syntheticDeletes, 0);
  const broken = fakeStorage({versioning: 'enabled', missingVersionHeader: true}), failed = await run('canary', broken);
  assert.equal(failed.completed, false); assert.equal(failed.canary.residuePossible, true);
  assert.equal(failed.requests.syntheticDeletes, 0); assert.equal(failed.errorCode, 'japan_cache_audit_canary_version_changed');
});

test('versioning drift invalidates a conditional-current-delete conclusion and records possible residue', async () => {
  const fake = fakeStorage({versioningDrift: true}), report = await run('canary', fake);
  assert.equal(report.canary.versioningChanged, true); assert.equal(report.canary.currentObjectConditionalDeleteVerified, false);
  assert.equal(report.canary.supportedForTestedTarget, false); assert.equal(report.canary.residuePossible, true);
  assert.equal(report.requests.syntheticDeletes, 0);
  const late = await run('canary', fakeStorage({versioningDrift: true, versioningDriftAtRead: 3}));
  assert.equal(late.canary.currentObjectConditionalDeleteVerified, false); assert.equal(late.canary.residuePossible, true);
  assert.equal(late.canary.outcome, 'versioning_changed');
});

test('unexpected version header blocks a bare canary DELETE before using a stale bucket configuration', async () => {
  const report = await run('canary', fakeStorage({unexpectedVersionHeader: true}));
  assert.equal(report.completed, false); assert.equal(report.requests.syntheticDeletes, 0);
  assert.equal(report.canary.currentObjectConditionalDeleteVerified, false);
  assert.equal(report.canary.versioningChanged, true); assert.equal(report.canary.residuePossible, true);
});

test('a lost closing versioning response cannot leave successful capability flags in a failed report', async () => {
  const report = await run('canary', fakeStorage({versioningErrorAtRead: 3}));
  assert.equal(report.completed, false); assert.equal(report.canary.matchingConditionDeleted, true);
  assert.equal(report.canary.supportedForTestedTarget, false); assert.equal(report.canary.currentObjectConditionalDeleteVerified, false);
  assert.equal(report.canary.residuePossible, true); assert.equal(report.canary.outcome, 'probe_incomplete');
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
});

test('409 qualifies only when readback proves the updated synthetic object survived', async () => {
  const report = await run('canary', fakeStorage({staleRejectedStatus: 409}));
  assert.equal(report.canary.supportedForTestedTarget, true);
  assert.equal(report.canary.staleConditionRejected, true); assert.equal(report.canary.updatedObjectPreserved, true);
});

test('lifecycle projection reports whole/partial and tag restrictions without leaking unrelated rule names or values', () => {
  const body = '<LifecycleConfiguration>'
    + '<Rule><ID>PRIVATE-RULE</ID><Status>Enabled</Status><Filter><Prefix>' + TARGET.prefix + CACHE_PREFIXES[0] + '</Prefix></Filter><Expiration><Days>7</Days></Expiration><NoncurrentVersionExpiration><NoncurrentDays>8</NoncurrentDays></NoncurrentVersionExpiration></Rule>'
    + '<Rule><ID>PRIVATE-TAGGED</ID><Status>Enabled</Status><Filter><And><Prefix>' + TARGET.prefix + CACHE_PREFIXES[1] + 'partial/</Prefix><Tag><Key>PRIVATE-TAG</Key><Value>PRIVATE-VALUE</Value></Tag></And></Filter><Expiration><Days>9</Days></Expiration></Rule>'
    + '<Rule><ID>PRIVATE-CRM</ID><Status>Enabled</Status><Prefix>crm/private/</Prefix><Expiration><Days>1</Days></Expiration></Rule></LifecycleConfiguration>';
  const result = summarizeLifecycle(Buffer.from(body), 200);
  assert.equal(result.totalRules, 3); assert.equal(result.matchingRules, 2);
  assert.deepEqual(result.rules[0].coverage, [{group: 'stats', coverage: 'whole_prefix'}]);
  assert.equal(result.rules[0].currentExpirationDays, 7); assert.equal(result.rules[0].noncurrentExpirationDays, 8);
  assert.deepEqual(result.rules[1].coverage, [{group: 'main', coverage: 'partial_prefix'}]); assert.equal(result.rules[1].additionalFilter, true);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false); assert.equal(JSON.stringify(result).includes('crm'), false);
});

test('malformed XML, versioning and lifecycle must not become a safe cleanup configuration', () => {
  for (const body of ['<!DOCTYPE x><VersioningConfiguration/>', '<VersioningConfiguration><Status>Enabled</Status><Status>Suspended</Status></VersioningConfiguration>',
    '<VersioningConfiguration><Status>Disabled</Status></VersioningConfiguration>', '<VersioningConfiguration><Status>&unknown;</Status></VersioningConfiguration>'])
    assert.throws(() => parseVersioning(Buffer.from(body)));
  assert.throws(() => parseAuditXml('<a><b></a>'));
  assert.throws(() => summarizeLifecycle(Buffer.from(error('AccessDenied')), 404), /lifecycle_http/);
  assert.throws(() => summarizeLifecycle(Buffer.from('<LifecycleConfiguration><Rule><Status>Enabled</Status><Expiration><Days>7</Days><Date>2026-01-01T00:00:00Z</Date></Expiration></Rule></LifecycleConfiguration>'), 200), /lifecycle_expiration/);
});

test('foreign listing keys/cursors and raw diagnostics never escape the report', async () => {
  const row = {key: 'catalog/CRM/private.json', etag: '"tag"', body: Buffer.from('{}'), at: old};
  assert.throws(() => parseCacheList(Buffer.from(listXml(CACHE_PREFIXES[0], [row])), CACHE_PREFIXES[0]), /list_object/);
  for (const key of ['catalog/partner-cache/ajes/korea/1.json', CACHE_PREFIXES[0] + '../private.json', CACHE_PREFIXES[2] + '128.json', CACHE_PREFIXES[2] + 'directories/models-128.json'])
    assert.equal(cacheKeyGroup(key), null);
  const fake = fakeStorage({transportError: true}), report = await run('audit', fake);
  assert.equal(report.completed, false); assert.equal(report.errorCode, 'japan_cache_audit_failed');
  for (const secret of ['private-canary-secret', 'SELECT', '203.0.113.17', 'private.example']) assert.equal(JSON.stringify(report).includes(secret), false);
});

test('privacy failure stops before any object listing, inspection or canary creation', async () => {
  const fake = fakeStorage({invalidAcl: true}), report = await run('canary', fake);
  assert.equal(report.completed, false); assert.equal(report.requests.requests, 1);
  assert.equal(report.requests.syntheticPuts, 0); assert.equal(report.requests.syntheticDeletes, 0);
});

test('oversized response stops the audit without persisting its body', async () => {
  const report = await runJapanCacheRetention({mode: 'audit', invocation, environment: env, now: () => now, nonce,
    fetcher: async () => response('PRIVATE', 200, {'content-length': String(LIMITS.xmlBytes + 1)})});
  assert.equal(report.completed, false); assert.equal(report.errorCode, 'japan_cache_audit_response_size');
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false); assert.equal(report.requests.requests, 1);
});

test('expired operation deadline prevents a request before fetch', async () => {
  let clock = now, calls = 0;
  const io = createJapanCacheAuditStorage({mode: 'audit', owner, environment: env, now: () => clock, nonce,
    fetcher: async () => { calls++; throw Error('must not fetch'); }});
  clock += LIMITS.totalMs;
  await assert.rejects(io.settings(), /request_budget/); assert.equal(calls, 0);
});

test('a bodyless fetch that resolves after the operation deadline cannot continue the audit', async () => {
  let clock = now;
  const io = createJapanCacheAuditStorage({mode: 'audit', owner, environment: env, now: () => clock, nonce,
    fetcher: async () => { clock += LIMITS.totalMs; return response('', 204); }});
  await assert.rejects(io.settings(), /deadline/); assert.equal(io.stats().requests, 1);
});
