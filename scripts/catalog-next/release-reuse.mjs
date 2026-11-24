import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHA = /^[a-f0-9]{64}$/, REVISION = /^[a-f0-9]{40}$/, NONCE = /^[a-f0-9]{32}$/;
const FILES = ['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
  'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson', 'image.tar', 'acceptance.json',
  'regcloud-performance-gate.py', 'accepted-speed-baseline.json'];
const CALCULATION = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const need = (value, code) => { if (!value) throw Error('china_release_reuse_' + code); };
const hash = raw => createHash('sha256').update(raw).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const ordered = value => Array.isArray(value) ? value.map(ordered) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const equal = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));

/** Only the reviewed, fixed release plan chooses reuse. There are no workflow
 * inputs or environment overrides selecting a host directory or image. */
export function resolveChinaReleaseReuse(release, servingPlan) {
  need(object(release) && release.version === 1 && release.market === 'china'
    && object(servingPlan) && REVISION.test(servingPlan.runtimeSha ?? '')
    && REVISION.test(servingPlan.pricingRuntimeSha ?? '')
    && release.runtimeSha === servingPlan.runtimeSha && release.pricingRuntimeSha === servingPlan.pricingRuntimeSha,
  'profile');
  if (!Object.hasOwn(release, 'reuseHostAttempt')) return null;
  const value = release.reuseHostAttempt;
  need(keys(value, ['source', 'imageId']) && keys(value.source, ['runtimeSha', 'nonce', 'planSha256', 'rollbackSha256'])
    && value.source.runtimeSha === servingPlan.runtimeSha && NONCE.test(value.source.nonce ?? '')
    && SHA.test(value.source.planSha256 ?? '') && SHA.test(value.source.rollbackSha256 ?? '')
    && /^sha256:[a-f0-9]{64}$/.test(value.imageId ?? ''), 'profile_source');
  return structuredClone(value);
}

function metadata(encoded, descriptor, name) {
  need(typeof encoded === 'string' && encoded.length <= Math.ceil(256 * 1024 / 3) * 4
    && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), name + '_encoding');
  const raw = Buffer.from(encoded, 'base64');
  need(raw.toString('base64') === encoded && raw.length === descriptor.bytes
    && hash(raw) === descriptor.sha256, name + '_checksum');
  let value; try { value = JSON.parse(raw.toString('utf8')); } catch { throw Error('china_release_reuse_' + name + '_json'); }
  need(object(value), name + '_json'); return {raw, value};
}

/** Validate the authenticated host response against both reviewed release
 * identities and the newly acquired first-publication fence. The host proves
 * old PLAN/ROLLED_BACK hashes and independently seals every copied file. */
