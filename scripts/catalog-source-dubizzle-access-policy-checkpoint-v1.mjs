import fs from 'node:fs';

const registryPath='data/catalog/source-qualification-v1.json';
const ledgerPath='data/catalog/source-partial-classification-v1.json';
const roadmapPath='roadmap.md';
const sourceId='dubizzle_uae_open';

const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
let roadmap=fs.readFileSync(roadmapPath,'utf8').replace(/\s*$/,'');

const row=registry.candidates.find(x=>x.sourceId===sourceId);
if(!row) throw new Error('Dubizzle candidate missing');
Object.assign(row,{
  class:'lead_only',
  publishAllowed:false,
  evidence:'Official Dubizzle Platform Terms of Use (effective 2024-11-01) prohibit commercial exploitation of Platform/Content and prohibit manual/software/script/robot/spider/crawler scraping or compiling a collection/database/directory from Platform Content. Independently, the previous strict baseline scanned 9,883 rows and produced zero exact cards because engine/power are commonly ranges or incomplete.',
  qualificationDecision:'data/catalog/source-partial-classification-v1.json#dubizzle_uae_open',
  useScope:'manual public reference only; no automated public-site scraping, database compilation, commercial exploitation or republication. Requalify only through an explicitly permitted Dubizzle API/feed/partner agreement or written authorization, then re-test exact offer fields.',
  qualificationBlocker:'public_scraping_database_compilation_and_commercial_exploitation_prohibited_plus_exact_engine_power_contract_failed'
});
registry.updatedAt='2026-09-05';
registry.next='continue non-Japan qualification permission-first/no-write; Japan remains paused; next requalify Che168 China under the new exact-card contract before any production adapter work';

const decision={
  market:'uae',sourceId,class:'lead_only',publishAllowed:false,
  useScope:'manual public reference only; no automated public-site scraping, database compilation, commercial exploitation or republication without explicit Dubizzle authorization; any future technical requalification must use an authorized API/feed/agreement',
  evidence:{
    officialTermsUrl:'https://www.dubizzle.com/legalhub/terms/',
    termsEffective:'2024-11-01',
    commercialRestriction:'official Terms prohibit reproducing/duplicating/copying/selling/trading/reselling or exploiting Platform/Content for commercial purposes',
    automationRestriction:'official Terms prohibit manual/software/device/script/robot/spider/bot/crawler scraping and compiling a collection, database or directory from Platform/Content, including bypassing robot-exclusion headers',
    previousFieldBaseline:'9,883 rows scanned; strict exact result zero because engine and power are commonly ranges or incomplete',
    policyDecision:'public automated commercial ingestion is blocked even before the existing exact-field gap is considered'
  },
  blockerBeforeAutomatedUse:'obtain an explicitly permitted Dubizzle API/feed/partner agreement or written authorization covering AvtoCena automated commercial collection, retention and republication; then requalify exact engineCc/powerHp and full card contract from that permitted route'
};
const idx=ledger.decisions.findIndex(x=>x.sourceId===sourceId);
if(idx>=0) ledger.decisions[idx]=decision; else ledger.decisions.push(decision);
ledger.updatedAt='2026-09-05';

const heading='## 40.46 — Dubizzle UAE: official Terms block scraping/database reuse; strict exact contract already failed';
if(!roadmap.includes(heading)){
  roadmap += `\n\n${heading}\n\nДата: 2026-09-05.\n\n- Japan не трогался и остаётся machine-readable paused.\n- После AutoMarket перешли к Dubizzle UAE. Нового inventory/detail crawl не запускали: сначала перечитаны текущие официальные Dubizzle Platform Terms of Use.\n- Terms (effective 2024-11-01) запрещают коммерческую эксплуатацию Platform/Content и отдельно запрещают manual/software/script/robot/spider/bot/crawler scraping, создание collection/database/directory из контента и обход robot-exclusion headers.\n- Технический exact-контракт Dubizzle уже был слабым независимо от правового барьера: предыдущий strict baseline просмотрел 9,883 rows и получил 0 exact cards, потому что engine/power часто приходят диапазонами или неполными значениями.\n- Решение: \`dubizzle_uae_open\` -> \`lead_only\`, \`publishAllowed=false\`. Public-site automated ingestion/republication запрещён; повторная техническая квалификация возможна только через явно разрешённый Dubizzle API/feed/partner agreement или письменное разрешение.\n- Production catalog, Object Storage, generation/manifest и пользовательский сайт не менялись.\n- Следующий шаг: Che168 China — заново квалифицировать под текущий strict exact-card contract, начиная с access-policy/permission-first и без production writes.\n`;
}

fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');
fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
fs.writeFileSync(roadmapPath,roadmap.replace(/\s*$/,'')+'\n');
