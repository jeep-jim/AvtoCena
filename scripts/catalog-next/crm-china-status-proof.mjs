import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {CRM_CHINA_CODE_SCOPE} from './crm-china-code-scope.mjs';
import {CRM_JAPAN_PHOTO_CODE_SCOPE} from './crm-japan-photo-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE} from './japan-pagination-code-scope.mjs';
import {JAPAN_STABILITY_CODE_SCOPE} from './japan-stability-code-scope.mjs';

const need = (condition, code) => { if (!condition) throw Error('china_crm_status_' + code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{64}$/, RUNTIME = /^[a-f0-9]{40}$/;
const GENERATION = /^gen_china_[1-9]\d{0,19}_[1-9]\d{0,5}$/;
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/;
const date = value => typeof value === 'string' && DATE.test(value) && Number.isFinite(Date.parse(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort());
const BINDING_KEYS = ['runtimeSha', 'pricingRuntimeSha', 'generationManifestSha256', 'generationId', 'sourceObservedAt', 'rows'];
const FIXTURE_CHECKS = ['readyStatus', 'statusFailureIsolated', 'scheduleAndLinks', 'reserveSourcesPreserved',
  'neighborControlsPreserved', 'lazyStatusReads', 'revisionConflictPreserved', 'noOverflow'];

export function checkedCrmChinaBrowserFixture(value) {
  need(exactKeys(value, ['version', 'kind', 'passed', 'caseCount', 'widths', 'checks'])
    && value.version === 1 && value.kind === 'china-crm-collection-controls-browser-v1'
    && value.passed === true && value.caseCount === 2 && same(value.widths, [1440, 390])
    && exactKeys(value.checks, FIXTURE_CHECKS) && FIXTURE_CHECKS.every(key => value.checks[key] === true), 'browser_fixture');
  return value;
}

function checkedBinding(value) {
  need(exactKeys(value, BINDING_KEYS) && RUNTIME.test(value.runtimeSha ?? '') && RUNTIME.test(value.pricingRuntimeSha ?? '')
    && SHA.test(value.generationManifestSha256 ?? '') && GENERATION.test(value.generationId ?? '')
    && date(value.sourceObservedAt) && Number.isSafeInteger(value.rows) && value.rows > 0, 'binding');
  return value;
}

async function boundedFile(filename, maximum) {
  const before = await fs.lstat(filename);
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size > 0 && before.size <= maximum
    && await fs.realpath(filename) === filename, 'file');
  const bytes = await fs.readFile(filename), after = await fs.lstat(filename);
  need(bytes.length === before.size && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'file_changed');
  return bytes;
}

/** Run only the frozen candidate's manifest reader on already authenticated
 * host bytes. This directory contains one manifest, not a restored database.
 * The production caller verifies the exact source before and after this child. */
export async function verifyCrmChinaManifest({runtimeRoot, directory, binding}) {
  checkedBinding(binding);
  need(path.isAbsolute(runtimeRoot) && path.isAbsolute(directory)
    && await fs.realpath(runtimeRoot) === runtimeRoot && await fs.realpath(directory) === directory, 'directory');
  const manifest = await boundedFile(path.join(directory, 'GENERATION.json'), 256 * 1024);
  need(hash(manifest) === binding.generationManifestSha256, 'manifest_hash');
  const generation = JSON.parse(manifest);
  need(generation.kind === 'china-local-generation-v1' && generation.market === 'china' && generation.prepared === true
    && generation.generationId === binding.generationId && generation.runtimeSha === binding.pricingRuntimeSha
    && generation.rows === binding.rows && generation.source?.supplierLatestVerified === true
    && generation.source.sourceObservedAt === binding.sourceObservedAt, 'manifest_binding');
  const helper = path.join(runtimeRoot, 'apps/web/lib/catalog/china-catalog-status.ts');
  await boundedFile(helper, 64 * 1024);
  const {readChinaCatalogStatus} = await import(pathToFileURL(helper).href);
  need(typeof readChinaCatalogStatus === 'function', 'helper');
  const result = await readChinaCatalogStatus({
    CATALOG_CHINA_LOCAL_GENERATION_DIR: directory,
    CATALOG_CHINA_LOCAL_MANIFEST_SHA256: binding.generationManifestSha256,
    CATALOG_CHINA_LOCAL_RUNTIME_SHA: binding.pricingRuntimeSha,
  });
  need(exactKeys(result, ['status', 'sourceObservedAt', 'rows', 'generationId']) && result.status === 'ready'
    && result.sourceObservedAt === binding.sourceObservedAt && result.rows === binding.rows
    && result.generationId === binding.generationId, 'helper_result');
  need(hash(await boundedFile(path.join(directory, 'GENERATION.json'), 256 * 1024)) === binding.generationManifestSha256,
    'manifest_changed');
  return {version: 1, kind: 'china-crm-manifest-proof-v1', ...binding, manifestHelperPassed: true};
}

export function checkedCrmChinaManifestProof(value, binding) {
  checkedBinding(binding);
  need(exactKeys(value, ['version', 'kind', ...BINDING_KEYS, 'manifestHelperPassed', 'middlewareBoundaryPassed'])
    && value.version === 1 && value.kind === 'china-crm-manifest-proof-v1' && value.manifestHelperPassed === true
    && value.middlewareBoundaryPassed === true
    && BINDING_KEYS.every(key => value[key] === binding[key]), 'manifest_proof');
  return value;
}

/** The existing middleware denies anonymous CRM before route execution. Read
 * at most 256 complete bytes; retain only the known verdict, never body text.
 * A finite chunk cap also bounds pathological streams of empty chunks. */
export async function checkedCrmChinaUnauthorizedResponse(response, {deadline = performance.now() + 15000, signal} = {}) {
  let reader, timer, onAbort;
  try {
    need(response.status === 401 && (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() === 'application/json'
      && !response.headers.has('set-cookie') && response.body && Number.isFinite(deadline)
      && performance.now() < deadline && !signal?.aborted, 'unauthorized_boundary');
    reader = response.body.getReader();
    const expired = new Promise((_, reject) => {
      const stop = () => reject(Error('china_crm_status_unauthorized_boundary'));
      timer = setTimeout(stop, Math.max(1, deadline - performance.now()));
      onAbort = stop; signal?.addEventListener('abort', onAbort, {once: true});
    });
    const chunks = []; let bytes = 0, complete = false;
    for (let reads = 0; reads < 4096; reads++) {
      need(performance.now() < deadline && !signal?.aborted, 'unauthorized_boundary');
      const item = await Promise.race([reader.read(), expired]);
      need(performance.now() < deadline && !signal?.aborted, 'unauthorized_boundary');
      if (item.done) { complete = true; break; }
      need(item.value instanceof Uint8Array && bytes + item.value.byteLength <= 256, 'unauthorized_boundary');
      if (item.value.byteLength) { chunks.push(Buffer.from(item.value)); bytes += item.value.byteLength; }
    }
    need(complete && bytes > 0, 'unauthorized_boundary');
    const body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, bytes)));
    need(exactKeys(body, ['ok', 'error']) && body.ok === false && body.error === 'auth_required', 'unauthorized_boundary');
    return {unauthorizedStatus: 401, unauthorizedContentTypeJson: true, unauthorizedBodyIsAuthRequired: true,
      unauthorizedSetCookieAbsent: true, unsignedAccessDenied: true};
  } catch { throw Error('china_crm_status_unauthorized_boundary'); }
  finally {
    clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
    else if (response?.body) void response.body.cancel().catch(() => {});
  }
}

