import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'yallamotor_uae_candidate';

const DECISION = {
  market: 'uae',
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  useScope: 'manual public reference only; no automated public-site collection/republication; YallaMotor terms also limit hyperlink permission to non-commercial use unless separately authorized',
  evidence: {
    officialTermsUrl: 'https://www.yallamotor.com/terms-of-service',
    accessClause: 'Clause 7 - Access and Linking to the platform',
    automationRestriction: 'YallaMotor states that users may not use any robot, spider, scraper or other automated means to access the platform and collect content for any purpose or otherwise copy/download content.',
    exceptionBoundary: 'The limited exception is for search engines and non-commercial public archives, not websites that include classified listings.',
    contentRestriction: 'The terms prohibit copying, distributing, reproducing, selling, leasing, assigning, renting or sublicensing platform/content.',
    probeBoundary: 'source-permission-first stop: no YallaMotor public inventory list/detail/API automated probe was started after reading the official terms',
  },
  blockerBeforeAutomatedUse: 'obtain an official YallaMotor API/feed/partner agreement or written authorization explicitly permitting AvtoCena automated collection, retention and republication, then requalify technically only through that permitted route',
};

const MARKER = '## 40.36 — YallaMotor UAE: public automated collection expressly prohibited';
const APPEND = `\n\n${MARKER}\n\nДата: 2026-09-04.\n\nВетка: \`chore/yallamotor-access-policy-v1-20260904\`.\n\n- Source-permission-first проверка выполнена до нового technical crawl.\n- Official YallaMotor Terms of Service, clause 7: запрещены robot/spider/scraper/other automated means для доступа к YallaMotor и collection content **for any purpose**, а также copy/download content. Ограниченное исключение дано search engines и non-commercial public archives, но не сайтам с classified listings.\n- Terms также запрещают copy/distribute/reproduce/sell/lease/assign/rent/sublicense platform/content; hyperlink permission описана только для non-commercial use.\n- Поэтому \`yallamotor_uae_candidate -> lead_only\`, \`publishAllowed=false\`; public list/detail/API crawler не запускать и listing content не переиспользовать в коммерческом AvtoCena catalog по текущему public route.\n- Возобновлять exact technical qualification только после official API/feed/partner agreement либо written authorization, которое явно покрывает automated collection, retention и republication.\n- После terms check YallaMotor inventory requests не запускались; production/Object Storage/catalog writes отсутствуют.\n- Japan остаётся на паузе по указанию владельца.\n\n### Следующее действие после 40.36\n\nПродолжить следующий non-Japan \`research_pending\` source с official access/reuse check до технических запросов.\n`;

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
  evidence: 'Official YallaMotor Terms clause 7 expressly prohibits robot/spider/scraper/other automated access and content collection for any purpose; limited exceptions do not cover classified-listing websites.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#yallamotor_uae_candidate',
  useScope: DECISION.useScope,
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification source-permission-first; Japan remains paused; do not automate YallaMotor without an explicitly permitted API/feed/agreement';

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
  automatedPublicProbeStarted: false,
  japanPaused: true,
  productionWrites: false,
}, null, 2));
