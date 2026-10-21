import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'lacentrale_europe_candidate';

const DECISION = {
  market: 'europe',
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  useScope: 'manual public reference only; do not automate extraction/reuse or republish La Centrale public database contents without prior written authorization or an official permitted data/API/partner feed',
  evidence: {
    officialTermsUrl: 'https://www.lacentrale.fr/informations/mentions-legales',
    article: 'Article 5 - Propriété Intellectuelle',
    personalUse: 'La Centrale states that use of the site grants no rights in site/content and only strictly personal use is authorized.',
    reproductionRestriction: 'Reproduction, representation or diffusion of site/content is prohibited without prior written and express authorization.',
    databaseRestriction: 'Extraction/reuse of all or a substantial part of protected database data is subject to prior written approval.',
    pureConsultation: 'Database data is made available to the public only for pure consultation; extraction/reuse beyond what is exclusively and strictly necessary for pure consultation without prior written approval exceeds normal-use conditions.',
    probeBoundary: 'source-permission-first stop: no La Centrale inventory list/detail/API automated probe was started after reading the official terms',
  },
  blockerBeforeAutomatedUse: 'obtain prior written authorization from Groupe La Centrale or an official data/API/partner feed explicitly permitting AvtoCena automated commercial use, retention and republication; then requalify technically only through that permitted route',
};

const MARKER = '## 40.34 — La Centrale Europe: public database is consultation-only; automated reuse blocked';
const APPEND = `\n\n${MARKER}\n\nДата: 2026-09-04.\n\nВетка: \`chore/lacentrale-access-policy-v1-20260904\`.\n\n- Следующий non-Japan candidate проверен source-permission-first до нового technical crawl.\n- Official La Centrale CGU, Article 5: site/content разрешены только для strictly personal use; reproduction/representation/diffusion требуют prior written and express authorization.\n- Database data предоставляются публике только для pure consultation. Extraction/reuse, выходящие за то, что исключительно и строго необходимо для pure consultation, без prior written approval выходят за normal-use conditions.\n- Поэтому \`lacentrale_europe_candidate -> lead_only\`, \`publishAllowed=false\`. Public list/detail/API crawler qualification не запускать, AvtoCena catalog не строить/обновлять из публичной La Centrale database.\n- Повторно открывать exact technical qualification только после письменного разрешения Groupe La Centrale либо official data/API/partner feed, который явно покрывает automated commercial use, retention и republication.\n- После permission check автоматические inventory requests к La Centrale не запускались; production/Object Storage/catalog writes отсутствуют.\n- Japan остаётся на паузе по указанию владельца; Japan branches не возобновлять и не вливать.\n\n### Следующее действие после 40.34\n\nПродолжить следующий non-Japan \`research_pending\` source в том же порядке: сначала official access/reuse conditions; только если они не блокируют автоматизацию — bounded no-write technical field qualification.\n`;

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
  evidence: 'Official La Centrale CGU Article 5 says site/database data is for strictly personal/pure consultation use; extraction/reuse and reproduction beyond that require prior written authorization.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#lacentrale_europe_candidate',
  useScope: DECISION.useScope,
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification source-permission-first; Japan remains paused; do not automate La Centrale without prior written authorization or an explicitly permitted data route';

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.updatedAt = '2026-09-04';
if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
const index = ledger.decisions.findIndex((candidate) => candidate.sourceId === SOURCE_ID);
if (index >= 0) ledger.decisions[index] = DECISION;
else ledger.decisions.push(DECISION);
assertSafety(registry, ledger);

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) roadmap = `${roadmap.replace(/\s*$/, '')}${APPEND}\n`;
else roadmap = `${roadmap.replace(/\s*$/, '')}\n`;

await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
await fs.writeFile(ROADMAP_PATH, roadmap);

console.log(JSON.stringify({
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  automatedInventoryProbeStarted: false,
  japanPaused: true,
  productionWrites: false,
}, null, 2));
