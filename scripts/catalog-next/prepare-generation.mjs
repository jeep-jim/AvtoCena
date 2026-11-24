import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {restorePrivateChinaSource} from './restore-private-source.mjs';
import {chinaSourceOutputRoot, PRIVATE_SOURCE_FILES} from './private-source-output.mjs';
import {createPrivateChinaStorage} from './private-storage.mjs';
import {materializeChinaRuntimeContext, createChinaRuntimeReader} from './runtime-context.mjs';
import {createPrivateChinaGenerationStorage, chinaGenerationRoot} from './generation-storage.mjs';
import {savePrivateChinaGeneration, restorePrivateChinaGeneration} from './private-generation.mjs';
import {validateChinaGenerationReference} from './china-state.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => assert(value, 'china_prepare_' + code);
const safeCode = error => /^[a-z][a-z0-9_:-]{2,160}$/i.test(error?.message ?? '') ? error.message : 'china_generation_preparation_failed';
const freshReport = () => ({version: 1, market: 'china', completed: false, published: false, liveCatalogWrites: 0,
  encyclopediaWrites: 0, calculatorFormulaChanges: 0, deletions: 0});
const sourceNames = Object.freeze(['SOURCE.json', 'source.sqlite']);
const ownerCopy = owner => ({runId: owner.runId, attempt: owner.attempt, revision: owner.revision});

/** The original CLI always uses the exact first source that was reviewed.
 * Accepted generations are a separate explicit input to the reusable API. */
export function selectChinaPreparationSource({plan, sourceSelection}) {
  if (sourceSelection === undefined) {
    need(plan?.source?.owner?.runId === '45349439965' && plan.source.owner.attempt === '1'
      && plan.source.owner.revision === 'be1da8b4c7c54ccfb8285a96a4b8d702aec52741'
      && plan.source.receiptSha256 === 'ba1475890fdee71c5a4a16b3461e3f7e03ae62bda6d6a20fb3175d75eb494edb', 'source_plan');
    return Object.freeze({kind: 'initial-saved-source', owner: Object.freeze(ownerCopy(plan.source.owner)),
      receiptSha256: plan.source.receiptSha256});
  }
  need(sourceSelection && Object.keys(sourceSelection).sort().join(',') === 'generation,kind'
    && sourceSelection.kind === 'accepted-generation', 'source_selection');
  const generation = validateChinaGenerationReference(sourceSelection.generation, {requireAccepted: true});
  return Object.freeze({kind: 'accepted-generation', generation});
}

function sourceReadCapability(storage, storageRoot, names) {
  need(typeof storage?.assertPrivateBucket === 'function' && typeof storage.getBinary === 'function', 'source_storage');
  return Object.freeze({
    assertPrivateBucket: () => storage.assertPrivateBucket(),
    getBinary: key => {
      need(key === storageRoot + '/complete.json' || names.some(name => {
        const prefix = storageRoot + '/files/' + name + '/';
        return typeof key === 'string' && key.startsWith(prefix) && /^[0-9]+-[a-f0-9]{64}$/.test(key.slice(prefix.length));
      }), 'source_read_scope');
      return storage.getBinary(key);
    },
  });
}

/** A later cycle restores ONLY the accepted predecessor's raw source pair.
 * No prior prices, FX, settings, index or published pointer is read or reused.
 * The scheduler resolves accepted/pending state; this function binds every
 * selected identity to the immutable private receipt and the local descriptor. */
