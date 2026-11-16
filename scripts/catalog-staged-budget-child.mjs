import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {PREPARED_MARKETS, budgetManifestMarkets, assertStagedBudgetContext, assertBudgetReadinessReport, installStagedBudgetStorage,
  stagedBudgetDigest, verifyBudgetSourceCoverage, assertBudgetSourceSupplement} from './lib/catalog-staged-budget.mjs';

export function installStagedBudgetNetworkFence(endpoint, fetchImpl = globalThis.fetch, allowStorageWrites = true) {
  const storageOrigin = new URL(endpoint).origin;
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = String(options?.method || input?.method || 'GET').toUpperCase();
    const stored = url.origin === storageOrigin && (['GET', 'HEAD'].includes(method) || allowStorageWrites && method === 'PUT');
    const rate = url.origin === 'https://www.cbr.ru' && url.pathname === '/scripts/XML_daily.asp' && method === 'GET';
    if (!stored && !rate) throw Error('staged_budget_external_request_forbidden');
    return fetchImpl(input, {...options, redirect:'error'});
  };
}

export async function runStagedBudgetChild({mode, root, context, reportPath}) {
  assertStagedBudgetContext(context);
  const runtime = relative => import(pathToFileURL(path.join(root, relative)).href);
  installStagedBudgetNetworkFence(process.env.YC_OBJECT_STORAGE_ENDPOINT, globalThis.fetch, mode === 'prepare');
  const {getJsonStorage} = await runtime('apps/web/lib/data.ts');
  const storage = getJsonStorage();
  if (storage.driver !== 'object') throw Error('object_storage_required');
  installStagedBudgetStorage(storage, context, mode);
  return collectPreparedBudgetReadiness({mode, root, context, reportPath, storage});
}

/** Shared readback core. The caller installs staged or active authority guards
 * and a write fence before importing any calculator modules. */
