import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {restoreReleaseEncyclopedia} from '../encyclopedia/restore-calculation-index.mjs';

export const PREPARED_MARKETS = ['china', 'korea', 'uae', 'europe', 'georgia'];
export const stagedBudgetDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SHA = /^[a-f0-9]{40}$/, CALCULATOR = /^[a-f0-9]{64}$/;
const GENERATION = /^gen_\d+_[a-z0-9]+$/;

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
    for (const kind of ['budget', 'sort']) {
      if (!Number.isSafeInteger(row[kind]?.rows) || row[kind].rows < 0 || row[kind].rows > row.sourceRows
          || !CALCULATOR.test(row[kind]?.checksum || '')) throw Error('staged_budget_price_incomplete:' + market);
    }
  }
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
    throw Error('staged_budget_eligible_source_missing:' + market);
  }
  return {projectionRows:rawIds.length, selectorRows:sourceIds.length, eligibleRows:eligibleIds.length,
    projectionIds:stagedBudgetDigest(rawIds.sort()), eligibleIds:stagedBudgetDigest(eligibleIds.sort())};
}

const childPath = fileURLToPath(new URL('../catalog-staged-budget-child.mjs', import.meta.url));
const run = promisify(execFile);
export async function prepareStagedCatalogBudget({storage, manifest, expectedBaseGenerationId, operationId,
  runtimeRoot = process.env.CATALOG_BUDGET_RUNTIME_ROOT, release = process.env.CATALOG_BUDGET_RUNTIME_RELEASE}) {
  if (storage.driver !== 'object' || !runtimeRoot || !SHA.test(release || '')) throw Error('staged_budget_runtime_required');
  const root = path.resolve(runtimeRoot);
  const source = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root, encoding:'utf8'}).trim();
  if (source !== release || execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'apps/web/lib', 'packages', 'data', 'scripts'], {cwd:root, encoding:'utf8'}).trim()) {
    throw Error('staged_budget_runtime_source_changed');
  }
  const [identity, base] = await Promise.all([readLiveBudgetIdentity(), storage.readJsonWithMeta('catalog/manifest.json', null)]);
  if (identity.release !== release) throw Error('staged_budget_live_calculator_changed');
  const context = {version:1, ...identity, manifest, expectedBaseGenerationId, baseEtag:base.etag, operationId};
  await verifyStagedBudgetAuthority(context, storage);
  context.encyclopediaDigest = await restoreReleaseEncyclopedia(storage, root, release);
  const {calculationVersion} = await import(pathToFileURL(path.join(root, 'scripts/catalog-calculation-version.mjs')).href);
  if (calculationVersion(root) !== identity.calculationVersion) throw Error('staged_budget_calculation_version_mismatch');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-staged-budget-'));
  const contextPath = path.join(directory, 'context.json'), reportPath = path.join(directory, 'report.json');
  await fs.writeFile(contextPath, JSON.stringify(context));
  const invoke = async mode => {
    await verifyStagedBudgetAuthority(context, storage);
    const {stdout} = await run(process.execPath, ['--import', 'tsx', childPath, mode, root, contextPath, reportPath], {
      cwd:root, env:{...process.env, AVTOCENA_RELEASE_SHA:release, AVTOCENA_CALCULATION_VERSION:identity.calculationVersion,
        NODE_OPTIONS:process.env.CATALOG_BUDGET_PREPARATION_NODE_OPTIONS || '--max-old-space-size=6144'},
      timeout:120 * 60_000, maxBuffer:1024 * 1024,
    });
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