export async function restoreChinaPreparationSource({plan, sourceSelection, storage, outputDirectory, onProgress = () => {}}) {
  const selection = selectChinaPreparationSource({plan, sourceSelection});
  if (selection.kind === 'initial-saved-source') {
    const source = await restorePrivateChinaSource({
      storage: sourceReadCapability(storage, chinaSourceOutputRoot(selection.owner), PRIVATE_SOURCE_FILES),
      owner: selection.owner, expectedReceiptSha256: selection.receiptSha256, outputDirectory, onProgress});
    return {selection, source};
  }
  const reference = selection.generation, owner = ownerCopy(reference.owner);
  let restored;
  try {
    restored = await restorePrivateChinaGeneration({
      storage: sourceReadCapability(storage, chinaGenerationRoot(owner), sourceNames), owner,
      expectedReceiptSha256: reference.receiptSha256, outputDirectory, names: sourceNames, onProgress});
    const binding = restored.receipt.binding;
    need(binding?.market === 'china' && binding.generationId === reference.generationId
      && binding.runtimeSha === reference.pricingRuntimeSha && binding.sourceDescriptorSha256 === reference.sourceDescriptorSha256
      && binding.generationManifestSha256 === reference.generationManifestSha256, 'accepted_source_binding');
    const {openLocalRefreshedChinaSource} = await import('./refresh-china-source.mjs');
    const opened = await openLocalRefreshedChinaSource({descriptorPath: restored.paths['SOURCE.json'],
      expectedSha256: reference.sourceDescriptorSha256});
    need(opened.manifest.source.cursor === reference.sourceCursor
      && opened.manifest.sourceObservedAt === reference.sourceObservedAt, 'accepted_source_cursor');
    // The new delta journal names its immediate accepted predecessor, not the
    // first source receipt that originally began the chain.
    const source = Object.freeze({...opened, receiptSha256: reference.receiptSha256});
    return {selection, source};
  } catch (error) {
    if (restored) await fs.rm(outputDirectory, {recursive: true});
    throw error;
  }
}

function runtimeProof(runtimeRoot, plan) {
  const git = args => execFileSync('git', ['--no-optional-locks', ...args], {cwd: runtimeRoot, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe']});
  need(/^[a-f0-9]{40}$/.test(plan.runtimeSha ?? '') && /^[a-f0-9]{40}$/.test(plan.runtimeTree ?? '') &&
    plan.retainedRuntime === '56d6b94fea70457e0ce2b0820596da9972846b90', 'runtime_plan');
  need(git(['rev-parse', 'HEAD']).trim() === plan.runtimeSha && git(['rev-parse', 'HEAD^{tree}']).trim() === plan.runtimeTree, 'runtime_identity');
  git(['diff', '--quiet', '--no-ext-diff', 'HEAD', '--']);
  git(['merge-base', '--is-ancestor', plan.retainedRuntime, plan.runtimeSha]);
  const changed = git(['diff', '--name-only', '--no-renames', plan.retainedRuntime, plan.runtimeSha]).trim().split('\n').filter(Boolean).sort();
  need(Array.isArray(plan.runtimeFiles) && JSON.stringify(changed) === JSON.stringify([...plan.runtimeFiles].sort()), 'runtime_change_scope');
  need(hash(git(['diff', '--binary', '--no-ext-diff', '--no-renames', plan.retainedRuntime, plan.runtimeSha])) === plan.runtimeDiffSha256, 'runtime_diff');
  // The new reader/FX context may change, but source formula/configuration and
  // encyclopedia/admin content must remain exactly the accepted runtime's.
  git(['diff', '--quiet', plan.retainedRuntime, plan.runtimeSha, '--', 'packages/engine',
    'apps/web/lib/encyclopedia', 'apps/web/app/(crm)', 'apps/web/components/site', 'data', 'apps/web/lib/business-settings.ts']);
  return {runtimeSha: plan.runtimeSha, runtimeTree: plan.runtimeTree, runtimeDiffSha256: plan.runtimeDiffSha256};
}

async function childPricing({runtimeRoot, context, source, outputDirectory, generationId, scratch}) {
  const config = {version: 1, runtimeRoot, runtimeSha: context.receipt.runtimeSha,
    contextDirectory: context.paths.directory, contextReceiptSha256: context.receiptSha256,
    sourceDescriptor: source.paths.descriptor, sourceDescriptorSha256: source.descriptorSha256,
    outputDirectory, generationId};
  const filename = path.join(scratch, 'PRICING_INPUT.json');
  await fs.writeFile(filename, JSON.stringify(config), {mode: 0o600, flag: 'wx'});
  const env = {PATH: process.env.PATH, NODE_ENV: 'production', JSON_STORAGE_DRIVER: 'local',
    TZ: 'Asia/Krasnoyarsk', CATALOG_NEXT_PRICING_INPUT_SHA256: hash(JSON.stringify(config))};
  const code = await new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [path.join(root, 'scripts/run-node-with-resources.mjs'),
      '--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href,
      path.join(root, 'scripts/catalog-next/pricing-entry.mjs'), filename],
    {cwd: context.paths.directory, env, stdio: ['ignore', 'inherit', 'pipe']});
    // Exceptions can contain an offer or filesystem data; public logs contain
    // only the worker's explicit aggregate JSON records and its safe result.
    processChild.stderr.on('data', () => {});
    processChild.once('error', () => reject(Error('china_prepare_pricing_process')));
    processChild.once('close', resolve);
  });
  const value = JSON.parse(await fs.readFile(path.join(outputDirectory, 'PRICING_RESULT.json'), 'utf8'));
  need(code === 0 && value.completed === true && value.runtimeSha === context.receipt.runtimeSha &&
    value.generationId === generationId, value.errorCode ?? 'pricing_failed');
  return value;
}