/** Execute the actual frozen middleware and NextRequest offline before host
 * staging or mutation. A route-only mock could incorrectly expect 403. */
export async function verifyCrmChinaMiddleware(runtimeRoot) {
  const filename = path.join(runtimeRoot, 'apps/web/middleware.ts');
  await boundedFile(filename, 256 * 1024);
  const runtimeRequire = createRequire(pathToFileURL(filename));
  const {NextRequest} = runtimeRequire('next/server');
  const imported = await import(pathToFileURL(filename).href);
  const actual = typeof imported.middleware === 'function' ? imported : imported.default;
  need(typeof actual?.middleware === 'function', 'middleware');
  const request = new NextRequest('https://avtocena.com/api/crm/china-catalog-status', {
    method: 'GET', headers: {Accept: 'application/json'},
  });
  need(request.cookies.getAll().length === 0, 'middleware_cookie');
  const response = await actual.middleware(request);
  need(response?.headers.get('x-middleware-next') === null, 'middleware_handler');
  await checkedCrmChinaUnauthorizedResponse(response);
  return {middlewareBoundaryPassed: true};
}

/** Exactly one unsigned, nonredirecting GET; no login or owner-cookie creation.
 * The timeout includes the fetch and the bounded body validation. */
export async function verifyCrmChinaUnauthorizedAccess({fetchImpl = fetch} = {}) {
  const deadline = performance.now() + 15000, signal = AbortSignal.timeout(15000);
  const response = await fetchImpl('https://avtocena.com/api/crm/china-catalog-status', {
    method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
    headers: {Accept: 'application/json'}, signal,
  });
  return checkedCrmChinaUnauthorizedResponse(response, {deadline, signal});
}

