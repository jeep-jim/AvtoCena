import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {restoreReleaseEncyclopedia} from '../encyclopedia/restore-calculation-index.mjs';
import {createResourceNodeInvocation, forwardResourceNodeTelemetry} from './node-resource-memory.mjs';

export const PREPARED_MARKETS = ['china', 'korea', 'uae', 'europe', 'georgia'];
export const stagedBudgetDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SHA = /^[a-f0-9]{40}$/, CALCULATOR = /^[a-f0-9]{64}$/;
const GENERATION = /^gen_\d+_[a-z0-9]+$/;
const SUPPLEMENT_LIMITS = {rows:10000, objects:200, objectBytes:4*1024*1024, totalBytes:64*1024*1024};

export function budgetSourceSupplementPrefix(context) {
  if (!CALCULATOR.test(context.calculationVersion || '')
      || context.encyclopediaDigest !== null && !CALCULATOR.test(context.encyclopediaDigest || '')) return null;
  return `budget-source-supplements-v1/${stagedBudgetDigest([context.encyclopediaDigest, context.calculationVersion])}/`;
}

export function assertBudgetSourceSupplement(descriptor, context, market, record) {
  const fail = () => { throw Error('staged_budget_source_supplement_invalid:' + market); };
  if (!descriptor || typeof descriptor !== 'object') return fail();
  const {checksum, ...body} = descriptor, prefix = budgetSourceSupplementPrefix(context);
  if (!prefix || !PREPARED_MARKETS.includes(market) || descriptor.version !== 1 || descriptor.market !== market
      || descriptor.generationId !== context.manifest.generationId || descriptor.calculationVersion !== context.calculationVersion
      || descriptor.encyclopediaDigest !== context.encyclopediaDigest || descriptor.contextSha256 !== prefix.split('/')[1]
      || checksum !== stagedBudgetDigest(body) || !Number.isSafeInteger(descriptor.baselineSourceRows) || descriptor.baselineSourceRows < 0
      || !Number.isSafeInteger(descriptor.sourceRows) || descriptor.sourceRows < descriptor.baselineSourceRows
      || descriptor.sourceRows > context.manifest.markets[market]?.count
      || ['baselineSourceIds','sourceIds','sourceCardsSha256','pricingChunksSha256','projectionIdsSha256','eligibleIdsSha256']
        .some(key => !CALCULATOR.test(descriptor[key] || ''))
      || !Array.isArray(descriptor.missingIds) || descriptor.missingIds.length > SUPPLEMENT_LIMITS.rows
      || descriptor.missingIds.length !== descriptor.sourceRows - descriptor.baselineSourceRows
      || descriptor.missingIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(id))
      || new Set(descriptor.missingIds).size !== descriptor.missingIds.length
      || stagedBudgetDigest(descriptor.missingIds) !== stagedBudgetDigest(descriptor.missingIds.slice().sort((a,b) => a.localeCompare(b)))
      || !Array.isArray(descriptor.objects) || descriptor.objects.length > SUPPLEMENT_LIMITS.objects) return fail();
  if (record && (descriptor.sourceRows !== record.sourceRows || descriptor.sourceIds !== record.sourceIds
      || descriptor.projectionIdsSha256 !== record.coverage?.projectionIds
      || descriptor.eligibleIdsSha256 !== record.coverage?.eligibleIds)) return fail();
  let bytes = 0, cards = 0, replay = 0;
  const paths = new Set();
  for (const object of descriptor.objects) {
    const kind = object?.kind;
    if (!['card','replay'].includes(kind) || !CALCULATOR.test(object.sha256 || '') || !CALCULATOR.test(object.idsSha256 || '')
        || object.path !== `${prefix}${kind === 'card' ? 'cards' : 'replay'}/${market}/${object.sha256}.json`
        || paths.has(object.path) || !Number.isSafeInteger(object.bytes) || object.bytes <= 0 || object.bytes > SUPPLEMENT_LIMITS.objectBytes
        || !Number.isSafeInteger(object.rows) || object.rows <= 0 || object.rows > descriptor.missingIds.length
        || object.rows > (kind === 'card' ? 256 : 500)) return fail();
    paths.add(object.path); bytes += object.bytes;
    if (kind === 'card') cards += object.rows; else replay += object.rows;
  }
  if (bytes > SUPPLEMENT_LIMITS.totalBytes || cards !== descriptor.missingIds.length || replay > cards) return fail();
  return descriptor;
}

