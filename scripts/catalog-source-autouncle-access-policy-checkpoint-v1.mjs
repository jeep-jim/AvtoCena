import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'autouncle_europe_candidate';

const DECISION = {
  market: 'europe',
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  useScope: 'manual public reference only; no public-site scraping or data collection without permission; requalify only through an AutoUncle-authorized API/enterprise agreement or written permission covering the AvtoCena use case',
  evidence: {
    officialTermsUrl: 'https://www.autouncle.com/en-GB/terms-of-service',
    termsUpdated: '27 November 2024',
    userConduct: 'Section 4 states that users agree not to scrape or collect data without permission.',
    officialApiUrl: 'https://b2b.autouncle.com/en-gb/automotive-api',
    officialApiMeaning: 'AutoUncle advertises an authenticated B2B automotive API for enterprise integrations, using an API key and returning market valuation plus live-comparable signals.',
    probeBoundary: 'source-permission-first stop: no AutoUncle public inventory list/detail automated probe was started after reading the official terms',
  },
  blockerBeforeAutomatedUse: 'obtain an AutoUncle API/enterprise agreement or written permission whose scope explicitly permits AvtoCena automated use, required fields, retention and any republication; then perform exact technical qualification only through that authorized route',
};

const MARKER = '## 40.35 — AutoUncle Europe: public scraping requires permission; official B2B API is the candidate path';
const APPEND = `\n\n${MARKER}\n\nДата: 2026-09-04.\n\nВетка: \`chore/autouncle-access-policy-v1-20260904\`.\n\n- Source-permission-first проверка выполнена до нового public inventory crawl.\n- Official AutoUncle Terms of Service, last updated 27 November 2024, section 4: users agree not to scrape or collect data without permission.\n- Поэтому \`autouncle_europe_candidate -> lead_only\`, \`publishAllowed=false\`; public-site list/detail crawler не запускать без разрешения.\n- Положительный путь найден: AutoUncle официально предлагает B2B Automotive API для enterprise integrations с API key, market valuation, deal rating, sales-time forecast и live comparables. Это кандидат на разрешённую интеграцию, но не public-site permission.\n- Exact technical qualification AutoUncle возобновлять только через API/enterprise agreement либо письменное разрешение, которое явно покрывает AvtoCena use case, нужные поля, retention и republication.\n- После terms check public inventory requests не запускались; production/Object Storage/catalog writes отсутствуют.\n- Japan остаётся на паузе по указанию владельца; Japan branches не возобновлять и не вливать.\n\n### Следующее действие после 40.35\n\nПродолжить следующий non-Japan \`research_pending\` source: official access/reuse conditions first; если permission path не закрыт — bounded no-write technical qualification.\n`;

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
  evidence: 'Official AutoUncle Terms of Service section 4 prohibits scraping or collecting data without permission; AutoUncle separately offers an official B2B automotive API for authorized enterprise integrations.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#autouncle_europe_candidate',
  useScope: DECISION.useScope,
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification source-permission-first; Japan remains paused; AutoUncle public scraping is blocked without permission and its official B2B API is the only current requalification path';

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
  officialB2bApiPath: true,
  automatedPublicProbeStarted: false,
  japanPaused: true,
  productionWrites: false,
}, null, 2));
