import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'bobaedream_korea_candidate';
const MARKER = '## 40.37 — Bobaedream Korea: commercial reuse requires prior consent';

const decision = {
  market: 'korea',
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  useScope: 'manual public reference only; no automated commercial ingestion/republication from the public site without prior Bobaedream consent or an explicitly permitted API/partner feed',
  evidence: {
    officialTermsUrl: 'https://www.bobaedream.co.kr/company/service.php',
    termsArticle11: 'official terms state that users may not conduct commercial activity using the service without prior company approval and may not copy, reproduce, modify, translate, publish, broadcast, otherwise use, or provide to others information obtained through the service without prior approval',
    fieldStatusBeforePolicyCheck: 'previous read-only field audit proved identity, make/model/year, listing price KRW, fuel, exact engineCc and powerHp on sampled details; canonical body type and listing-bound gallery>=5 were still unproven',
  },
  blockerBeforeAutomatedUse: 'obtain prior written consent or an explicitly permitted API/partner feed covering AvtoCena automated commercial ingestion/republication; then requalify body/gallery/list-detail parity on that permitted route',
};

const roadmapAppend = `\n\n${MARKER}\n\nДата: 2026-09-04.\n\n- После закрепления machine-readable паузы Japan продолжена только non-Japan qualification.\n- Следующий приоритетный кандидат — Bobaedream Korea, потому что предыдущий read-only field audit уже доказал identity, make/model/year, KRW price, fuel, exact engineCc и powerHp; оставались body и listing-bound gallery.\n- До нового crawl проверены официальные Terms of Service Bobaedream: Article 11 запрещает без предварительного согласия компании использовать service для коммерческой деятельности и отдельно запрещает без предварительного согласия копировать/воспроизводить/изменять/переводить/публиковать/иным способом использовать или передавать третьим лицам информацию, полученную через service.\n- Поэтому дальнейший автоматический detail/gallery crawl из public route остановлен до появления явно разрешённого канала данных.\n- Решение: \`bobaedream_korea_candidate -> lead_only\`, \`publishAllowed=false\`.\n- Requalification возможна только после письменного разрешения либо official API/partner feed, который явно покрывает automated commercial ingestion/republication; после этого отдельно доказать canonical body, gallery>=5 и list/detail parity.\n- Japan остаётся на паузе; все Japan candidates имеют \`qualificationPaused=true\`.\n- Safety: production catalog, Object Storage, generation, manifest и cleanup не менялись.\n`;

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const row = registry.candidates.find((candidate) => candidate.sourceId === SOURCE_ID);
if (!row) throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row, {
  class: 'lead_only',
  publishAllowed: false,
  evidence: 'Official Bobaedream Terms Article 11 requires prior company consent for commercial activity using the service and for copying/using/providing information obtained through the service; public automated commercial ingestion is therefore blocked.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#bobaedream_korea_candidate',
  useScope: decision.useScope,
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification permission-first/no-write; Japan remains paused; do not automate Bobaedream without prior consent or an explicitly permitted data route';
if (registry.productionWrites !== false || registry.candidates.some((candidate) => candidate.publishAllowed === true)) throw new Error('registry safety changed');
await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.updatedAt = '2026-09-04';
if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
const index = ledger.decisions.findIndex((candidate) => candidate.sourceId === SOURCE_ID);
if (index >= 0) ledger.decisions[index] = decision; else ledger.decisions.push(decision);
if (ledger.productionWrites !== false || ledger.publishAllowedMutations !== false) throw new Error('ledger safety changed');
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) roadmap = `${roadmap.replace(/\s*$/, '')}${roadmapAppend}\n`;
await fs.writeFile(ROADMAP_PATH, roadmap);

console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'lead_only', publishAllowed: false, japanPaused: true, productionWrites: false }, null, 2));
