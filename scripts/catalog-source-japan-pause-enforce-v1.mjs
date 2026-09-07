import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const MARKET = 'japan';
const MARKER = '## 40.37 — Japan qualification pause is machine-readable and must be honored by every new source probe';

const control = {
  status: 'paused_by_owner',
  since: '2026-09-04',
  automatedQualificationAllowed: false,
  productionPublicationAllowedByThisResearchTrack: false,
  resumeCondition: 'only after an owner-approved candidate proves completed/played auction lots under the exact data contract, followed by explicit owner instruction to resume Japan qualification',
  note: 'Fixed-price/export-stock candidates do not satisfy the completed-auction-lot requirement.',
};

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
registry.pausedMarkets = [...new Set([...(registry.pausedMarkets || []), MARKET])];
registry.marketControls = { ...(registry.marketControls || {}), [MARKET]: control };
for (const candidate of registry.candidates || []) {
  if (candidate.market !== MARKET) continue;
  candidate.qualificationPaused = true;
  candidate.qualificationPauseReason = 'owner_direction_2026-09-04_completed_auction_source_not_yet_proven';
}
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification source-permission-first; Japan is machine-paused and must be skipped by new qualification probes until the owner explicitly resumes it after a completed/played-auction exact-contract candidate is proven';

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.pausedMarkets = [...new Set([...(ledger.pausedMarkets || []), MARKET])];
ledger.marketControls = { ...(ledger.marketControls || {}), [MARKET]: control };
ledger.updatedAt = '2026-09-04';

if (registry.productionWrites !== false) throw new Error('registry productionWrites changed');
if (ledger.productionWrites !== false || ledger.publishAllowedMutations !== false) throw new Error('ledger safety changed');
if ((registry.candidates || []).some((row) => row.publishAllowed === true)) throw new Error('unexpected publishAllowed=true');
if ((registry.candidates || []).filter((row) => row.market === MARKET).some((row) => row.qualificationPaused !== true)) throw new Error('Japan candidate without qualificationPaused=true');

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) {
  roadmap = `${roadmap.replace(/\s*$/, '')}\n\n${MARKER}\n\nДата: 2026-09-04.\n\nЧтобы пауза Японии больше не зависела только от текста/контекста чата, она закреплена в qualification registry и decision ledger:\n\n- \`pausedMarkets\` содержит \`japan\`;\n- \`marketControls.japan.status = paused_by_owner\`;\n- \`automatedQualificationAllowed=false\`;\n- каждая Japan candidate row помечена \`qualificationPaused=true\`;\n- новые source-qualification probes обязаны исключать рынки из \`pausedMarkets\`;\n- resume condition: сначала найден и доказан кандидат с **completed/played auction lots** под exact contract, затем отдельное явное указание владельца возобновить Japan qualification;\n- fixed-price/export-stock источники не считаются выполнением этого условия.\n\nЭто не меняет production catalog и не запускает/останавливает production parser само по себе; это guard именно текущего research/qualification трека.\n\n### Следующее действие после 40.37\n\nПродолжать только non-Japan source qualification.\n`;
} else {
  roadmap = `${roadmap.replace(/\s*$/, '')}\n`;
}

await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
await fs.writeFile(ROADMAP_PATH, roadmap);

console.log(JSON.stringify({
  pausedMarkets: registry.pausedMarkets,
  japanControl: registry.marketControls?.japan,
  japanCandidateCount: (registry.candidates || []).filter((row) => row.market === MARKET).length,
  productionWrites: false,
}, null, 2));
