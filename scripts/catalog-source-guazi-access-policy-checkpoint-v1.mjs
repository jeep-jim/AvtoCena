import fs from 'node:fs';

const registryPath='data/catalog/source-qualification-v1.json';
const ledgerPath='data/catalog/source-partial-classification-v1.json';
const roadmapPath='roadmap.md';
const sourceId='guazi_china_open';
const runId=33938425009;

const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
let roadmap=fs.readFileSync(roadmapPath,'utf8').replace(/\s*$/,'');

const row=registry.candidates.find(x=>x.sourceId===sourceId);
if(!row) throw new Error('Guazi candidate missing');
Object.assign(row,{
  class:'lead_only',
  publishAllowed:false,
  evidence:'Permission-first run 33938425009 made only robots.txt + public Guazi home requests; robots returned HTTP 200 and the home resolved HTTP 200 to en.guazi.com, with zero listing/detail/pagination/API requests. Separately, the current official Guazi Used Car User Usage Agreement defines the covered Guazi web/mobile services and states that without explicit special written permission no entity or person may copy, disseminate, display, mirror, upload/download, reprint, quote, link, scrape or otherwise use site information content.',
  qualificationDecision:'data/catalog/source-partial-classification-v1.json#guazi_china_open',
  useScope:'manual public reference only; no automated public-site collection, scraping, copying or republication. Requalify only through explicit Guazi written permission or an authorized API/feed/partner agreement whose scope covers AvtoCena.',
  qualificationBlocker:'official_guazi_user_agreement_requires_explicit_special_written_permission_for_scraping_copying_linking_and_other_content_use'
});
registry.updatedAt='2026-09-05';
registry.next='continue non-Japan China qualification permission-first/no-write; Japan remains paused; next classify Autohome new-cars public route under the current Autohome legal/service terms before any catalog crawl';

const decision={
  market:'china',sourceId,class:'lead_only',publishAllowed:false,
  useScope:'manual public reference only; no automated public-site scraping/copying/republication without explicit special written Guazi permission; any future exact-field qualification must use an authorized API/feed/partner route',
  evidence:{
    runId,
    publicProbe:'robots.txt HTTP 200; public home HTTP 200 after redirect to en.guazi.com; exactly two requests; no listing/detail/pagination/API requests; no raw body storage',
    officialTermsUrl:'https://www.guazi.com/shiyongxieyi.html',
    coveredService:'the Guazi User Usage Agreement defines Guazi as guazi.com plus its mobile sites/apps and applies to registered and non-registered users using Guazi services/site materials',
    explicitRestriction:'agreement section 6 states that without Guazi explicit special written permission no entity/person may copy, disseminate, display, mirror, upload/download, reprint, quote, link, scrape or otherwise use site information content',
    permissionDecision:'public automated commercial catalog collection/republication is blocked on the current official terms'
  },
  blockerBeforeAutomatedUse:'obtain explicit special written Guazi authorization or an authorized API/feed/partner agreement covering AvtoCena automated collection, storage/retention and republication; then requalify exact fields only within that scope'
};
const idx=ledger.decisions.findIndex(x=>x.sourceId===sourceId);
if(idx>=0) ledger.decisions[idx]=decision; else ledger.decisions.push(decision);
ledger.evidenceRuns=[...new Set([...(ledger.evidenceRuns||[]),runId])];
ledger.updatedAt='2026-09-05';

const heading='## 40.49 — Guazi China: official user agreement expressly blocks scraping/content reuse without written permission';
if(!roadmap.includes(heading)){
  roadmap += `\n\n${heading}\n\nДата: 2026-09-05.\n\n- Japan не трогался и остаётся machine-readable paused.\n- После Dongchedi проверен Guazi строго permission-first/no-write. Run ${runId} сделал только два запроса: \`robots.txt\` (HTTP 200) и публичную главную; главная отдала HTTP 200 после redirect на \`en.guazi.com\`. Listing/detail/pagination/API запросов не было, production/Object Storage/generation не менялись.\n- В ограниченном HTML redirect-страницы legal link не обнаружен, поэтому никакой inventory crawl автоматически не продолжался.\n- Отдельно проверен текущий официальный \`瓜子二手车用户使用协议\` на \`guazi.com/shiyongxieyi.html\`. Agreement охватывает сайт Guazi и его mobile sites/apps и прямо говорит: без явного специального письменного разрешения Guazi нельзя полностью или частично копировать, распространять, показывать, зеркалировать, загружать/скачивать, перепечатывать, цитировать, линковать, \`抓取\` (scrape) или иным способом использовать информационный контент сайта.\n- Решение: \`guazi_china_open\` -> \`lead_only\`, \`publishAllowed=false\`. Публичный Guazi не используется для автоматического коммерческого каталога. Возврат к технической qualification — только после explicit written permission либо authorized API/feed/partner agreement с правами на AvtoCena collection, retention и republication.\n- Следующий China шаг: Autohome new cars — применить и проверить тот же current Autohome legal/service contract отдельно к \`autohome_new_china_open\`, без публичного crawl.\n`;
}

fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');
fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
fs.writeFileSync(roadmapPath,roadmap.replace(/\s*$/,'')+'\n');
