import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const sha = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => { if (!value) throw Error('china_acceptance_' + code); };

/** Expected HTTP values from an exact local generation. This does not issue
 * HTTP requests and does not claim that a candidate or public site passed. */
export async function buildChinaAcceptanceOracle({runtimeRoot, generationDirectory, generationManifestSha256, outputFile}) {
  for (const directory of [runtimeRoot, generationDirectory]) {
    need(path.isAbsolute(directory) && await fs.realpath(directory) === directory, 'directory');
  }
  need(path.isAbsolute(outputFile) && /^[a-f0-9]{64}$/.test(generationManifestSha256), 'arguments');
  const bytes = await fs.readFile(path.join(generationDirectory, 'GENERATION.json'));
  need(sha(bytes) === generationManifestSha256, 'manifest_checksum');
  let manifest; try { manifest = JSON.parse(bytes.toString('utf8')); } catch { throw Error('china_acceptance_manifest_json'); }
  need(manifest.kind === 'china-local-generation-v1' && manifest.market === 'china' && /^[a-f0-9]{40}$/.test(manifest.runtimeSha), 'manifest');
  const {stdout} = await promisify(execFile)('git', ['-C', runtimeRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8', maxBuffer: 1024});
  const runtimeSha = stdout.trim(); need(/^[a-f0-9]{40}$/.test(runtimeSha), 'runtime_revision');

  // The controller verifies runtimeRoot's exact release before invoking this
  // process. No copy of the caller's own reader is substituted for that release.
  process.env.CATALOG_CHINA_LOCAL_GENERATION_DIR = generationDirectory;
  process.env.CATALOG_CHINA_LOCAL_MANIFEST_SHA256 = generationManifestSha256;
  process.env.CATALOG_CHINA_LOCAL_RUNTIME_SHA = manifest.runtimeSha;
  const readerPath = path.join(runtimeRoot, 'apps/web/lib/catalog/china-local-reader.ts');
  const reader = await import(pathToFileURL(readerPath).href);
  const [{presentCatalogOffer}, {normalizeVehicleOfferSpecs}, {isSellerPricedOffer}, {hasModificationSelection}] = await Promise.all([
    'presentation.ts', 'spec-normalization.ts', 'seller-price-contract.ts', 'modification-contract.ts',
  ].map(file => import(pathToFileURL(path.join(runtimeRoot, 'apps/web/lib/catalog', file)).href)));
  const state = await reader.initializeLocalChinaReader();
  need(state && state.manifest.generationId === manifest.generationId, 'generation');
  const names = await reader.localChinaCounts({market: 'china'});
  const popular = names.models.filter(row => row.make && row.model && row.count > 0)
    .sort((a, b) => b.count - a.count || `${a.make}:${a.model}`.localeCompare(`${b.make}:${b.model}`, 'ru'))[0];
  need(popular, 'model_sample');
  const pricedNames = await reader.localChinaCounts({market: 'china', hasPrice: 'yes'});
  const pricedPopular = pricedNames.models.filter(row => row.make && row.model && row.count > 0)
    .sort((a, b) => b.count - a.count || `${a.make}:${a.model}`.localeCompare(`${b.make}:${b.model}`, 'ru'))[0];
  need(pricedPopular, 'priced_model_sample');
  const samples = [
    ['china-first-page', {}],
    ['china-power-to-160', {powerTo: 160}],
    ['volkswagen-second-page', {make: 'Volkswagen', page: 2}],
    ['volkswagen-2014-budget-three-million', {make: 'Volkswagen', yearFrom: 2014, budgetTo: 3000000}],
    ['novokuznetsk-first-page', {city: 'Новокузнецк'}],
    ['moscow-budget-one-and-half-million', {city: 'Москва', budgetTo: 1500000}],
    ['moscow-budget-two-million', {city: 'Москва', budgetTo: 2000000}],
    ['china-deep-page-nine', {page: 9}],
    ['actual-popular-model', {make: popular.make, model: popular.model}],
    ['popular-model-2014-novokuznetsk', {make: pricedPopular.make, model: pricedPopular.model, yearFrom: 2014, city: 'Новокузнецк', hasPrice: 'yes'}],
    ['retained-unpriced-inventory', {hasPrice: 'no'}],
    ['china-frozen-rates-and-facets', {includeRates: '1', includeFacets: '1'}],
  ];
  const cases = [];
  for (const [name, fields] of samples) {
    const request = {market: 'china', marketPage: '1', page: 1, ...fields, preparedCut: manifest.generationId};
    const {marketPage, includeRates, includeFacets, ...params} = request;
    const result = await reader.searchLocalChina(params, {marketPage: true, includeFacets: includeFacets === '1', expectedGeneration: manifest.generationId});
    need(result && result.generationId === manifest.generationId && Number.isSafeInteger(result.total) && result.total >= 0 &&
      result.items.length <= 24 && result.items.every(row => /^[a-f0-9]{24}$/.test(row.id)), 'result');
    const power = name === 'china-power-to-160' ? result.items.map(row => {
      const normalized = hasModificationSelection(row) || isSellerPricedOffer(row) ? row : normalizeVehicleOfferSpecs(row);
      const display = presentCatalogOffer(normalized), positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
      return {displayHp: positive(display.powerHp), displayKw: positive(display.powerKw), utilizationKw: positive(row.utilizationPowerKw),
        filterPowerHp: state.semantics.buildRowKeys(row).filterPowerHp};
    }) : undefined;
    cases.push({name, path: '/api/catalog/search?' + new URLSearchParams(Object.entries(request).map(([key, value]) => [key, String(value)])).toString(),
      total: result.total, ids: result.items.map(row => row.id), totalRub: result.items.map(row => row.totalRub ?? null), ...(power ? {power} : {})});
  }
  need(cases[0].total === manifest.rows, 'complete_inventory');
  state.assertCurrent();
  const oracle = {version: 1, runtimeSha, pricingRuntimeSha: manifest.runtimeSha, generationManifestSha256, expectedGeneration: manifest.generationId,
    kind: 'local-native-reader-http-expectations-v1', syntheticExpectations: true, httpVerified: false, cases};
  await fs.writeFile(outputFile, JSON.stringify(oracle) + '\n', {flag: 'wx', mode: 0o600});
  return {oracle, sha256: sha(await fs.readFile(outputFile)), cases: cases.length, totals: cases.map(item => ({name: item.name, total: item.total, items: item.ids.length}))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runtimeRoot, generationDirectory, generationManifestSha256, outputFile, ...rest] = process.argv.slice(2);
  try {
    need(!rest.length && runtimeRoot && generationDirectory && generationManifestSha256 && outputFile, 'arguments');
    const result = await buildChinaAcceptanceOracle({runtimeRoot, generationDirectory, generationManifestSha256, outputFile});
    process.stdout.write(JSON.stringify({phase: 'china_local_acceptance_expected', httpVerified: false, cases: result.cases, totals: result.totals, sha256: result.sha256}) + '\n');
  } catch (error) {
    const code = /^china_acceptance_[a-z_]+$/.test(error?.message || '') ? error.message : 'china_acceptance_failed';
    process.stderr.write(code + '\n'); process.exitCode = 1;
  }
}
