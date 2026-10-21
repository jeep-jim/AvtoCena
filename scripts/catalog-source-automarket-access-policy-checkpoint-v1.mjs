import fs from 'node:fs';

const registryPath='data/catalog/source-qualification-v1.json';
const ledgerPath='data/catalog/source-partial-classification-v1.json';
const roadmapPath='roadmap.md';
const sourceId='automarket_uae_candidate';
const runId=33937794266;

const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
let roadmap=fs.readFileSync(roadmapPath,'utf8').replace(/\s*$/,'');

const row=registry.candidates.find(x=>x.sourceId===sourceId);
if(!row) throw new Error('AutoMarket candidate missing');
Object.assign(row,{
  class:'research_pending',
  publishAllowed:false,
  evidence:'Permission-first run 33937794266: robots.txt and the public AutoMarket UAE home page both returned HTTP 200; the bounded home HTML exposed no source-declared Terms/Privacy/Legal/Policy link. No positive automated commercial ingestion/reuse permission is proven, so inventory/detail/API crawling remains blocked.',
  qualificationDecision:'data/catalog/source-partial-classification-v1.json#automarket_uae_candidate',
  useScope:'manual public reference only while automated commercial access/reuse permission remains unproven; do not crawl listing/detail/API routes until AutoMarket supplies an explicitly permitted API/feed/partner agreement or written authorization',
  qualificationBlocker:'automation_and_commercial_reuse_permission_unproven_no_source_declared_legal_link_on_home'
});
registry.updatedAt='2026-09-05';
registry.next='continue non-Japan research_pending qualification permission-first/no-write; Japan remains paused; next inspect Dubizzle UAE access policy and exact-field contract before any new crawl; do not automate AutoMarket public inventory while commercial automation/reuse permission is unproven';

const decision={
  market:'uae',sourceId,class:'research_pending',publishAllowed:false,
  useScope:'manual public reference only while automated commercial access/reuse permission remains unproven; no listing/detail/API crawl until an explicitly permitted AutoMarket API/feed/partner agreement or written authorization exists',
  evidence:{
    runId,
    robots:'HTTP 200 at https://www.automarket.ae/robots.txt',
    home:'HTTP 200 at https://www.automarket.ae/; captured bounded HTML only',
    sourceDeclaredLegalLinks:0,
    permissionConclusion:'no_source_declared_legal_link_detected_on_home_permission_unproven',
    probeBoundary:'exactly two HTTP requests: robots.txt + home; no listing/detail/pagination/API requests; raw bodies not stored'
  },
  blockerBeforeAutomatedUse:'obtain an AutoMarket API/feed/partner agreement or written authorization explicitly permitting AvtoCena automated commercial collection, retention and republication; then requalify exact offer fields only through that permitted route'
};
const idx=ledger.decisions.findIndex(x=>x.sourceId===sourceId);
if(idx>=0) ledger.decisions[idx]=decision; else ledger.decisions.push(decision);
ledger.evidenceRuns=[...new Set([...(ledger.evidenceRuns||[]),runId])];
ledger.updatedAt='2026-09-05';

const heading='## 40.45 — AutoMarket UAE: public home is reachable, but automation/reuse permission is not proven';
if(!roadmap.includes(heading)){
  roadmap += `\n\n${heading}\n\nДата: 2026-09-05.\n\n- Japan не трогался и остаётся machine-readable paused по решению владельца.\n- После DubiCars перешли к AutoMarket UAE строго permission-first/no-write: run ${runId}.\n- Probe сделал только два запроса: официальный robots.txt и публичную главную страницу AutoMarket. Оба ответа — HTTP 200; listing/detail/pagination/API запросов не было, production/Object Storage/catalog generation не менялись.\n- В ограниченном HTML главной страницы не найдено ни одной source-declared ссылки Terms / Privacy / Legal / Policy. Это не является разрешением на автоматический коммерческий сбор или повторное использование данных.\n- Решение: \`automarket_uae_candidate\` остаётся \`research_pending\`, \`publishAllowed=false\`. Автоматический inventory/detail/API crawl запрещён, пока нет явно разрешённого API/feed/partner agreement или письменного разрешения AutoMarket для AvtoCena.\n- Следующий non-Japan кандидат: Dubizzle UAE — сначала access-policy, затем только при разрешённом маршруте проверка exact-field contract.\n`;
}

fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');
fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
fs.writeFileSync(roadmapPath,roadmap.replace(/\s*$/,'')+'\n');
