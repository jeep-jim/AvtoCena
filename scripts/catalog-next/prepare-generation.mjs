import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {restorePrivateChinaSource} from './restore-private-source.mjs';
import {chinaSourceOutputRoot} from './private-source-output.mjs';
import {createPrivateChinaStorage} from './private-storage.mjs';
import {materializeChinaRuntimeContext, createChinaRuntimeReader} from './runtime-context.mjs';
import {createPrivateChinaGenerationStorage} from './generation-storage.mjs';
import {savePrivateChinaGeneration} from './private-generation.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => assert(value, 'china_prepare_' + code);
const log = value => console.log(JSON.stringify(value));
const reportPath = path.resolve(process.env.CATALOG_NEXT_REPORT ?? 'catalog-next-china-generation-report.json');
const report = {version: 1, market: 'china', completed: false, published: false, liveCatalogWrites: 0,
  encyclopediaWrites: 0, calculatorFormulaChanges: 0, deletions: 0};
const safeCode = error => /^[a-z][a-z0-9_:-]{2,160}$/i.test(error?.message ?? '') ? error.message : 'china_generation_preparation_failed';
let phase = 'invocation';
const step = async (name, fn) => { phase = name; log({phase: name, started: true, published: false}); return fn(); };

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

try {
  const invocation = verifyReadonlyInvocation({root, markerPath: '.github/market-runs/catalog-next-china-generation.json', operation: 'prepare-china-generation'});
  report.controllerSha = invocation.sourceSha;
  need(process.argv.length === 3, 'arguments');
  const runtimeRoot = await fs.realpath(process.argv[2]);
  const plan = JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next/china-plan.json'), 'utf8'));
  report.runtime = runtimeProof(runtimeRoot, plan);
  need(plan.version === 1 && plan.market === 'china' && plan.minimumYear === 2014 &&
    plan.source.owner.runId === '45349439965' && plan.source.owner.attempt === '1' &&
    plan.source.owner.revision === 'be1da8b4c7c54ccfb8285a96a4b8d702aec52741' &&
    plan.source.receiptSha256 === 'ba1475890fdee71c5a4a16b3461e3f7e03ae62bda6d6a20fb3175d75eb494edb', 'source_plan');
  need(process.env.JSON_STORAGE_DRIVER === 'object', 'storage_driver');
  const scratch = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP ?? '/tmp', 'china-generation-'));
  const storage = getJsonStorage();
  const {refreshChinaSource, assertChinaFeedControl} = await import('./refresh-china-source.mjs');
  let controlsUntil = 0;
  const checkControl = async (force = false) => {
    if (!force && Date.now() < controlsUntil) return true;
    const value = await storage.readJson('catalog/operations/collection-controls-v1.json', null);
    assertChinaFeedControl(value); controlsUntil = Date.now() + 5000; return true;
  };
  await checkControl(true);
  const context = await step('capture_china_inputs', () => materializeChinaRuntimeContext({runtimeRoot,
    runtimeSha: plan.runtimeSha, encyclopedia: plan.encyclopedia, outputDirectory: path.join(scratch, 'context'),
    readObject: createChinaRuntimeReader({credentials: {accessKeyId: process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY}})}));
  need(context.receipt.encyclopedia.indexSha256 === '66cc4ce64e0469daad2991251f88887dcd3a07cc26510ca1b58696bcea348a3c', 'encyclopedia_installed_bytes');
  report.contextReceiptSha256 = context.receiptSha256;
  const sourceStorage = createPrivateChinaStorage({root: chinaSourceOutputRoot(plan.source.owner)});
  const source = await step('restore_complete_source', () => restorePrivateChinaSource({
    storage: {getBinary: sourceStorage.getBinary, assertPrivateBucket: sourceStorage.assertPrivateBucket},
    owner: plan.source.owner, expectedReceiptSha256: plan.source.receiptSha256,
    outputDirectory: path.join(scratch, 'saved-source'), onProgress: log}));
  const {autoApiChe168Client} = await import('../lib/auto-api-che168-client.mjs');
  const client = autoApiChe168Client({apiKey: process.env.AUTO_API_CHE168_KEY, platform: 'che168',
    requestDelayMs: 200, retryRateLimit: true});
  const refreshed = await step('refresh_complete_source', () => refreshChinaSource({source,
    outputDirectory: path.join(scratch, 'fresh-source'), client, checkControl, onProgress: log}));
  report.source = {sourceObservedAt: refreshed.manifest.sourceObservedAt,
    sourceCursor: refreshed.manifest.source.cursor, supplierLatestVerified: refreshed.manifest.supplierLatestVerified,
    sourceDescriptorSha256: refreshed.descriptorSha256, reconciliation: refreshed.reconciliation};
  need(refreshed.manifest.supplierLatestVerified === true, 'source_not_refreshed');
  // Only this process's restored scratch copy is removed. Its verified private
  // original and the refreshed durable input remain distinct generations.
  await fs.rm(source.directory, {recursive: true});
  const generationId = `gen_china_${process.env.GITHUB_RUN_ID}_${process.env.GITHUB_RUN_ATTEMPT}`;
  const generationDirectory = path.join(scratch, 'generation');
  const pricing = await step('prepare_frozen_prices_and_indexes', () => childPricing({runtimeRoot, context, source: refreshed,
    outputDirectory: generationDirectory, generationId, scratch}));
  report.pricing = pricing;
  runtimeProof(runtimeRoot, plan); await checkControl(true);
  const owner = {runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha};
  const generationStorage = createPrivateChinaGenerationStorage({owner});
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
    onProgress: log, assertAuthority: () => checkControl()}));
  report.privateGeneration = {owner, receiptSha256: durable.receiptSha256, totalBytes: durable.receipt.totalBytes,
    storedBytes: durable.receipt.storedBytes, generationId, generationManifestSha256: pricing.generationManifestSha256};
  report.completed = true; report.phase = 'complete_private_generation'; report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); log(report);
} catch (error) {
  report.phase = phase; report.errorCode = safeCode(error); report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); log(report); process.exitCode = 1;
}