function preparationCapabilities(overrides) {
  const defaults = {
    verifyRuntime: runtimeProof,
    async readCollectionControls() {
      need(process.env.JSON_STORAGE_DRIVER === 'object', 'storage_driver');
      const {getJsonStorage} = await import('../../apps/web/lib/data.ts');
      return getJsonStorage().readJson('catalog/operations/collection-controls-v1.json', null);
    },
    captureRuntimeContext: args => materializeChinaRuntimeContext({...args,
      readObject: createChinaRuntimeReader({credentials: {accessKeyId: process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY}})}),
    initialSourceStorage: owner => createPrivateChinaStorage({root: chinaSourceOutputRoot(owner)}),
    generationStorage: owner => createPrivateChinaGenerationStorage({owner}),
    async createProviderClient() {
      const {autoApiChe168Client} = await import('../lib/auto-api-che168-client.mjs');
      return autoApiChe168Client({apiKey: process.env.AUTO_API_CHE168_KEY, platform: 'che168',
        requestDelayMs: 200, retryRateLimit: true});
    },
    preparePricing: childPricing,
    now: () => new Date().toISOString(),
  };
  need(overrides && typeof overrides === 'object' && !Array.isArray(overrides)
    && Object.keys(overrides).every(key => Object.hasOwn(defaults, key) && typeof overrides[key] === 'function'), 'capabilities');
  return {...defaults, ...overrides};
}

/** Prepare one complete private generation. The caller authenticates its own
 * invocation (initial manual/push or a future daily scheduler) before calling;
 * no GitHub event fields are rewritten here. A daily caller must reconcile its
 * pending state first and can check/renew its market lease via assertAuthority.
 * Capabilities are in-process dependencies, never CLI/env-controlled switches. */
