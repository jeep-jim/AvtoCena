import fs from 'node:fs';

const registryPath='data/catalog/source-qualification-v1.json';
const ledgerPath='data/catalog/source-partial-classification-v1.json';
const roadmapPath='roadmap.md';
const sourceId='dongchedi_china_open';
const runId=33938264745;

const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
let roadmap=fs.readFileSync(roadmapPath,'utf8').replace(/\s*$/,'');

const row=registry.candidates.find(x=>x.sourceId===sourceId);
if(!row) throw new Error('Dongchedi candidate missing');
Object.assign(row,{
  class:'research_pending',
  publishAllowed:false,
  evidence:'Permission-first run 33938264745: robots.txt and public Dongchedi home returned HTTP 200; exactly two requests were made and no source-declared legal link was exposed in the bounded home HTML, so public automated commercial reuse permission remains unproven. A separate official Dongchedi Enterprise Open Platform exists for business users, but its own service agreement expressly prohibits robot/spider/crawler/other automated access and unauthorized robot/spider monitoring, copying, dissemination, display or mirroring of service content.',
  qualificationDecision:'data/catalog/source-partial-classification-v1.json#dongchedi_china_open',
  useScope:'manual public reference only while permission for public automated commercial inventory reuse is unproven; do not crawl public listing/detail/API routes. Any future automated use must come from an explicit Dongchedi agreement/authorized business data route that specifically covers AvtoCena.',
  permittedRouteCandidate:'official_dongchedi_enterprise_open_platform_contact_open.dongchedi@bytedance.com',
  qualificationBlocker:'public_automation_permission_unproven_and_official_enterprise_platform_terms_prohibit_robots_without_operator_permission'
});
registry.updatedAt='2026-09-05';
registry.next='continue non-Japan China qualification permission-first/no-write; Japan remains paused; next inspect Guazi China access policy before any listing/detail/API crawl';

const decision={
  market:'china',sourceId,class:'research_pending',publishAllowed:false,
  useScope:'manual public reference only; no public inventory automation while commercial reuse permission is unproven; requalify only through an explicitly authorized Dongchedi business/data agreement whose scope covers AvtoCena automated collection, retention and republication',
  permittedRouteCandidate:{type:'official_enterprise_open_platform_contact',url:'https://open.dongchedi.com',email:'open.dongchedi@bytedance.com'},
  evidence:{
    runId,
    publicProbe:'robots.txt HTTP 200 + home HTTP 200; exactly two requests; zero detail/pagination/API requests; raw bodies not stored',
    publicLegalSurface:'bounded public home exposed no source-declared user-agreement/privacy/legal link, so public automated commercial reuse permission is not proven',
    officialEnterpriseTermsUrl:'https://open.dongchedi.com/draft/ies-hotsoon-draft/dcar_open_platform/e2fd2cfd-cf01-4ebc-a483-79fd1024c3c4.html',
    enterpriseScope:'official agreement states the Enterprise Open Platform is for business users and currently operated by Beijing Space Transformation Technology Co., Ltd.',
    enterpriseAutomationRestriction:'the official Enterprise Open Platform agreement prohibits robot/spider/crawler/other automated access or login',
    enterpriseContentRestriction:'the same agreement states service content may not be monitored, copied, disseminated, displayed or mirrored by robots/spiders or similar programs/devices without operator permission',
    contact:'official Enterprise Open Platform privacy policy publishes open.dongchedi@bytedance.com as a contact address'
  },
  blockerBeforeAutomatedUse:'obtain a Dongchedi agreement or authorized data/feed/API route that explicitly permits AvtoCena automated commercial vehicle-data collection, retention and republication; then requalify exact fields only within that authorized scope'
};
const idx=ledger.decisions.findIndex(x=>x.sourceId===sourceId);
if(idx>=0) ledger.decisions[idx]=decision; else ledger.decisions.push(decision);
ledger.evidenceRuns=[...new Set([...(ledger.evidenceRuns||[]),runId])];
ledger.updatedAt='2026-09-05';

const heading='## 40.48 — Dongchedi China: public permission is unproven; official business platform also blocks unauthorized robots';
if(!roadmap.includes(heading)){
  roadmap += `\n\n${heading}\n\nДата: 2026-09-05.\n\n- Japan не трогался и остаётся machine-readable paused.\n- После Che168 проверен Dongchedi строго permission-first/no-write. Run ${runId} сделал только два запроса: \`robots.txt\` и публичную главную \`dongchedi.com\`; оба HTTP 200. Detail/pagination/API запросов не было, production/Object Storage/generation не менялись.\n- В ограниченном HTML публичной главной source-declared legal/privacy/user-agreement link не обнаружен. Поэтому отсутствие запрета не трактуется как разрешение: автоматический коммерческий сбор публичного каталога остаётся недоказанным и не запускается.\n- Отдельно подтверждена официальная \`懂车帝企业开放平台\` (Dongchedi Enterprise Open Platform) для business users. Это потенциальный договорной контактный путь, но не готовое разрешение на наш use case: её официальный service agreement прямо запрещает robot/spider/crawler/other automated access/login и без разрешения оператора запрещает robot/spider monitoring/copying/dissemination/display/mirroring содержимого сервиса.\n- Официальный contact этой business platform: \`open.dongchedi@bytedance.com\`.\n- Решение: \`dongchedi_china_open\` остаётся \`research_pending\`, \`publishAllowed=false\`. Не запускать public listing/detail/API crawl. Возвращаться к технической exact-field qualification только после явно разрешённого Dongchedi agreement/feed/API/data route с правами на AvtoCena collection, retention и republication.\n- Следующий China кандидат: Guazi — permission-first/no-write.\n`;
}

fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');
fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
fs.writeFileSync(roadmapPath,roadmap.replace(/\s*$/,'')+'\n');