export function validateChinaReleaseReuseResult({result, reuse, release, servingPlan, nonce, controllerSha, previous}) {
  need(equal(resolveChinaReleaseReuse(release, servingPlan), reuse), 'selected_source');
  need(NONCE.test(nonce ?? '') && nonce !== reuse.source.nonce && REVISION.test(controllerSha ?? ''), 'new_identity');
  need(previous && ((previous.etag === null && previous.sha256 === null) ||
    (typeof previous.etag === 'string' && previous.etag.length > 0 && SHA.test(previous.sha256 ?? ''))), 'previous');
  need(keys(result, ['initialized', 'reused', 'plan', 'generationBase64', 'oracleBase64', 'copiedFiles', 'copiedBytes'])
    && result.initialized === true && result.reused === true, 'reply');
  const plan = result.plan;
  need(keys(plan, ['version', 'market', 'retainedRuntime', 'runtimeSha', 'pricingRuntimeSha', 'runtimeTree',
    'runtimeDiffSha256', 'controllerSha', 'servingCalculationVersion', 'generationId', 'generationManifestSha256',
    'privateGenerationReceiptSha256', 'sourceDescriptorSha256', 'imageId', 'nonce', 'previousAcceptedETag',
    'previousAcceptedStateSha256', 'files', 'reuseSource']) && plan.version === 1 && plan.market === 'china', 'plan');
  const expected = {retainedRuntime: servingPlan.retainedRuntime, runtimeSha: servingPlan.runtimeSha,
    pricingRuntimeSha: servingPlan.pricingRuntimeSha, runtimeTree: servingPlan.runtimeTree,
    runtimeDiffSha256: servingPlan.runtimeDiffSha256, controllerSha, servingCalculationVersion: CALCULATION,
    generationId: release.generationId, generationManifestSha256: release.generationManifestSha256,
    privateGenerationReceiptSha256: release.receiptSha256, imageId: reuse.imageId, nonce,
    previousAcceptedETag: previous.etag, previousAcceptedStateSha256: previous.sha256};
  need(Object.entries(expected).every(([key, value]) => plan[key] === value)
    && SHA.test(plan.sourceDescriptorSha256 ?? '') && equal(plan.reuseSource, reuse.source), 'plan_binding');
  need(Array.isArray(plan.files) && plan.files.length === FILES.length
    && new Set(plan.files.map(file => file?.name)).size === FILES.length, 'files');
  for (const file of plan.files) need(keys(file, ['name', 'bytes', 'sha256', 'compressedBytes', 'compressedSha256'])
    && FILES.includes(file.name) && positive(file.bytes) && SHA.test(file.sha256 ?? '')
    && positive(file.compressedBytes) && SHA.test(file.compressedSha256 ?? ''), 'file');
  const sum = plan.files.reduce((total, file) => total + file.bytes, 0);
  need(positive(sum) && result.copiedFiles === FILES.length && result.copiedBytes === sum, 'copy_census');
  const file = name => plan.files.find(row => row.name === name);
  need(file('GENERATION.json').sha256 === release.generationManifestSha256, 'manifest_descriptor');
  const generation = metadata(result.generationBase64, file('GENERATION.json'), 'generation');
  const oracle = metadata(result.oracleBase64, file('acceptance.json'), 'oracle');
  const value = generation.value;
  need(value.version === 1 && value.kind === 'china-local-generation-v1' && value.market === 'china'
    && value.runtimeSha === servingPlan.pricingRuntimeSha && value.generationId === release.generationId
    && value.prepared === true && positive(value.rows) && Number.isSafeInteger(value.sourceRows) && value.sourceRows >= value.rows
    && value.source?.supplierLatestVerified === true && Number.isSafeInteger(value.source.cursor) && value.source.cursor >= 0
    && Number.isFinite(Date.parse(value.source.sourceObservedAt)) && Number.isFinite(Date.parse(value.pricingAsOf)), 'generation_binding');
  const expectedOracle = oracle.value;
  need(expectedOracle.version === 1 && expectedOracle.kind === 'local-native-reader-http-expectations-v1'
    && expectedOracle.runtimeSha === servingPlan.runtimeSha && expectedOracle.pricingRuntimeSha === servingPlan.pricingRuntimeSha
    && expectedOracle.generationManifestSha256 === release.generationManifestSha256
    && expectedOracle.expectedGeneration === release.generationId && expectedOracle.syntheticExpectations === true
    && expectedOracle.httpVerified === false && Array.isArray(expectedOracle.cases) && expectedOracle.cases.length >= 8
    && expectedOracle.cases.length <= 64 && new Set(expectedOracle.cases.map(row => row?.name)).size === expectedOracle.cases.length,
  'oracle_binding');
  for (const row of expectedOracle.cases) need(typeof row.name === 'string' && /^[a-z0-9-]{1,100}$/.test(row.name)
    && typeof row.path === 'string' && row.path.startsWith('/api/catalog/search?') && row.path.length <= 8192
    && Number.isSafeInteger(row.total) && row.total >= 0 && Array.isArray(row.ids) && row.ids.length <= 24
    && row.ids.length <= row.total && row.ids.every(id => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id))
    && Array.isArray(row.totalRub) && row.totalRub.length === row.ids.length
    && row.totalRub.every(rub => rub === null || typeof rub === 'number' && Number.isFinite(rub) && rub >= 0), 'oracle_case');
  need(expectedOracle.cases.find(row => row.name === 'china-first-page')?.total === value.rows
    && expectedOracle.cases.some(row => row.name === 'china-power-to-160'), 'oracle_inventory');
  return {plan: structuredClone(plan), generation: value, oracle: expectedOracle, oracleBytes: oracle.raw,
    copiedFiles: result.copiedFiles, copiedBytes: result.copiedBytes};
}

/** No generation restore, image build, upload, source access or switch here.
 * All runtime/public checks continue in the existing release pipeline. */
export async function resumeChinaHostAttempt({session, reuse, release, servingPlan, nonce, controllerSha,
  previous, oraclePath, assertAuthority}) {
  need(session && typeof session.call === 'function' && typeof assertAuthority === 'function'
    && path.isAbsolute(oraclePath), 'capabilities');
  need(equal(resolveChinaReleaseReuse(release, servingPlan), reuse) && NONCE.test(nonce ?? '')
    && nonce !== reuse.source.nonce && REVISION.test(controllerSha ?? ''), 'arguments');
  await assertAuthority();
  const result = await session.call('resume_init', {source: reuse.source, nonce, controllerSha,
    previousAcceptedETag: previous.etag, previousAcceptedStateSha256: previous.sha256});
  const restored = validateChinaReleaseReuseResult({result, reuse, release, servingPlan, nonce, controllerSha, previous});
  await assertAuthority();
  await fs.writeFile(oraclePath, restored.oracleBytes, {flag: 'wx', mode: 0o600});
  const {oracleBytes, ...safeReturn} = restored; return safeReturn;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && process.argv[2] === '--workflow-mode', 'cli_arguments');
    const directory = path.join(ROOT, '.github/operations/catalog-next');
    const [release, servingPlan] = await Promise.all(['china-release-plan.json', 'china-serving-plan.json'].map(async name =>
      JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))));
    process.stdout.write('reuse_host=' + String(resolveChinaReleaseReuse(release, servingPlan) !== null) + '\n');
  } catch (error) {
    process.stderr.write(/^china_release_reuse_[a-z_]+$/.test(error?.message ?? '') ? error.message + '\n' : 'china_release_reuse_failed\n');
    process.exitCode = 1;
  }
}
