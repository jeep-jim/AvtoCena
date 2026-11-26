import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {verifyCrmChinaManifest, checkedCrmChinaManifestProof, verifyCrmChinaUnauthorizedAccess,
  checkedCrmChinaEvidence, checkedCrmChinaBrowserFixture, checkedCrmChinaUnauthorizedResponse, verifyCrmChinaMiddleware}
  from '../scripts/catalog-next/crm-china-status-proof.mjs';
import {CRM_CHINA_CODE_SCOPE} from '../scripts/catalog-next/crm-china-code-scope.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
async function fixture(t, helperResult) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'crm-status-proof-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const runtimeRoot = path.join(directory, 'runtime'), manifestDirectory = path.join(directory, 'generation');
  const helper = path.join(runtimeRoot, 'apps/web/lib/catalog/china-catalog-status.ts');
  await fs.mkdir(path.dirname(helper), {recursive: true}); await fs.mkdir(manifestDirectory);
  const generation = {version: 1, kind: 'china-local-generation-v1', market: 'china', prepared: true,
    generationId: 'gen_china_123_1', runtimeSha: '6'.repeat(40), rows: 312345,
    source: {supplierLatestVerified: true, sourceObservedAt: '2026-11-26T17:00:00.000Z', cursor: 45}};
  // Preserve the noncanonical whitespace. Re-serializing these authenticated
  // bytes would fail their expected SHA even if the parsed fields matched.
  const raw = Buffer.from(JSON.stringify(generation, null, 3) + '\n\n');
  await fs.writeFile(path.join(manifestDirectory, 'GENERATION.json'), raw);
  const binding = {runtimeSha: '7'.repeat(40), pricingRuntimeSha: generation.runtimeSha,
    generationManifestSha256: hash(raw), generationId: generation.generationId,
    sourceObservedAt: generation.source.sourceObservedAt, rows: generation.rows};
  const expected = {status: 'ready', sourceObservedAt: binding.sourceObservedAt, rows: binding.rows, generationId: binding.generationId};
  await fs.writeFile(helper, `import fs from 'node:fs/promises';
export async function readChinaCatalogStatus(environment) {
  if (JSON.stringify(Object.keys(environment).sort()) !== JSON.stringify(['CATALOG_CHINA_LOCAL_GENERATION_DIR','CATALOG_CHINA_LOCAL_MANIFEST_SHA256','CATALOG_CHINA_LOCAL_RUNTIME_SHA'])) throw Error('unexpected environment');
  if (environment.CATALOG_CHINA_LOCAL_MANIFEST_SHA256 !== '${binding.generationManifestSha256}' || environment.CATALOG_CHINA_LOCAL_RUNTIME_SHA !== '${binding.pricingRuntimeSha}') throw Error('wrong authority');
  if ((await fs.readdir(environment.CATALOG_CHINA_LOCAL_GENERATION_DIR)).join(',') !== 'GENERATION.json') throw Error('database was restored');
  return ${JSON.stringify(helperResult === undefined ? expected : helperResult)};
}
`);
  return {runtimeRoot, directory: manifestDirectory, binding, raw, helper, generation};
}

test('frozen helper sees the exact preflight manifest and three source-bound settings, with no database or network', async t => {
  const f = await fixture(t); let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw Error('network forbidden'); });
  const proof = await verifyCrmChinaManifest(f);
  const completed = {...proof, middlewareBoundaryPassed: true};
  assert.equal(checkedCrmChinaManifestProof(completed, f.binding), completed);
  assert.throws(() => checkedCrmChinaManifestProof(proof, f.binding), /china_crm_status_manifest_proof/);
  assert.equal(proof.sourceObservedAt, '2026-11-26T17:00:00.000Z');
  assert.equal(proof.rows, 312345); assert.equal(fetches, 0);
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'GENERATION.json')), f.raw);
  assert.equal(JSON.stringify(proof).includes('cursor'), false);
});

for (const mutation of ['hash', 'reserialized', 'unavailable', 'wrong_rows', 'extra_private'])
test('manifest proof refuses ' + mutation + ' before it can attest the owner display', async t => {
  const badResult = mutation === 'unavailable' ? {status: 'unavailable'} : mutation === 'wrong_rows'
    ? {status: 'ready', sourceObservedAt: '2026-11-26T17:00:00.000Z', rows: 1, generationId: 'gen_china_123_1'}
    : mutation === 'extra_private' ? {status: 'ready', sourceObservedAt: '2026-11-26T17:00:00.000Z', rows: 312345,
      generationId: 'gen_china_123_1', private: 'not allowed'} : undefined;
  const f = await fixture(t, badResult);
  if (mutation === 'hash') f.binding.generationManifestSha256 = '0'.repeat(64);
  if (mutation === 'reserialized') await fs.writeFile(path.join(f.directory, 'GENERATION.json'), JSON.stringify(f.generation));
  await assert.rejects(verifyCrmChinaManifest(f), /china_crm_status_(?:manifest_hash|helper_result)/);
});

