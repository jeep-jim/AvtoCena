import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openLocalRefreshedChinaSource} from './refresh-china-source.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => assert(value, 'china_pricing_entry_' + code);
let config, output, phase = 'input';
const result = {version: 1, completed: false, published: false};
try {
  need(process.argv.length === 3 && process.env.JSON_STORAGE_DRIVER === 'local', 'arguments');
  const raw = await fs.readFile(process.argv[2]);
  need(hash(raw) === process.env.CATALOG_NEXT_PRICING_INPUT_SHA256, 'input_checksum'); config = JSON.parse(raw);
  need(config.version === 1 && process.cwd() === config.contextDirectory && path.isAbsolute(config.runtimeRoot) &&
    /^[a-f0-9]{40}$/.test(config.runtimeSha) && /^gen_china_[1-9]\d*_[1-9]\d*$/.test(config.generationId), 'input_scope');
  output = config.outputDirectory;
  const contextRaw = await fs.readFile(path.join(config.contextDirectory, 'RUNTIME_CONTEXT.json'));
  need(hash(contextRaw) === config.contextReceiptSha256, 'context_checksum');
  const receipt = JSON.parse(contextRaw);
  need(receipt.runtimeSha === config.runtimeSha && receipt.market === 'china', 'runtime_context');
  const runtimeImport = relative => import(pathToFileURL(path.join(config.runtimeRoot, relative)).href);
  phase = 'open_complete_refreshed_source';
  const source = await openLocalRefreshedChinaSource({descriptorPath: config.sourceDescriptor, expectedSha256: config.sourceDescriptorSha256});
  phase = 'capture_search_semantics';
  const {createSemanticSnapshotFromRuntime} = await runtimeImport('scripts/catalog-next/query-semantics.mjs');
  const semantics = await createSemanticSnapshotFromRuntime(config.runtimeRoot);
  phase = 'capture_single_fx_batch';
  const {captureCatalogFxBatch} = await runtimeImport('apps/web/lib/catalog/rates.ts');
  const fxBatch = await captureCatalogFxBatch('china', receipt.currencies);
  // No supplier, live FX, remote encyclopedia or shared catalog reads are
  // permitted once the immutable calculation batch has been captured.
  let blockedRequests = 0;
  globalThis.fetch = async () => { blockedRequests++; throw Error('china_offline_unexpected_network'); };
  phase = 'calculate_and_index';
  const {buildChinaPricingGeneration} = await runtimeImport('scripts/catalog-next/pricing-generation.mjs');
  const prepared = await buildChinaPricingGeneration({source, context: {receipt, receiptSha256: config.contextReceiptSha256},
    fxBatch, semanticModels: semantics.models, generationId: config.generationId,
    outputDirectory: output, onProgress: value => console.log(JSON.stringify(value))});
  need(blockedRequests === 0, 'unexpected_network');
  const generationRaw = await fs.readFile(path.join(output, 'GENERATION.json'));
  Object.assign(result, {completed: true, runtimeSha: config.runtimeSha, generationId: config.generationId,
    generationManifestSha256: hash(generationRaw), sourceDescriptorSha256: config.sourceDescriptorSha256,
    sourceObservedAt: source.manifest.sourceObservedAt, pricingAsOf: fxBatch.receipt.pricingAsOf,
    fxReceiptSha256: fxBatch.receiptSha256, semanticsInputSha256: semantics.sha256,
    reconciliation: prepared.reconciliation, networkAfterFxCapture: 0});
} catch (error) {
  result.phase = phase;
  result.errorCode = /^[a-z][a-z0-9_:-]{2,160}$/i.test(error?.message ?? '') ? error.message : 'china_pricing_failed';
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  if (output) { await fs.mkdir(output, {recursive: true, mode: 0o700});
    await fs.writeFile(path.join(output, 'PRICING_RESULT.json'), JSON.stringify(result, null, 2), {mode: 0o600}); }
  console.log(JSON.stringify(result));
}
