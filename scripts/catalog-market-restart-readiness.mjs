import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Advisory report only. No imports from storage, adapters or workflow launchers.
const registryPath = 'data/catalog/source-qualification-v1.json';
const auditPath = 'data/catalog/research/china-saved-recovery-v1-20260906.json';
const ciPath = 'data/catalog/research/non-japan-recovery-batch-v1-20260906.json';
const inputs = [];
async function read(path) {
  const body = await fs.readFile(path);
  inputs.push({ path, sha256: crypto.createHash('sha256').update(body).digest('hex') });
  return JSON.parse(body);
}
const registry = await read(registryPath);
const audit = await read(auditPath);
const batch = await read(ciPath);
const pilot = await read('data/catalog/research/public-listing-pilot-v1-20260906.json');
const specPilot = await read('data/catalog/research/public-listing-spec-pilot-v1-20260906.json');
const probes = new Map([...pilot.markets, ...specPilot.markets].map(row => [row.market, row]));
const completePass = await read('data/catalog/research/non-japan-complete-pass-v1-20260906.json');
const detailProbes = new Map(completePass.markets.map(row => [row.market, row]));
const markets = ['europe', 'korea', 'china', 'uae', 'georgia'];
const report = {
  version: 1, advisoryOnly: true, productionWrites: false, workflowDispatches: 0,
  inputs, auditCheckedAt: audit.checkedAt,
  codeValidation: batch.validation.finalCi,
  limitation: 'Saved recovery is not a fresh pilot. Unverified gates remain blocked; this report grants no permissions and changes no market controls.',
  markets: markets.map(market => {
    const saved = audit.recovery[market];
    const sources = registry.candidates.filter(source => source.market === market);
    return {
      market,
      publicProbe: probes.get(market) || null,
      detailProbe: detailProbes.get(market) || null,
      savedInput: saved.matchedSavedRows,
      savedAutomatic: saved.automaticAccepted,
      savedRecoveryShare: saved.matchedSavedRows ? saved.automaticAccepted / saved.matchedSavedRows : null,
      // This is a registry qualification count, not evidence of working credentials.
      publicationQualifiedSources: sources.filter(source => source.class === 'exact_catalog' && source.publishAllowed === true).map(source => source.sourceId),
      sourceDecisions: sources.map(source => ({ sourceId: source.sourceId, class: source.class, publishAllowed: source.publishAllowed })),
      controlledPilot: { status: detailProbes.has(market) ? 'measured_without_publication' : 'not_ready', remaining: [
        'Use latest detailProbe: successful requests do not prove complete specifications; Encar currently returns an access-block page.',
        'Keep the measured adapter and source identifiers fixed for the next isolated collection.',
        'Close the measured missing fields and business-settings differences before approving publication; preserve the production pause.',
      ] },
      catalogPublication: { status: 'not_ready', remaining: [
        'Complete permitted pilot and measure exact source-bound specifications, freshness and rejection reasons.',
        'Verify independent calculation examples and browser list/detail/selection behavior.',
        'Measure >=80% automatic calculations on the accepted deduplicated inventory, excluding customer scenarios.',
        'Confirm production deployment and explicit publication decision after the pilot; retain rollback generation.',
      ] },
      specificationBlockers: saved.blockers,
    };
  }),
  japan: { status: 'excluded_by_owner', includedInPilot: false },
};
await fs.writeFile('data/catalog/research/market-restart-readiness-v1-20260906.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.markets.map(({ market, savedInput, savedAutomatic, publicationQualifiedSources }) => ({ market, savedInput, savedAutomatic, publicationQualifiedSources })), null, 2));