test('real-boundary check sends one unsigned GET and exposes only the known middleware verdict', async () => {
  let reads = 0;
  const proof = await verifyCrmChinaUnauthorizedAccess({fetchImpl: async (url, options) => {
    reads++; assert.equal(url, 'https://avtocena.com/api/crm/china-catalog-status');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, {Accept: 'application/json'});
    return new Response(JSON.stringify({ok: false, error: 'auth_required'}), {status: 401, headers: {'content-type': 'application/json'}});
  }});
  assert.deepEqual(proof, {unauthorizedStatus: 401, unauthorizedContentTypeJson: true, unauthorizedBodyIsAuthRequired: true,
    unauthorizedSetCookieAbsent: true, unsignedAccessDenied: true});
  assert.equal(reads, 1);
  assert.ok(!Object.keys(proof).some(key => /cache|private|noStore|bodyText/i.test(key)), 'no route cache guarantee is claimed');
});

test('a complete boundary body at the 256-byte limit is accepted without exposing its text', async () => {
  const text = JSON.stringify({ok: false, error: 'auth_required'}).padEnd(256, ' ');
  const proof = await checkedCrmChinaUnauthorizedResponse(new Response(text, {status: 401,
    headers: {'content-type': 'application/json; charset=utf-8'}}));
  assert.equal(proof.unauthorizedBodyIsAuthRequired, true);
  assert.ok(!JSON.stringify(proof).includes('auth_required'));
});

for (const kind of ['oversized', 'pending', 'pending_cancel', 'empty_chunks', 'aborted'])
test('bounded boundary validation cancels and releases an ' + kind + ' stream', async () => {
  let reads = 0, cancels = 0, releases = 0;
  const controller = new AbortController();
  const response = {status: 401, headers: new Headers({'content-type': 'application/json'}), body: {
    getReader() { return {
      async read() {
        reads++;
        if (kind === 'oversized') return {done: false, value: new Uint8Array(257)};
        if (kind === 'empty_chunks') return {done: false, value: new Uint8Array(0)};
        if (kind === 'aborted') queueMicrotask(() => controller.abort());
        return new Promise(() => {});
      },
      async cancel() { cancels++; if (kind === 'pending_cancel') return new Promise(() => {}); },
      releaseLock() { releases++; },
    }; },
  }};
  const started = performance.now();
  await assert.rejects(checkedCrmChinaUnauthorizedResponse(response, {deadline: started + 20, signal: controller.signal}),
    error => error.message === 'china_crm_status_unauthorized_boundary');
  assert.ok(performance.now() - started < 2000, 'the incomplete body cannot retain the release step indefinitely');
  assert.ok(reads >= 1 && reads <= 4096); assert.equal(cancels, 1); assert.equal(releases, 1);
});

for (const mode of ['middleware401', 'route403', 'allow_through'])
test('offline preflight invokes the fixed middleware with a real NextRequest: ' + mode, async t => {
  const f = await fixture(t); let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw Error('network forbidden'); });
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(f.runtimeRoot, 'node_modules'), 'dir');
  const filename = path.join(f.runtimeRoot, 'apps/web/middleware.ts');
  await fs.writeFile(filename, `export function middleware(request) {
    if (request.nextUrl.pathname !== '/api/crm/china-catalog-status' || request.method !== 'GET' || request.cookies.getAll().length) throw Error('wrong request');
    return new Response(JSON.stringify({ok:false,error:'auth_required'}),{status:${mode === 'route403' ? 403 : 401},
      headers:{'content-type':'application/json'${mode === 'allow_through' ? ",'x-middleware-next':'1'" : ''}}});
  }`);
  if (mode === 'middleware401') assert.deepEqual(await verifyCrmChinaMiddleware(f.runtimeRoot), {middlewareBoundaryPassed: true});
  else await assert.rejects(verifyCrmChinaMiddleware(f.runtimeRoot), /china_crm_status_(?:unauthorized_boundary|middleware_handler)/);
  assert.equal(fetches, 0);
});

