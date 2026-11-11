import fs from 'node:fs/promises';

const REGISTRY_PATH='data/catalog/source-qualification-v1.json';
const LEDGER_PATH='data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH='roadmap.md';
const SOURCE_ID='mobile_de_open';

const DECISION={
  market:'europe',
  sourceId:SOURCE_ID,
  class:'lead_only',
  publishAllowed:false,
  useScope:'manual public reference/link-out only; no public-page automated extraction/reuse; requalify only through an official mobile.de Search-API/partner agreement or written permission that explicitly covers AvtoCena use',
  evidence:{
    termsIndex:'https://www.mobile.de/en/service/agbIndex/',
    professionalGtc:'https://www.mobile.de/en/service/agbProfessional',
    professionalGtcEffective:'01.04.2026',
    scrapingRestriction:'Article 11 restricts vehicle search to the provided search screens and prohibits unauthorized search tools, extraction/reuse, data mining, robots, grabbing, scraping and similar collection/extraction technologies.',
    publicDomainRestriction:'mobile.de public-domain GTC publishes the same core search-mask and scraping/extraction restriction.',
    officialSearchApiTerms:'https://www.mobile.de/service/pdfs/agb_search_api_2016_en.pdf',
    officialApiMeaning:'Search-API access is for an API PARTNER under an API Partner Agreement and within the agreed Partner Application/scope.',
    probeBoundary:'source-permission-first stop: no mobile.de inventory list/detail/API scraping probe started after reading the official terms',
  },
  blockerBeforeAutomatedUse:'obtain an official mobile.de Search-API/partner agreement or written permission explicitly covering AvtoCena automated commercial use, storage/retention and republication, then requalify technically only through that permitted route',
};

const MARKER='## 40.33 — mobile.de Europe: public scraping blocked; official partner Search-API is the permitted path';
const APPEND=`\n\n${MARKER}\n\nДата: 2026-09-04.\n\nВетка: \`chore/mobilede-access-policy-v1-20260904\`.\n\n- Source-permission-first проверка выполнена до нового technical crawl.\n- Current Professional Domain GTC mobile.de (valid from 01.04.2026), Article 11: vehicle search должен идти через предоставленные search screens; unauthorized search tools, extraction/reuse, data mining, robots, grabbing, scraping и аналогичные технологии запрещены.\n- Public-domain GTC содержит тот же core restriction для public marketplace.\n- Поэтому \`mobile_de_open -> lead_only\`, \`publishAllowed=false\`; public-page crawler/list/detail qualification не запускать.\n- Важный положительный сигнал: mobile.de публикует официальные Search-API GTC. Это не public permission: Search-API предназначен для API PARTNER и работает в рамках API Partner Agreement/Partner Application.\n- Значит правильный следующий путь для mobile.de — официальный partner/API agreement, а не scraping. После получения разрешённого API scope можно заново делать exact field qualification именно на API.\n- После чтения terms automated mobile.de inventory requests не запускались; production/Object Storage/catalog writes отсутствуют.\n- Japan остаётся на паузе.\n\n### Следующее действие после 40.33\n\nПродолжить следующий non-Japan \`research_pending\` source: сначала official access/reuse terms, затем bounded no-write technical qualification только если terms допускают автоматизацию.\n`;

const registry=JSON.parse(await fs.readFile(REGISTRY_PATH,'utf8'));
const row=registry.candidates?.find(x=>x.sourceId===SOURCE_ID);if(!row)throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row,{class:'lead_only',publishAllowed:false,evidence:'Current official mobile.de GTC prohibit unauthorized automated search tools, extraction/reuse, data mining, robots, grabbing and scraping on the public marketplace; official Search-API access exists only for API partners under an API Partner Agreement.',qualificationDecision:'data/catalog/source-partial-classification-v1.json#mobile_de_open',useScope:DECISION.useScope});
registry.updatedAt='2026-09-04';registry.next='continue non-Japan research_pending qualification source-permission-first; Japan remains paused; mobile.de requires official partner/API permission before technical requalification';

const ledger=JSON.parse(await fs.readFile(LEDGER_PATH,'utf8'));ledger.updatedAt='2026-09-04';if(!Array.isArray(ledger.decisions))ledger.decisions=[];const i=ledger.decisions.findIndex(x=>x.sourceId===SOURCE_ID);if(i>=0)ledger.decisions[i]=DECISION;else ledger.decisions.push(DECISION);
if(registry.productionWrites!==false||ledger.productionWrites!==false||ledger.publishAllowedMutations!==false)throw new Error('safety flag changed');
if((registry.candidates||[]).some(x=>x.publishAllowed===true))throw new Error('unexpected publishAllowed=true');

let roadmap=await fs.readFile(ROADMAP_PATH,'utf8');if(!roadmap.includes(MARKER))roadmap=`${roadmap.replace(/\s*$/,'')}${APPEND}\n`;else roadmap=`${roadmap.replace(/\s*$/,'')}\n`;
await fs.writeFile(REGISTRY_PATH,`${JSON.stringify(registry,null,2)}\n`);await fs.writeFile(LEDGER_PATH,`${JSON.stringify(ledger,null,2)}\n`);await fs.writeFile(ROADMAP_PATH,roadmap);
console.log(JSON.stringify({sourceId:SOURCE_ID,class:'lead_only',publishAllowed:false,officialPartnerApiRoute:true,automatedPublicProbeStarted:false,japanPaused:true,productionWrites:false},null,2));