export function assertBudgetSourceSupplementObject(descriptor, object, value) {
  const fail = () => { throw Error('staged_budget_source_supplement_object_invalid'); };
  if (!value || typeof value !== 'object' || stagedBudgetDigest(value) !== object.sha256
      || Buffer.byteLength(JSON.stringify(value)) !== object.bytes || object.bytes > SUPPLEMENT_LIMITS.objectBytes
      || value.generationId !== descriptor.generationId || value.market !== descriptor.market) return fail();
  const card = object.kind === 'card', rows = card ? value.items : value.entries;
  if (!Array.isArray(rows) || rows.length !== object.rows || rows.length > (card ? 256 : 500) || card && (!Number.isSafeInteger(value.block) || value.block < 0)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify((card ? ['generationId','market','block','items'] : ['generationId','market','entries']).sort())) return fail();
  const ids = rows.map(row => card ? row?.id : row?.[0]), missing = new Set(descriptor.missingIds);
  if (new Set(ids).size !== ids.length || ids.some(id => !missing.has(id)) || stagedBudgetDigest(ids) !== object.idsSha256
      || rows.some(row => card ? row.market !== descriptor.market : !Array.isArray(row) || row.length !== 2 || !row[1] || typeof row[1] !== 'object')) return fail();
  return ids;
}

export function assertStagedBudgetSupplementWrite(key, value, condition, context) {
  if (!key.includes('/indexes/budget-source-supplements-v1/')) return;
  const prefix = `catalog/generations/${context.manifest.generationId}/indexes/${budgetSourceSupplementPrefix(context)}`;
  const match = key.startsWith(prefix) && key.slice(prefix.length).match(/^(cards|replay)\/(china|korea|uae|europe|georgia)\/([a-f0-9]{64})\.json$(?![\s\S])/);
  const rows = match?.[1] === 'cards' ? value?.items : value?.entries;
  if (!match || condition?.ifNoneMatch !== '*' || !Array.isArray(rows) || rows.length === 0 || rows.length > (match[1] === 'cards' ? 256 : 500)) {
    throw Error('staged_budget_write_forbidden');
  }
  const ids = rows.map(row => match[1] === 'cards' ? row?.id : row?.[0]);
  if (ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(id))) throw Error('staged_budget_write_forbidden');
  assertBudgetSourceSupplementObject({generationId:context.manifest.generationId, market:match[2], missingIds:ids},
    {kind:match[1] === 'cards' ? 'card' : 'replay', sha256:match[3], bytes:Buffer.byteLength(JSON.stringify(value)), rows:ids.length, idsSha256:stagedBudgetDigest(ids)}, value);
}

/** Read-only planning verifies both the unchanged v3 baseline and its bounded
 * candidate additions before any object can enter the writer allowlist. */
