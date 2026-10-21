import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { readKnowledgeCoreIndex } from '../apps/web/lib/catalog/knowledge-core.ts';
import { readEncyclopediaIdentityResolver } from '../apps/web/lib/catalog/encyclopedia-identity-data.ts';

// Offline work queue from actual bounded source checks. No guessed variants,
// network requests, catalog writes or change to any publication gate.
const summaryPath = 'data/catalog/research/five-market-restart-outcome-v1-20260907.json';
const summaryBytes = await fs.readFile(summaryPath);
const summary = JSON.parse(summaryBytes);
const index = await readKnowledgeCoreIndex();
const resolver = await readEncyclopediaIdentityResolver();
if (!index || !resolver) throw new Error('knowledge_index_unavailable');
const statusCounts = {};
const verifiedByMarket = {};
for (const variants of index.variantsByModel.values()) for (const variant of variants) {
  const key = `${variant.coreSource}:${variant.status}`;
  statusCounts[key] = (statusCounts[key] || 0) + 1;
  if (variant.status === 'verified') verifiedByMarket[variant.market || 'unspecified'] = (verifiedByMarket[variant.market || 'unspecified'] || 0) + 1;
}
const queue = [];
const sourceChecks = [];
for (const source of summary.sources.filter(row => !row.sourceId.startsWith('porsche_finder_'))) {
  const report = JSON.parse(await fs.readFile(source.reportPath, 'utf8'));
  const market = report.markets.find(row => row.sourceId === source.sourceId);
  const samples = new Map((market.samples || []).map(row => [row.sourceOfferId, row]));
  for (const detail of market.details || []) {
    if (detail.totalRub > 0 && !detail.error) continue;
    const sample = samples.get(detail.sourceOfferId) || {};
    const captured = detail.knowledgeEnrichment;
    const resolved = captured?.modelId || resolver.resolve(sample).modelId;
    const variants = resolved ? index.variantsByModel.get(resolved) || [] : [];
    const fields = Object.fromEntries(Object.entries(detail.fields || {}).filter(([, value]) => ['missing', 'ambiguous', 'conflict'].includes(value.state)));
    queue.push({ market: market.market, sourceId: source.sourceId, sourceOfferId: detail.sourceOfferId,
      sourceUrl: detail.sourceUrl || null, reportPath: source.reportPath,
      yearAllowed: detail.yearAllowed === true, make: sample.make || null, model: sample.model || null,
      modelId: resolved || null, modelIdentityOrigin: captured?.modelId ? 'captured_calculation_preparation' : resolved ? 'offline_exact_name_lookup' : 'unresolved',
      calculationInput: detail.calculationInput || detail.after || detail.before,
      error: detail.error || null, missingFields: fields,
      referenceVariants: variants.length, verifiedVariants: variants.filter(row => row.status === 'verified').length,
      exactVariantLinked: Boolean(captured?.variantId),
      sourceVariantCodes: captured?.modelIdentity?.sourceVariantCodes || null,
      nextEvidence: !resolved ? 'Resolve the exact source model boundary before looking up specifications.'
        : !variants.some(row => row.status === 'verified') ? 'Add officially evidenced applicable variants and bind the exact listing/source grade to one variant.'
        : 'Bind this listing to an applicable verified variant, or obtain exact missing fields from this listing; a sole candidate is not proof.' });
  }
  sourceChecks.push({ sourceId: source.sourceId, examined: market.details?.length || 0,
    unresolvedCalculations: queue.filter(row => row.sourceId === source.sourceId).length,
    error: market.error || null, upstreamBridgeTrafficObserved: false });
}
const output = { version: 1, advisoryOnly: true, productionWrites: false,
  input: { path: summaryPath, sha256: crypto.createHash('sha256').update(summaryBytes).digest('hex') },
  statusCounts, verifiedByMarket, sourceChecks,
  totals: { unresolvedCalculations: queue.length, inYearWindow: queue.filter(row => row.yearAllowed).length,
    resolvedModels: queue.filter(row => row.modelId).length,
    resolvedModelsWithNoVerifiedVariants: queue.filter(row => row.modelId && !row.verifiedVariants).length },
  limitations: ['Counts describe the checked source-order samples, not market-wide coverage.',
    'Verified status alone does not prove field-level completeness, specification-market applicability or a listing-to-variant link.',
    'No inference of peak or regulatory 30-minute power; unprocessed rows after a network stop are not complete specification checks.',
    'The deployed bridge can be older than collector code; its derived engine scalar is not original field provenance.'],
  queue: queue.sort((a, b) => Number(b.yearAllowed) - Number(a.yearAllowed) || a.sourceId.localeCompare(b.sourceId) || a.sourceOfferId.localeCompare(b.sourceOfferId)) };
await fs.writeFile('data/catalog/research/restart-knowledge-link-gaps-v1-20260907.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ statusCounts, verifiedByMarket, totals: output.totals }, null, 2));
