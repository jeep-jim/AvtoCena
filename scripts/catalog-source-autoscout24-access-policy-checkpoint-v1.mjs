import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'autoscout_europe_open';

const DECISION = {
  market: 'europe',
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  useScope: 'manual public reference/link-out only; no automated inventory ingestion, database building, commercial data exploitation or republication without an explicitly permitted AutoScout24 API/feed/agreement or written authorization',
  evidence: {
    consumerGtcUrl: 'https://www.autoscout24.com/company/agb/',
    consumerGtcEffective: '01.04.2024',
    consumerGtcSection82: 'AutoScout24 states that automated queries using scripts, bypassing the search mask using search software or similar measures are not permitted.',
    consumerGtcSection83: 'AutoScout24 states that queried data may not be used to build a separate database, for commercial data exploitation/provision, or linked/integrated with other databases/meta-databases.',
    dealerGtcUrl: 'https://www.autoscout24.com/company/agb-b2b/',
    dealerGtcEffective: '01.04.2025',
    dealerGtc: 'AutoScout24 company terms prohibit automated querying of the database by software and copying database contents to other websites/media unless it is the dealer own content.',
    probeBoundary: 'source-permission-first stop: no AutoScout24 list/detail/API automated inventory probe was started after reading the official terms',
  },
  blockerBeforeAutomatedUse: 'obtain an official API/data feed, partner/dealer agreement or written AutoScout24 authorization explicitly permitting automated querying plus AvtoCena commercial database use/republication; then requalify technically from that permitted route',
};

const MARKER = '## 40.32 — AutoScout24 Europe: official terms block automated query and commercial database reuse';
const APPEND = `\n\n${MARKER}\n\nДата: 2026-09-04.\n\nВетка: \`chore/autoscout24-access-field-audit-v1-20260904\`.\n\n- Следующий non-Japan candidate после WorldAuto проверен **сначала по source permission**, до технического crawl.\n- Consumer GTC AutoScout24 (effective 01.04.2024), section 8.2: automated queries via scripts/search software or similar bypass of the provided online search masks are not permitted.\n- Section 8.3: queried data may not be used to build a separate database, for commercial data exploitation/provision, or linked/integrated with other databases/meta-databases.\n- Dealer/company GTC (effective 01.04.2025) likewise prohibits automated database querying by software and copying database contents to other websites/media unless it is the dealer's own content.\n- Поэтому ранее полученные formal/exact-looking baseline rows не дают права строить automated adapter: \`autoscout_europe_open -> lead_only\`, \`publishAllowed=false\`.\n- Scope сейчас: только manual public reference/link-out. Повторная qualification возможна только через официальный API/feed/agreement или письменное разрешение, которое явно покрывает automated query + commercial database reuse/republication.\n- После проверки условий **не запускались** AutoScout24 list/detail/API crawler probes; обходов ограничений не делалось. Production/Object Storage/catalog writes отсутствуют.\n- Japan остаётся на паузе по указанию владельца; Japan branches не возобновлять и не вливать.\n\n### Следующее действие после 40.32\n\nПродолжить следующий non-Japan \`research_pending\` source в том же порядке: сначала официальные access/reuse terms; только если они не блокируют автоматизацию — bounded no-write technical field qualification.\n`;

function assertSafety(registry, ledger) {
  if (registry.productionWrites !== false) throw new Error('registry productionWrites changed');
  if (ledger.productionWrites !== false || ledger.publishAllowedMutations !== false) throw new Error('ledger safety changed');
  if ((registry.candidates || []).some((row) => row.publishAllowed === true)) throw new Error('unexpected publishAllowed=true');
}

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const row = registry.candidates?.find((candidate) => candidate.sourceId === SOURCE_ID);
if (!row) throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row, {
  class: 'lead_only',
  publishAllowed: false,
  evidence: 'Official AutoScout24 Consumer GTC sections 8.2/8.3 prohibit automated queries and building/commercially exploiting or integrating queried data as another database; Dealer GTC also prohibits automated database querying and republication of other dealers content.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#autoscout_europe_open',
  useScope: DECISION.useScope,
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification source-permission-first; Japan remains paused; do not automate AutoScout24 without an explicitly permitted route';

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.updatedAt = '2026-09-04';
if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
const i = ledger.decisions.findIndex((candidate) => candidate.sourceId === SOURCE_ID);
if (i >= 0) ledger.decisions[i] = DECISION;
else ledger.decisions.push(DECISION);
assertSafety(registry, ledger);

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) roadmap = `${roadmap.replace(/\s*$/, '')}${APPEND}\n`;
else roadmap = `${roadmap.replace(/\s*$/, '')}\n`;

await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
await fs.writeFile(ROADMAP_PATH, roadmap);

console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'lead_only', publishAllowed: false, autoScoutAutomatedProbeStarted: false, japanPaused: true, productionWrites: false }, null, 2));
