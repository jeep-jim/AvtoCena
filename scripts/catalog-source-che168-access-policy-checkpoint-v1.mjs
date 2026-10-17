import fs from 'node:fs';

const registryPath='data/catalog/source-qualification-v1.json';
const ledgerPath='data/catalog/source-partial-classification-v1.json';
const roadmapPath='roadmap.md';
const sourceId='autohome_used_china_open';
const runId=33938070816;

const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
let roadmap=fs.readFileSync(roadmapPath,'utf8').replace(/\s*$/,'');

const row=registry.candidates.find(x=>x.sourceId===sourceId);
if(!row) throw new Error('Che168 candidate missing');
Object.assign(row,{
  class:'lead_only',
  publishAllowed:false,
  evidence:'Permission-first run 33938070816 kept Che168 to robots.txt + public home only (both HTTP 200; zero detail/API requests). Current public Che168 mobile listing pages identify the service as an Autohome used-car trading platform and expose the official Autohome Legal Statement. That source-declared statement forbids copying/selling/reselling/exploiting any part of the service for commercial purposes and forbids unauthorized copying/linking/illegal use/republication of Autohome site works.',
  qualificationDecision:'data/catalog/source-partial-classification-v1.json#autohome_used_china_open',
  useScope:'manual public reference only; no automated commercial inventory ingestion/republication from public Che168/Autohome pages. Requalify only through an explicitly authorized Autohome/Che168 API, data feed, partner agreement or written permission covering AvtoCena use.',
  qualificationBlocker:'commercial_copy_resale_exploitation_and_unlicensed_content_reuse_prohibited_by_source_declared_autohome_terms'
});
registry.updatedAt='2026-09-05';
registry.next='continue non-Japan China qualification permission-first/no-write; Japan remains paused; next inspect Dongchedi China access policy before any listing/detail/API crawl';

const decision={
  market:'china',sourceId,class:'lead_only',publishAllowed:false,
  useScope:'manual public reference only; no automated commercial ingestion/republication from public Che168/Autohome pages without explicit authorization; any exact-field requalification must use an authorized API/feed/partner route',
  evidence:{
    runId,
    robotsAndHome:'run 33938070816: robots.txt HTTP 200, home HTTP 200, exactly two requests, no detail/pagination/API requests and no raw body storage',
    sourceRelationship:'current Che168 mobile used-car listing footer identifies the service as an Autohome used-car trading platform and exposes the official Autohome Legal Statement',
    officialLegalUrl:'https://www.autohome.com.cn/about/falv.html?child=index',
    commercialRestriction:'Autohome service terms prohibit copying, selling, reselling or exploiting any part/use/access of the service for commercial purposes',
    contentRightsRestriction:'Autohome rights statement says site works may not be copied, linked, illegally used or republished without written authorization',
    permissionDecision:'public automated commercial catalog reuse is not permitted on the current source-declared terms surface'
  },
  blockerBeforeAutomatedUse:'obtain an explicitly authorized Autohome/Che168 API/feed/data partnership or written permission covering AvtoCena automated commercial collection, storage/retention and republication; then requalify the exact-card field contract only through that permitted route'
};
const idx=ledger.decisions.findIndex(x=>x.sourceId===sourceId);
if(idx>=0) ledger.decisions[idx]=decision; else ledger.decisions.push(decision);
ledger.evidenceRuns=[...new Set([...(ledger.evidenceRuns||[]),runId])];
ledger.updatedAt='2026-09-05';

const heading='## 40.47 — Che168 China: source-declared Autohome terms block commercial reuse of public content';
if(!roadmap.includes(heading)){
  roadmap += `\n\n${heading}\n\nДата: 2026-09-05.\n\n- Japan не трогался и остаётся machine-readable paused.\n- После Dubizzle начата China requalification с Che168 строго permission-first/no-write. Run ${runId} запросил только \`robots.txt\` и публичную главную Che168: оба HTTP 200; detail/pagination/API запросов не было, production/Object Storage/generation не менялись.\n- В коротком HTML главной source-declared legal link не отдался, поэтому никакой detail crawl автоматически не продолжался. Отдельно проверена текущая публичная Che168 mobile listing surface: footer прямо обозначает Che168 как used-car trading platform Autohome и содержит ссылку \`法律声明\` на официальный Autohome Legal Statement.\n- Официальные Autohome service terms запрещают для коммерческих целей копировать, продавать, перепродавать или использовать любую часть сервиса/доступа к нему; rights statement также запрещает без письменного разрешения копирование, linking/illegal use и republication произведений/контента Autohome.\n- Решение: \`autohome_used_china_open\` (Che168) -> \`lead_only\`, \`publishAllowed=false\`. Публичный Che168 нельзя использовать как автоматический коммерческий источник каталога. Повторная exact-field qualification допустима только через явно разрешённый Autohome/Che168 API/feed/data-partnership или письменное разрешение.\n- Следующий China кандидат: Dongchedi — сначала access-policy/permission-first, без listing/detail/API crawl до доказанного разрешённого маршрута.\n`;
}

fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');
fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
fs.writeFileSync(roadmapPath,roadmap.replace(/\s*$/,'')+'\n');