export function assertBudgetSourceSupplementPlan(plan, context, market, baseline, coverage) {
  const index = plan?.index, source = [...(index?.rows || []), ...(index?.otherRows || [])];
  const before = [...(baseline?.rows || []), ...(baseline?.otherRows || [])];
  const record = {sourceRows:source.length, sourceIds:stagedBudgetDigest(source.map(row => row[5]?.id)), coverage};
  const descriptor = assertBudgetSourceSupplement(plan?.descriptor, context, market, record);
  if (index?.version !== 3 || index.generationId !== context.manifest.generationId || index.sourceRows !== source.length
      || descriptor.baselineSourceRows !== before.length || descriptor.baselineSourceIds !== stagedBudgetDigest(before.map(row => row[5]?.id))
      || descriptor.sourceCardsSha256 !== stagedBudgetDigest(source.map(row => [row[5]?.id,row[5]?.block,row[5]?.cardPath ?? null]))
      || descriptor.pricingChunksSha256 !== stagedBudgetDigest(index.pricingChunks ?? null)
      || !Array.isArray(plan.objects) || plan.objects.length !== descriptor.objects.length) throw Error('staged_budget_source_supplement_plan_invalid');
  const rows = new Map(source.map(row => [row[5]?.id,row])), oldIds = new Set(before.map(row => row[5]?.id));
  if (rows.size !== source.length || baseline.rows.some((row,position) => row[5]?.id !== index.rows[position]?.[5]?.id)
      || (baseline.otherRows || []).some((row,position) => row[5]?.id !== index.otherRows?.[position]?.[5]?.id)
      || before.some(row => !rows.has(row[5]?.id) || stagedBudgetDigest(row) !== stagedBudgetDigest(rows.get(row[5]?.id)))
      || stagedBudgetDigest(source.filter(row => !oldIds.has(row[5]?.id)).map(row => row[5]?.id).sort((a,b) => a.localeCompare(b)))
        !== stagedBudgetDigest(descriptor.missingIds)) throw Error('staged_budget_source_supplement_baseline_changed');
  const planned = new Map(plan.objects.map(object => [object.path,object.value])), cards = [], replays = [];
  const expectedChunks = {...(baseline.pricingChunks || {})}, replayPaths = descriptor.objects.filter(object => object.kind === 'replay').map(object => object.path);
  if (replayPaths.length) {
    if (!Array.isArray(expectedChunks[market])) throw Error('staged_budget_source_supplement_baseline_changed');
    expectedChunks[market] = [...expectedChunks[market], ...replayPaths];
  }
  if (stagedBudgetDigest(index.pricingChunks ?? {}) !== stagedBudgetDigest(expectedChunks)) throw Error('staged_budget_source_supplement_baseline_changed');
  if (planned.size !== plan.objects.length) throw Error('staged_budget_source_supplement_plan_invalid');
  for (const object of descriptor.objects) {
    const value = planned.get(object.path), ids = assertBudgetSourceSupplementObject(descriptor, object, value);
    if (object.kind === 'card' && ids.some(id => rows.get(id)?.[5]?.cardPath !== object.path || rows.get(id)?.[5]?.block !== value.block)) {
      throw Error('staged_budget_source_supplement_plan_invalid');
    }
    (object.kind === 'card' ? cards : replays).push(...ids);
  }
  if (new Set(replays).size !== replays.length || stagedBudgetDigest(cards.sort((a,b) => a.localeCompare(b))) !== stagedBudgetDigest(descriptor.missingIds)) {
    throw Error('staged_budget_source_supplement_plan_invalid');
  }
  return descriptor;
}

export function budgetManifestMarkets(manifest) {
  const entries = Object.entries(manifest?.markets || {});
  if (manifest?.version !== 2 || !GENERATION.test(manifest.generationId || '') || !entries.length
      || entries.some(([market, value]) => ![...PREPARED_MARKETS, 'japan'].includes(market)
        || !Number.isSafeInteger(value?.count) || value.count < 0 || !Array.isArray(value.chunks))) {
    throw Error('staged_budget_manifest_invalid');
  }
  return PREPARED_MARKETS.filter(market => (manifest.markets[market]?.count || 0) > 0);
}