export async function collectPreparedBudgetReadiness({mode, root, context, reportPath, storage}) {
  if (!['prepare', 'verify'].includes(mode)) throw Error('staged_budget_mode_invalid');
  const markets = budgetManifestMarkets(context.manifest);
  const runtime = relative => import(pathToFileURL(path.join(root, relative)).href);
  const [catalog, pricing, codec, publication, encyclopedia] = await Promise.all([
    runtime('apps/web/lib/catalog/storage.ts'), runtime('apps/web/lib/catalog/shared-budget-prices.ts'),
    runtime('apps/web/lib/catalog/budget-selector-codec.ts'), runtime('apps/web/lib/catalog/budget-selector-publication.ts'),
    runtime('apps/web/lib/encyclopedia/calculation-index.ts'),
  ]);
  if ((encyclopedia.readCalculationIndex()?.digest || null) !== context.encyclopediaDigest
      || pricing.calculationCacheVersion() !== context.calculationVersion) throw Error('staged_budget_runtime_context_mismatch');
  const supplements = typeof catalog.readBudgetSpecificationSource === 'function';
  if (supplements !== (typeof catalog.verifyBudgetSpecificationSource === 'function')
      || supplements && typeof catalog.prepareBudgetSpecificationSourceRows !== 'function') throw Error('staged_budget_supplement_api_incomplete');
  if (supplements && typeof catalog.verifyBudgetSpecificationCards !== 'function') throw Error('staged_budget_card_readiness_api_required');
  const fingerprints = async () => Object.fromEntries(await Promise.all(markets.map(async market =>
    [market, await pricing.budgetPricingFingerprint(market)])));
  const before = await fingerprints(), utcDay = new Date().toISOString().slice(0, 10);
  const policyDay = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  let warmed;
  if (mode === 'prepare' && markets.length) {
    await catalog.backfillBudgetMarketSelectors(markets);
    await catalog.backfillBudgetSpecificationSelectors(markets);
    warmed = await catalog.warmBudgetPriceCaches(markets);
    if (warmed.generationId !== context.manifest.generationId
        || JSON.stringify(warmed.results.map(row => row.market).sort()) !== JSON.stringify(markets.slice().sort())) {
      throw Error('staged_budget_warmup_incomplete');
    }
  }
  const selectorPrefix = `catalog/generations/${context.manifest.generationId}/indexes/${codec.specificationSelectorDirectory(context.encyclopediaDigest, context.calculationVersion)}/`;
  const directory = markets.length ? await storage.readJson(selectorPrefix + 'ready.json', null) : null;
  if (markets.length && (directory?.generationId !== context.manifest.generationId || directory?.encyclopediaDigest !== context.encyclopediaDigest)) {
    throw Error('staged_budget_selectors_not_ready');
  }
  // Independent saved reads: no search API, provider request or calculation fallback.
  pricing.resetSharedBudgetPriceCache();
  const report = {version:1, verified:true, published:false, release:context.release, calculationVersion:context.calculationVersion,
    generationId:context.manifest.generationId, manifestDigest:stagedBudgetDigest(context.manifest),
    encyclopediaDigest:context.encyclopediaDigest, utcDay, policyDay, markets:{}};
  for (const market of markets) {
    const index = await publication.readCompressedSelector(directory, market,
      name => storage.readJson(selectorPrefix + name + '.json', null));
    if (!index || index.version !== 3 || index.generationId !== context.manifest.generationId
        || index.sourceRows !== index.rows.length + (index.otherRows?.length || 0)) throw Error('staged_budget_selector_incomplete:' + market);
    const source = [...index.rows, ...(index.otherRows || [])];
    if (source.some(row => row[0] !== market) || new Set(source.map(row => row[5].id)).size !== source.length) throw Error('staged_budget_source_identity_invalid');
    const record = {fingerprint:before[market], sourceRows:source.length, sourceIds:stagedBudgetDigest(source.map(row => row[5].id)),
      selectorChecksum:stagedBudgetDigest(index)};
    const projection = await storage.readJson(`catalog/generations/${context.manifest.generationId}/indexes/projection/${market}.json`, null);
    record.coverage = verifyBudgetSourceCoverage({manifest:context.manifest, market, projection, source,
      prepareRows:supplements ? catalog.prepareBudgetSpecificationSourceRows : catalog.prepareCatalogProjectionRows});
    if (supplements) {
      const descriptor = await catalog.verifyBudgetSpecificationSource(context.manifest, market);
      assertBudgetSourceSupplement(descriptor, context, market, record);
      if (descriptor.sourceCardsSha256 !== stagedBudgetDigest(source.map(row => [row[5].id,row[5].block,row[5].cardPath ?? null]))
          || descriptor.pricingChunksSha256 !== stagedBudgetDigest(index.pricingChunks ?? null)) {
        throw Error('staged_budget_source_supplement_mapping_changed:' + market);
      }
      record.sourceSupplement = descriptor;
      const cards = await catalog.verifyBudgetSpecificationCards(context.manifest, market, index);
      const {checksum, ...body} = cards || {};
      if (cards?.version !== 1 || cards.verified !== true || cards.generationId !== context.manifest.generationId || cards.market !== market
          || cards.sourceRows !== source.length || cards.sourceIds !== record.sourceIds || !Array.isArray(cards.blocks) || !cards.blocks.length
          || cards.blocks.reduce((count, block) => count + block.coveredRows, 0) !== source.length || checksum !== stagedBudgetDigest(body)) {
        throw Error('staged_budget_card_readiness_invalid:' + market);
      }
      // Included in the existing report.markets / candidate receipt comparison:
      // same IDs with changed card content cannot pass the later verify phase.
      record.cardReadiness = cards;
    }
    for (const [kind, display] of [['budget', false], ['sort', true]]) {
      const prices = await pricing.readPreparedBudgetPrices(index, market, before[market], display);
      if (!prices) throw Error('staged_budget_price_snapshot_missing:' + market + ':' + kind);
      record[kind] = {rows:prices.length, checksum:stagedBudgetDigest(prices)};
      if (kind === 'budget' && warmed && warmed.results.find(row => row.market === market)?.rows !== prices.length) {
        throw Error('staged_budget_price_snapshot_incomplete:' + market);
      }
    }
    report.markets[market] = record;
  }
  // A future installed runtime may additionally require the prepared filter
  // selector. Exact 83ff has only the original budget+sort snapshot contract.
  if (typeof catalog.verifyPreparedBudgetPriceCaches === 'function' && markets.length) {
    report.preparedSelections = await catalog.verifyPreparedBudgetPriceCaches(markets);
    if (report.preparedSelections?.verified !== true || report.preparedSelections.generationId !== context.manifest.generationId
        || !Array.isArray(report.preparedSelections.results)
        || JSON.stringify(report.preparedSelections.results.map(row => row.market).sort()) !== JSON.stringify(markets.slice().sort())
        || report.preparedSelections.results.some(row => row.verified !== true || row.fingerprint !== before[row.market])) {
      throw Error('staged_budget_prepared_selection_incomplete');
    }
  }
  if (utcDay !== new Date().toISOString().slice(0, 10) || policyDay !== new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
      || stagedBudgetDigest(before) !== stagedBudgetDigest(await fingerprints())
      || (encyclopedia.readCalculationIndex()?.digest || null) !== context.encyclopediaDigest
      || pricing.calculationCacheVersion() !== context.calculationVersion) {
    throw Error('staged_budget_prepared_context_changed');
  }
  assertBudgetReadinessReport(report, context);
  await fs.writeFile(reportPath, JSON.stringify(report));
  console.log(JSON.stringify({stage:'staged_budget_' + mode, generationId:report.generationId,
    release:context.release, markets:PREPARED_MARKETS.filter(market => report.markets[market]), verified:true}));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, contextPath, reportPath] = process.argv.slice(2);
  fs.readFile(contextPath, 'utf8').then(value =>
    runStagedBudgetChild({mode, root:path.resolve(root), context:JSON.parse(value), reportPath}))
    .catch(error => { console.error(error?.message || 'staged_budget_child_failed'); process.exitCode = 1; });
}