export async function prepareChinaGeneration({runtimeRoot, plan, invocation, owner, sourceSelection,
  runnerTemp = process.env.RUNNER_TEMP ?? '/tmp', reportPath, capabilities = {},
  assertAuthority = async () => {}, onProgress = () => {}}) {
  const report = freshReport(); let phase = 'invocation';
  const capabilitiesForRun = preparationCapabilities(capabilities);
  const persist = async () => {
    if (reportPath !== undefined) await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    await onProgress(report);
  };
  const step = async (name, fn) => { phase = name; await onProgress({phase: name, started: true, published: false}); return fn(); };
  try {
    need(invocation?.version === 1 && /^[a-f0-9]{40}$/.test(invocation.sourceSha ?? ''), 'invocation');
    need(owner && Object.keys(owner).sort().join(',') === 'attempt,revision,runId'
      && owner.revision === invocation.sourceSha, 'owner');
    owner = ownerCopy(owner); chinaGenerationRoot(owner);
    need(plan?.version === 1 && plan.market === 'china' && plan.minimumYear === 2014, 'market_plan');
    need(typeof assertAuthority === 'function' && typeof onProgress === 'function'
      && (reportPath === undefined || typeof reportPath === 'string' && path.isAbsolute(reportPath)), 'arguments');
    const selection = selectChinaPreparationSource({plan, sourceSelection});
    report.controllerSha = invocation.sourceSha;
    runtimeRoot = await fs.realpath(runtimeRoot);
    report.runtime = await capabilitiesForRun.verifyRuntime(runtimeRoot, plan);
    need(report.runtime?.runtimeSha === plan.runtimeSha && report.runtime.runtimeTree === plan.runtimeTree
      && report.runtime.runtimeDiffSha256 === plan.runtimeDiffSha256, 'runtime_proof');
    const temporary = await fs.realpath(runnerTemp);
    const scratch = await fs.mkdtemp(path.join(temporary, 'china-generation-'));
    const {refreshChinaSource, assertChinaFeedControl} = await import('./refresh-china-source.mjs');
    let controlsUntil = 0;
    const checkControl = async (force = false) => {
      await assertAuthority();
      if (!force && Date.now() < controlsUntil) return true;
      assertChinaFeedControl(await capabilitiesForRun.readCollectionControls());
      controlsUntil = Date.now() + 5000; return true;
    };
    await checkControl(true);
    const context = await step('capture_china_inputs', () => capabilitiesForRun.captureRuntimeContext({runtimeRoot,
      runtimeSha: plan.runtimeSha, encyclopedia: plan.encyclopedia, outputDirectory: path.join(scratch, 'context')}));
    need(context.receipt.encyclopedia.indexSha256 === '66cc4ce64e0469daad2991251f88887dcd3a07cc26510ca1b58696bcea348a3c', 'encyclopedia_installed_bytes');
    report.contextReceiptSha256 = context.receiptSha256;
    const sourceOwner = selection.kind === 'accepted-generation' ? ownerCopy(selection.generation.owner) : selection.owner;
    const sourceStorage = selection.kind === 'accepted-generation'
      ? await capabilitiesForRun.generationStorage(sourceOwner)
      : await capabilitiesForRun.initialSourceStorage(sourceOwner);
    const savedSourceDirectory = path.join(scratch, 'saved-source');
    const {source} = await step('restore_complete_source', () => restoreChinaPreparationSource({plan, sourceSelection,
      storage: sourceStorage, outputDirectory: savedSourceDirectory, onProgress}));
    report.sourceInput = selection.kind === 'initial-saved-source' ? {...selection} : {
      kind: selection.kind, owner: sourceOwner, receiptSha256: selection.generation.receiptSha256,
      sourceDescriptorSha256: selection.generation.sourceDescriptorSha256, generationId: selection.generation.generationId,
      runtimeSha: selection.generation.runtimeSha, pricingRuntimeSha: selection.generation.pricingRuntimeSha,
      sourceCursor: selection.generation.sourceCursor,
      sourceObservedAt: selection.generation.sourceObservedAt};
    await checkControl(true);
    const client = await capabilitiesForRun.createProviderClient();
    const refreshed = await step('refresh_complete_source', () => refreshChinaSource({source,
      outputDirectory: path.join(scratch, 'fresh-source'), client, checkControl, onProgress, now: capabilitiesForRun.now}));
    report.source = {sourceObservedAt: refreshed.manifest.sourceObservedAt,
      sourceCursor: refreshed.manifest.source.cursor, supplierLatestVerified: refreshed.manifest.supplierLatestVerified,
      sourceDescriptorSha256: refreshed.descriptorSha256, reconciliation: refreshed.reconciliation};
    need(refreshed.manifest.supplierLatestVerified === true, 'source_not_refreshed');
    // Remove only the restored input directory created in this process's new
    // scratch. Both the accepted private predecessor and fresh source remain.
    await fs.rm(savedSourceDirectory, {recursive: true});
    const generationId = `gen_china_${owner.runId}_${owner.attempt}`;
    const generationDirectory = path.join(scratch, 'generation');
    const pricing = await step('prepare_frozen_prices_and_indexes', () => capabilitiesForRun.preparePricing({runtimeRoot,
      context, source: refreshed, outputDirectory: generationDirectory, generationId, scratch}));
    need(pricing?.completed === true && pricing.runtimeSha === plan.runtimeSha && pricing.generationId === generationId
      && pricing.sourceDescriptorSha256 === refreshed.descriptorSha256
      && /^[a-f0-9]{64}$/.test(pricing.generationManifestSha256 ?? ''), 'pricing_binding');
    report.pricing = pricing;
    await capabilitiesForRun.verifyRuntime(runtimeRoot, plan); await checkControl(true);
    const generationStorage = await capabilitiesForRun.generationStorage(owner);
    const files = Object.fromEntries(['DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json',
      'GENERATION.json', 'RECONCILIATION.json', 'details.sqlite', 'query.sqlite'].map(name => [name, path.join(generationDirectory, name)]));
    Object.assign(files, {'SOURCE.json': refreshed.paths.descriptor, 'source.sqlite': refreshed.paths.database,
      'RUNTIME_CONTEXT.json': context.paths.receipt,
      'china-market.json': path.join(context.paths.data, 'markets/markets.json'),
      'exchange-rates.json': path.join(context.paths.data, 'fees/exchange-rates.json'),
      'editorial.json': path.join(context.paths.data, 'catalog-editorial/current.json'),
      'cny-anchors.json': path.join(context.paths.data, 'catalog/china-cny-prices/current.json')});
    const durable = await step('save_complete_private_generation', () => savePrivateChinaGeneration({storage: generationStorage,
      owner, files, binding: {market: 'china', generationId, runtimeSha: plan.runtimeSha,
        sourceDescriptorSha256: refreshed.descriptorSha256, generationManifestSha256: pricing.generationManifestSha256},
      onProgress, assertAuthority: () => checkControl()}));
    report.privateGeneration = {owner, receiptSha256: durable.receiptSha256, totalBytes: durable.receipt.totalBytes,
      storedBytes: durable.receipt.storedBytes, generationId, generationManifestSha256: pricing.generationManifestSha256,
      sourceDescriptorSha256: refreshed.descriptorSha256};
    report.completed = true; report.phase = 'complete_private_generation'; report.finishedAt = capabilitiesForRun.now();
    await persist(); return report;
  } catch (error) {
    report.phase = phase; report.errorCode = safeCode(error); report.finishedAt = capabilitiesForRun.now();
    await persist();
    const failure = Error(report.errorCode); failure.report = report; throw failure;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportPath = path.resolve(process.env.CATALOG_NEXT_REPORT ?? 'catalog-next-china-generation-report.json');
  const log = value => console.log(JSON.stringify(value));
  try {
    const invocation = verifyReadonlyInvocation({root, markerPath: '.github/market-runs/catalog-next-china-generation.json', operation: 'prepare-china-generation'});
    need(process.argv.length === 3, 'arguments');
    const runtimeRoot = await fs.realpath(process.argv[2]);
    const plan = JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next/china-plan.json'), 'utf8'));
    selectChinaPreparationSource({plan}); // CLI never selects a receipt via env or a new command-line flag.
    need(process.env.JSON_STORAGE_DRIVER === 'object', 'storage_driver');
    await prepareChinaGeneration({runtimeRoot, plan, invocation, reportPath,
      owner: {runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha},
      onProgress: log});
  } catch (error) {
    if (!error?.report) {
      const report = {...freshReport(), phase: 'invocation', errorCode: safeCode(error), finishedAt: new Date().toISOString()};
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); log(report);
    }
    process.exitCode = 1;
  }
}