const EVIDENCE_KEYS = ['version', 'kind', 'codeScope', 'release', 'nonce', 'checkedAt', 'pricingRuntimeSha',
  'generationManifestSha256', 'generationId', 'sourceObservedAt', 'rows', 'oracleSha256', 'passed',
  'manifestHelperPassed', 'middlewareBoundaryPassed', 'unauthorizedStatus', 'unauthorizedContentTypeJson',
  'unauthorizedBodyIsAuthRequired', 'unauthorizedSetCookieAbsent', 'unsignedAccessDenied',
  'productionMutations', 'directSupplierRequests', 'signedInRequests'];

export function checkedCrmChinaEvidence(value, {candidate, nonce, oracleSha256, rows, startedAt,
  codeScope = CRM_CHINA_CODE_SCOPE, now = Date.now()}) {
  need(exactKeys(value, EVIDENCE_KEYS) && value.version === 1 && value.kind === 'china-crm-operations-proof-v1'
    && [CRM_CHINA_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_SCOPE, JAPAN_PAGINATION_CODE_SCOPE, JAPAN_STABILITY_CODE_SCOPE].includes(codeScope)
    && value.codeScope === codeScope && value.release === candidate.runtimeSha && value.nonce === nonce
    && value.pricingRuntimeSha === candidate.pricingRuntimeSha && value.generationId === candidate.generationId
    && value.generationManifestSha256 === candidate.generationManifestSha256
    && value.sourceObservedAt === candidate.sourceObservedAt && Number.isSafeInteger(value.rows) && value.rows === rows && rows > 0
    && SHA.test(value.oracleSha256 ?? '') && value.oracleSha256 === oracleSha256
    && date(value.checkedAt) && Date.parse(value.checkedAt) >= startedAt && Date.parse(value.checkedAt) <= now
    && ['passed', 'manifestHelperPassed', 'middlewareBoundaryPassed', 'unauthorizedContentTypeJson',
      'unauthorizedBodyIsAuthRequired', 'unauthorizedSetCookieAbsent', 'unsignedAccessDenied']
      .every(key => value[key] === true)
    && value.unauthorizedStatus === 401
    && ['productionMutations', 'directSupplierRequests', 'signedInRequests'].every(key => value[key] === 0), 'evidence');
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 7 && process.argv[2] === '--manifest', 'arguments');
    const [runtimeRoot, directory, bindingPath, outputPath] = process.argv.slice(3);
    // This child has no production credentials and cannot make a fetch call.
    await import('../../tests/helpers/offline-fetch.mjs');
    await import(pathToFileURL(path.join(runtimeRoot, 'tests/helpers/server-only-hook.mjs')).href);
    const binding = JSON.parse(await boundedFile(bindingPath, 16 * 1024));
    const manifestProof = await verifyCrmChinaManifest({runtimeRoot, directory, binding});
    const middlewareProof = await verifyCrmChinaMiddleware(runtimeRoot);
    const proof = checkedCrmChinaManifestProof({...manifestProof, ...middlewareProof}, binding);
    await fs.writeFile(outputPath, JSON.stringify(proof) + '\n', {mode: 0o600, flag: 'wx'});
  } catch { console.error('china_crm_status_proof_failed'); process.exitCode = 1; }
}
