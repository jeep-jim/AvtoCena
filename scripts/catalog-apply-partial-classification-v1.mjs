import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LEDGER = process.env.CATALOG_SOURCE_QUALIFICATION_REGISTRY || 'data/catalog/source-qualification-v1.json';
const DECISIONS = process.env.CATALOG_SOURCE_PARTIAL_CLASSIFICATION || 'data/catalog/source-partial-classification-v1.json';

export function applyDecisions(ledger, decisionFile) {
  if (ledger.productionWrites !== false) throw new Error('ledger productionWrites must remain false');
  if (decisionFile.productionWrites !== false || decisionFile.publishAllowedMutations !== false) {
    throw new Error('decisions must remain no-write and non-publishing');
  }
  const decisions = decisionFile.decisions;
  if (!Array.isArray(decisions) || !decisions.length) throw new Error('decisions must be nonempty');
  const byId = new Map();
  for (const decision of decisions) {
    if (!decision.sourceId || byId.has(decision.sourceId)) throw new Error('missing or duplicate decision source');
    if (!ledger.allowedClasses?.includes(decision.class)) throw new Error(`invalid class: ${decision.class}`);
    if (decision.publishAllowed !== false) throw new Error(`${decision.sourceId}: publishAllowed must remain false`);
    byId.set(decision.sourceId, decision);
  }
  const pausedMarkets = new Set([...(ledger.pausedMarkets || []), ...(decisionFile.pausedMarkets || [])]);
  const seen = new Set();
  const next = structuredClone(ledger);
  next.candidates = next.candidates.map((row) => {
    const decision = byId.get(row.sourceId);
    if (!decision) return row;
    seen.add(row.sourceId);
    if (decision.market !== row.market) throw new Error(`${row.sourceId}: decision market mismatch`);
    if (pausedMarkets.has(row.market)) {
      if (decision.class !== row.class || row.publishAllowed !== false) throw new Error(`${row.sourceId}: paused market decision changed`);
      return row;
    }
    const updated = {
      ...row,
      ...structuredClone(decision),
      publishAllowed: false,
      qualificationDecision: `data/catalog/source-partial-classification-v1.json#${row.sourceId}`,
    };
    for (const key of ['exactScope', 'useScope', 'blockersBeforePublication']) {
      if (decision[key] != null) updated[key] = decision[key];
    }
    return updated;
  });
  for (const id of byId.keys()) if (!seen.has(id)) throw new Error(`decision source missing from ledger: ${id}`);
  next.updatedAt = [ledger.updatedAt, decisionFile.updatedAt, decisionFile.decidedAt].filter(Boolean).sort().at(-1);
  return next;
}

export async function run() {
  const [ledger, decisions] = await Promise.all([
    fs.readFile(LEDGER, 'utf8').then(JSON.parse),
    fs.readFile(DECISIONS, 'utf8').then(JSON.parse),
  ]);
  const next = applyDecisions(ledger, decisions);
  await fs.writeFile(LEDGER, `${JSON.stringify(next, null, 2)}\n`);
  console.log(JSON.stringify({
    ledger: LEDGER,
    decisions: (decisions.decisions || []).map((row) => ({ sourceId: row.sourceId, class: row.class, publishAllowed: row.publishAllowed })),
  }, null, 2));
  return next;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
