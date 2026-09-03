import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LEDGER = process.env.CATALOG_SOURCE_QUALIFICATION_REGISTRY || 'data/catalog/source-qualification-v1.json';
const DECISIONS = process.env.CATALOG_SOURCE_PARTIAL_CLASSIFICATION || 'data/catalog/source-partial-classification-v1.json';

export function applyDecisions(ledger, decisionFile) {
  if (ledger.productionWrites !== false) throw new Error('ledger productionWrites must remain false');
  const byId = new Map((decisionFile.decisions || []).map((row) => [row.sourceId, row]));
  if (byId.size !== 4) throw new Error(`expected 4 decisions, got ${byId.size}`);
  const seen = new Set();
  const next = structuredClone(ledger);
  next.candidates = next.candidates.map((row) => {
    const decision = byId.get(row.sourceId);
    if (!decision) return row;
    seen.add(row.sourceId);
    if (decision.publishAllowed !== false) throw new Error(`${row.sourceId}: publishAllowed must remain false`);
    const updated = {
      ...row,
      class: decision.class,
      publishAllowed: false,
      evidence: typeof decision.evidence === 'string'
        ? decision.evidence
        : `manual qualification after runs ${(decisionFile.evidenceRuns || []).join(', ')}; see data/catalog/source-partial-classification-v1.json`,
      qualificationDecision: `data/catalog/source-partial-classification-v1.json#${row.sourceId}`,
    };
    for (const key of ['exactScope', 'useScope', 'blockersBeforePublication']) {
      if (decision[key] != null) updated[key] = decision[key];
    }
    return updated;
  });
  for (const id of byId.keys()) if (!seen.has(id)) throw new Error(`decision source missing from ledger: ${id}`);
  next.updatedAt = '2026-09-03';
  next.next = 'build and no-write test a dedicated adapter for chngoodcar_china_candidate; continue source qualification on the remaining research_pending candidates; no publishAllowed=true until explicit publication gate';
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