for (const [status, headers, body] of [[200, {}, {ok: false, error: 'auth_required'}],
  [403, {'cache-control': 'private, no-store'}, {ok: false, error: 'auth_required'}],
  [302, {}, {ok: false, error: 'auth_required'}], [401, {'content-type': 'text/html'}, {ok: false, error: 'auth_required'}],
  [401, {'set-cookie': ''}, {ok: false, error: 'auth_required'}], [401, {}, {ok: true, error: 'auth_required'}],
  [401, {}, {ok: false, error: 'different'}], [401, {}, {ok: false, error: 'auth_required', private: 'PRIVATE'}]])
test('owner boundary refuses a different status, MIME, cookie or JSON object: ' + JSON.stringify([status, headers, body]), async () => {
  let calls = 0;
  await assert.rejects(verifyCrmChinaUnauthorizedAccess({fetchImpl: async () => {
    calls++; return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', ...headers}});
  }}), /china_crm_status_unauthorized_boundary/);
  assert.equal(calls, 1, 'no login, retry or alternate endpoint');
});

const evidenceFixture = () => {
  const candidate = {runtimeSha: '7'.repeat(40), pricingRuntimeSha: '6'.repeat(40), generationId: 'gen_china_123_1',
    generationManifestSha256: '8'.repeat(64), sourceObservedAt: '2026-11-26T17:00:00.000Z'};
  const expected = {candidate, nonce: '9'.repeat(32), oracleSha256: 'a'.repeat(64), rows: 312345,
    startedAt: Date.parse('2026-11-26T18:00:00Z'), now: Date.parse('2026-11-26T18:00:02Z')};
  return {expected, evidence: {version: 1, kind: 'china-crm-operations-proof-v1', codeScope: CRM_CHINA_CODE_SCOPE,
    release: candidate.runtimeSha, nonce: expected.nonce, checkedAt: '2026-11-26T18:00:01.000Z',
    pricingRuntimeSha: candidate.pricingRuntimeSha, generationManifestSha256: candidate.generationManifestSha256,
    generationId: candidate.generationId, sourceObservedAt: candidate.sourceObservedAt, rows: expected.rows,
    oracleSha256: expected.oracleSha256, passed: true, manifestHelperPassed: true, middlewareBoundaryPassed: true, unauthorizedStatus: 401,
    unauthorizedContentTypeJson: true, unauthorizedBodyIsAuthRequired: true, unauthorizedSetCookieAbsent: true, unsignedAccessDenied: true,
    productionMutations: 0, directSupplierRequests: 0, signedInRequests: 0}};
};

test('final proof is bound to this runtime, session, real source observation and reused oracle', () => {
  const {expected, evidence} = evidenceFixture();
  assert.equal(checkedCrmChinaEvidence(evidence, expected), evidence);
  for (const [key, value] of [['release', '0'.repeat(40)], ['nonce', '0'.repeat(32)], ['rows', 1],
    ['sourceObservedAt', '2026-11-26T18:00:01.000Z'], ['generationId', 'gen_china_124_1'],
    ['oracleSha256', '0'.repeat(64)], ['codeScope', 'catalog-japan-usability-v1'], ['manifestHelperPassed', false],
    ['middlewareBoundaryPassed', false], ['unauthorizedStatus', 200], ['unauthorizedStatus', 403],
    ['unauthorizedBodyIsAuthRequired', false], ['unauthorizedSetCookieAbsent', false], ['unsignedAccessDenied', false], ['signedInRequests', 1],
    ['productionMutations', 1], ['directSupplierRequests', 1], ['checkedAt', '2026-11-26T17:59:59Z'], ['body', 'PRIVATE']])
    assert.throws(() => checkedCrmChinaEvidence({...evidence, [key]: value}, expected), /china_crm_status_evidence/);
});

test('CI fixture evidence requires completed desktop and mobile cases plus every existing controls guarantee', () => {
  const checks = Object.fromEntries(['readyStatus', 'statusFailureIsolated', 'scheduleAndLinks', 'reserveSourcesPreserved',
    'neighborControlsPreserved', 'lazyStatusReads', 'revisionConflictPreserved', 'noOverflow'].map(key => [key, true]));
  const good = {version: 1, kind: 'china-crm-collection-controls-browser-v1', passed: true, caseCount: 2, widths: [1440, 390], checks};
  assert.equal(checkedCrmChinaBrowserFixture(good), good);
  for (const changed of [{passed: false}, {caseCount: 1}, {widths: [1440]}, {checks: {...checks, lazyStatusReads: false}},
    {checks: {...checks, fake: true}}, {raw: 'private'}])
    assert.throws(() => checkedCrmChinaBrowserFixture({...good, ...changed}), /china_crm_status_browser_fixture/);
});