export async function readLiveBudgetIdentity(fetchImpl = fetch) {
  const response = await fetchImpl('https://avtocena.com/api/health', {
    headers: {accept:'application/json', 'cache-control':'no-cache'},
    redirect:'error', signal:AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error('staged_budget_health_http_' + response.status);
  const value = await response.json();
  if (value.ok !== true || !SHA.test(value.releaseSha || '') || !CALCULATOR.test(value.calculationVersion || '')) {
    throw Error('staged_budget_live_identity_invalid');
  }
  return {release:value.releaseSha, calculationVersion:value.calculationVersion};
}

export function assertStagedBudgetContext(context) {
  if (context?.version !== 1 || !SHA.test(context.release || '') || !CALCULATOR.test(context.calculationVersion || '')
      || !GENERATION.test(context.manifest?.generationId || '') || !GENERATION.test(context.expectedBaseGenerationId || '')
      || context.manifest.generationId === context.expectedBaseGenerationId || !context.operationId
      || context.manifest.version !== 2 || !context.baseEtag) throw Error('staged_budget_context_invalid');
  return budgetManifestMarkets(context.manifest);
}

/** The real manifest/lease remain authoritative; the child overlay never writes them. */
export async function verifyStagedBudgetAuthority(context, storage, readIdentity = readLiveBudgetIdentity, now = Date.now) {
  assertStagedBudgetContext(context);
  const [base, lock, actual] = await Promise.all([
    storage.readJsonWithMeta('catalog/manifest.json', null),
    storage.readJson('catalog/import-lock.json', null),
    readIdentity(),
  ]);
  if (!base.found || base.etag !== context.baseEtag || base.value?.generationId !== context.expectedBaseGenerationId) {
    throw Error('staged_budget_publication_changed');
  }
  if (lock?.operationId !== context.operationId || !Number.isFinite(Date.parse(lock.lockedUntil))
      || Date.parse(lock.lockedUntil) <= now()) throw Error('staged_budget_lease_lost');
  if (actual.release !== context.release || actual.calculationVersion !== context.calculationVersion) {
    throw Error('staged_budget_live_calculator_changed');
  }
}

export function stagedBudgetWriteAllowed(key, context) {
  const prefix = `catalog/generations/${context.manifest.generationId}/indexes/`;
  const markets = PREPARED_MARKETS.join('|');
  if (key.startsWith(prefix)) {
    const relative = key.slice(prefix.length);
    const supplement = budgetSourceSupplementPrefix(context);
    if (supplement && relative.startsWith(supplement)) {
      return new RegExp(`^(?:cards|replay)/(?:${markets})/[a-f0-9]{64}\\.json$(?![\\s\\S])`).test(relative.slice(supplement.length));
    }
    return new RegExp(`^budget-markets-v(?:[12345]|[67]/[a-f0-9]{64})/(?:ready|${markets})\\.json$`).test(relative)
      || new RegExp(`^budget-markets-v(?:3|7/[a-f0-9]{64})/parts/(?:${markets})/[a-f0-9]{64}\\.json$`).test(relative);
  }
  return new RegExp(`^catalog/runtime-(?:budget|sort)-prices-v3/(?:${markets})/[a-f0-9]{64}\\.json$`).test(key)
    || new RegExp(`^catalog/runtime-budget-selections-v1/(?:${markets})/[a-f0-9]{64}/(?:ready|parts/(?:${markets})/[a-f0-9]{64})\\.json$`).test(key);
}

/** Installed only inside the disposable child process. Preserve real ETag/found metadata. */
export function installStagedBudgetStorage(storage, context, mode) {
  assertStagedBudgetContext(context);
  if (!['prepare', 'verify'].includes(mode)) throw Error('staged_budget_mode_invalid');
  const read = storage.readJsonWithMeta.bind(storage), write = storage.writeJson.bind(storage);
  storage.readJsonWithMeta = async (key, fallback, previous) => {
    // Never return an overlay supplied as a conditional 304 value when checking
    // the real public authority. Other keys retain their normal metadata contract.
    const result = await read(key, fallback, key === 'catalog/manifest.json' ? undefined : previous);
    if (key !== 'catalog/manifest.json') return result;
    if (!result.found || result.etag !== context.baseEtag || result.value?.generationId !== context.expectedBaseGenerationId) {
      throw Error('staged_budget_publication_changed');
    }
    return {...result, value:structuredClone(context.manifest)};
  };
  storage.readJson = async (key, fallback) => (await storage.readJsonWithMeta(key, fallback)).value;
  storage.writeJson = async (key, value, condition) => {
    if (mode !== 'prepare' || !stagedBudgetWriteAllowed(key, context)) throw Error('staged_budget_write_forbidden');
    assertStagedBudgetSupplementWrite(key, value, condition, context);
    return write(key, value, condition);
  };
  for (const name of ['putBinary', 'deleteJson', 'deleteBinary', 'deleteObjects', 'deletePrefix', 'abortMultipartUpload']) {
    if (typeof storage[name] === 'function') storage[name] = async () => { throw Error('staged_budget_write_forbidden'); };
  }
}

export function assertStagedBudgetReport(report, context, expected) {
  assertStagedBudgetContext(context);
  return assertBudgetReadinessReport(report, context, expected);
}

export function assertBudgetReadinessReport(report, context, expected) {
  const markets = budgetManifestMarkets(context.manifest);
  if (report?.version !== 1 || report.verified !== true || report.release !== context.release
      || report.calculationVersion !== context.calculationVersion || report.generationId !== context.manifest.generationId
      || report.manifestDigest !== stagedBudgetDigest(context.manifest)
      || report.encyclopediaDigest !== context.encyclopediaDigest
      || JSON.stringify(Object.keys(report.markets || {}).sort()) !== JSON.stringify(markets.slice().sort())
      || !/^\d{4}-\d{2}-\d{2}$/.test(report.utcDay || '') || !/^\d{4}-\d{2}-\d{2}$/.test(report.policyDay || '')) throw Error('staged_budget_report_invalid');
  for (const market of markets) {
    const row = report.markets[market];
    if (!CALCULATOR.test(row.fingerprint || '') || !CALCULATOR.test(row.sourceIds || '')
        || !CALCULATOR.test(row.selectorChecksum || '') || !Number.isSafeInteger(row.sourceRows) || row.sourceRows <= 0
        || row.sourceRows > context.manifest.markets[market].count) throw Error('staged_budget_market_incomplete:' + market);
    const coverage = row.coverage;
    if (coverage?.projectionRows !== context.manifest.markets[market].count || coverage?.selectorRows !== row.sourceRows
        || !Number.isSafeInteger(coverage?.eligibleRows) || coverage.eligibleRows < 0 || coverage.eligibleRows > row.sourceRows
        || !CALCULATOR.test(coverage?.projectionIds || '') || !CALCULATOR.test(coverage?.eligibleIds || '')) {
      throw Error('staged_budget_source_coverage_missing:' + market);
    }
    if (row.sourceSupplement !== undefined) assertBudgetSourceSupplement(row.sourceSupplement, context, market, row);
    for (const kind of ['budget', 'sort']) {
      if (!Number.isSafeInteger(row[kind]?.rows) || row[kind].rows < 0 || row[kind].rows > row.sourceRows
          || !CALCULATOR.test(row[kind]?.checksum || '')) throw Error('staged_budget_price_incomplete:' + market);
    }
  }
  const supplementCount = markets.filter(market => report.markets[market].sourceSupplement !== undefined).length;
  if (supplementCount !== 0 && supplementCount !== markets.length) throw Error('staged_budget_source_supplement_incomplete');
  if (expected && (report.utcDay !== expected.utcDay || report.policyDay !== expected.policyDay || report.encyclopediaDigest !== expected.encyclopediaDigest
      || stagedBudgetDigest(report.markets) !== stagedBudgetDigest(expected.markets)
      || stagedBudgetDigest(report.preparedSelections ?? null) !== stagedBudgetDigest(expected.preparedSelections ?? null))) {
    throw Error('staged_budget_prepared_context_changed');
  }
}

/** Manifest counts describe the raw published inventory. Selectors contain its
 * renderable subset. Prove coverage from the independent immutable projection,
 * rather than accepting an arbitrary smaller self-consistent selector. */
export function verifyBudgetSourceCoverage({manifest, market, projection, source, prepareRows}) {
  if (projection?.generationId !== manifest.generationId || !Array.isArray(projection.items)
      || projection.items.length !== manifest.markets[market]?.count) throw Error('staged_budget_projection_incomplete:' + market);
  const rawIds = projection.items.map(row => row?.id);
  if (rawIds.some(id => typeof id !== 'string' || !id || id !== id.trim()) || new Set(rawIds).size !== rawIds.length
      || projection.items.some(row => row.market !== market)) throw Error('staged_budget_projection_identity_invalid:' + market);
  const sourceIds = source.map(row => row?.[5]?.id), raw = new Set(rawIds), selected = new Set(sourceIds);
  if (selected.size !== source.length || sourceIds.some(id => !raw.has(id))) throw Error('staged_budget_selector_identity_invalid:' + market);
  const eligibleIds = prepareRows(projection.items).map(row => row.id);
  if (new Set(eligibleIds).size !== eligibleIds.length || eligibleIds.some(id => !selected.has(id))) {
    const missing = eligibleIds.filter(id => !selected.has(id));
    console.error(JSON.stringify({stage:'staged_budget_source_coverage_mismatch', market, generationId:manifest.generationId,
      eligibleRows:eligibleIds.length, selectorRows:sourceIds.length, duplicateEligibleRows:eligibleIds.length - new Set(eligibleIds).size,
      missingRows:missing.length, missingSample:missing.slice(0,10)}));
    throw Error('staged_budget_eligible_source_missing:' + market);
  }
  return {projectionRows:rawIds.length, selectorRows:sourceIds.length, eligibleRows:eligibleIds.length,
    projectionIds:stagedBudgetDigest(rawIds.sort()), eligibleIds:stagedBudgetDigest(eligibleIds.sort())};
}

// The China grid release deploys this exact build with the incumbent price-cache version.
// Both identities are pinned by .github/operations/china-ui-dark-v1/dark-standalone.py.
export function assertStagedCalculatorBuild(release, build, serving) {
  const gridRelease = '22867cbcfaee27b2e8917b6bf880e44827f67b60';
  if (release === gridRelease) {
    if (build === '672958a80c6a6eb869798c93cf1ee7d88301286ac910163115320fe5d8b95761'
        && serving === '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90') return;
  } else if (build === serving) return;
  throw Error('staged_budget_calculation_version_mismatch');
}

const childPath = fileURLToPath(new URL('../catalog-staged-budget-child.mjs', import.meta.url));
const run = promisify(execFile);
export function assertStagedRuntimeSource(root, release) {
  if (!root || !SHA.test(release || '')) throw Error('staged_budget_runtime_required');
  const source = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root, encoding:'utf8'}).trim();
  if (source !== release || execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'apps/web/lib', 'packages', 'data', 'scripts'], {cwd:root, encoding:'utf8'}).trim()) {
    throw Error('staged_budget_runtime_source_changed');
  }
}
export async function prepareStagedCatalogBudget({storage, manifest, expectedBaseGenerationId, operationId,
  runtimeRoot = process.env.CATALOG_BUDGET_RUNTIME_ROOT, release = process.env.CATALOG_BUDGET_RUNTIME_RELEASE}) {
  if (storage.driver !== 'object' || !runtimeRoot || !SHA.test(release || '')) throw Error('staged_budget_runtime_required');
  const root = path.resolve(runtimeRoot);
  assertStagedRuntimeSource(root, release);
  const [identity, base] = await Promise.all([readLiveBudgetIdentity(), storage.readJsonWithMeta('catalog/manifest.json', null)]);
  if (identity.release !== release) throw Error('staged_budget_live_calculator_changed');
  const context = {version:1, ...identity, manifest, expectedBaseGenerationId, baseEtag:base.etag, operationId};
  await verifyStagedBudgetAuthority(context, storage);
  context.encyclopediaDigest = await restoreReleaseEncyclopedia(storage, root, release);
  const {calculationVersion} = await import(pathToFileURL(path.join(root, 'scripts/catalog-calculation-version.mjs')).href);
  assertStagedCalculatorBuild(release, calculationVersion(root), identity.calculationVersion);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-staged-budget-'));
  const contextPath = path.join(directory, 'context.json'), reportPath = path.join(directory, 'report.json');
  await fs.writeFile(contextPath, JSON.stringify(context));
  const invoke = async mode => {
    await verifyStagedBudgetAuthority(context, storage);
    const invocation = await createResourceNodeInvocation({
      args:['--import', 'tsx', childPath, mode, root, contextPath, reportPath], role:'staged-budget-' + mode,
      env:{...process.env, AVTOCENA_RELEASE_SHA:release, AVTOCENA_CALCULATION_VERSION:identity.calculationVersion,
        NODE_OPTIONS:process.env.CATALOG_BUDGET_PREPARATION_NODE_OPTIONS ?? process.env.NODE_OPTIONS},
    });
    let stdout;
    try {
      const result = await run(process.execPath, invocation.args, {cwd:root, env:invocation.env,
        timeout:120 * 60_000, maxBuffer:1024 * 1024});
      stdout = result.stdout;
      forwardResourceNodeTelemetry(result.stderr);
    } catch (error) { forwardResourceNodeTelemetry(error.stderr); throw error; }
    if (stdout.trim()) console.log(stdout.trim());
    await verifyStagedBudgetAuthority(context, storage);
    return JSON.parse(await fs.readFile(reportPath, 'utf8'));
  };
  try {
    const prepared = await invoke('prepare');
    assertStagedBudgetReport(prepared, context);
    const verified = await invoke('verify');
    assertStagedBudgetReport(verified, context, prepared);
    await fs.writeFile('catalog-staged-budget-report.json', JSON.stringify(verified, null, 2));
    // Retain only bounded context/receipts. The child releases all market arrays.
    return async () => {
      const current = await invoke('verify');
      assertStagedBudgetReport(current, context, prepared);
    };
  } catch (error) {
    await fs.rm(directory, {recursive:true, force:true});
    throw error;
  }
}
