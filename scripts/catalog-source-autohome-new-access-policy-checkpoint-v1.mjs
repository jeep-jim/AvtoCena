import fs from 'node:fs';

const registryPath='data/catalog/source-qualification-v1.json';
const ledgerPath='data/catalog/source-partial-classification-v1.json';
const roadmapPath='roadmap.md';
const sourceId='autohome_new_china_open';

const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
let roadmap=fs.readFileSync(roadmapPath,'utf8').replace(/\s*$/,'');

const row=registry.candidates.find(x=>x.sourceId===sourceId);
if(!row) throw new Error('Autohome new-cars candidate missing');
Object.assign(row,{
  class:'lead_only',
  publishAllowed:false,
  evidence:'Current official Autohome Legal Statement and User Service Agreement apply to Autohome online services and content. The Legal Statement says Autohome site works may not be copied, linked, illegally used, republished or mirrored without written authorization and its service terms prohibit copying/selling/reselling/exploiting any part/use/access of the service for commercial purposes. The current User Service Agreement additionally states commercial use requires prior written authorization and forbids unauthorized use including robot/spider operations on Autohome content/services.',
  qualificationDecision:'data/catalog/source-partial-classification-v1.json#autohome_new_china_open',
  useScope:'manual public reference only; no automated commercial ingestion/republication from public Autohome new-car pages. Requalify only through written Autohome authorization or an explicitly permitted API/feed/data-partnership route covering AvtoCena.',
  qualificationBlocker:'current_autohome_terms_require_written_authorization_for_commercial_use_and_prohibit_unauthorized_robot_spider_content_operations'
});
registry.updatedAt='2026-09-05';
registry.next='non-Japan source qualification inventory is now policy-triaged; Japan remains paused. Next execute the existing Good Car China exact_catalog blockers: dedicated adapter, deterministic kW-to-powerHp provenance tests, full no-write ICE dry-run, and manual normalized-card/gallery spot-check before any publication.';

const decision={
  market:'china',sourceId,class:'lead_only',publishAllowed:false,
  useScope:'manual public reference only; no automated public-site commercial ingestion/republication without written Autohome authorization; exact-field requalification requires an authorized API/feed/data-partnership route',
  evidence:{
    checkedAt:'2026-09-05',
    officialLegalStatementUrl:'https://www.autohome.com.cn/about/falv.html?child=index',
    officialUserAgreementUrl:'https://mobile.app.autohome.com.cn/usereg_v7.4.0/static/register_protocol.html',
    commercialRestriction:'Autohome service terms prohibit copying, selling, reselling or exploiting any part/use/access of the service for commercial purposes; current user agreement says commercial use requires prior written authorization',
    contentRestriction:'Autohome rights statement says site works may not be copied, linked, illegally used, republished or mirrored without written authorization',
    automationRestriction:'current user agreement states Autohome content/services may not be used without authorization including operations through robots/spiders and similar programs/devices'
  },
  blockerBeforeAutomatedUse:'obtain written Autohome authorization or an explicitly permitted API/feed/data-partnership agreement covering AvtoCena automated collection, storage/retention and republication'
};
const idx=ledger.decisions.findIndex(x=>x.sourceId===sourceId);
if(idx>=0) ledger.decisions[idx]=decision; else ledger.decisions.push(decision);
ledger.updatedAt='2026-09-05';

const heading='## 40.50 — Autohome new cars China: current official terms require written authorization for commercial/automated reuse';
if(!roadmap.includes(heading)){
  roadmap += `\n\n${heading}\n\nДата: 2026-09-05.\n\n- Japan не трогался и остаётся machine-readable paused.\n- После Guazi отдельно закрыт \`autohome_new_china_open\`. Новый public crawl не запускался: для \`autohome.com.cn\` уже есть прямой актуальный официальный legal/service contract, поэтому лишние listing/detail запросы не нужны.\n- Текущий официальный Autohome Legal Statement распространяется на online services/содержимое Autohome. В нём указано, что работы/контент сайтов Autohome нельзя без письменной авторизации копировать, линковать, незаконно использовать, перепубликовывать или зеркалировать; service terms также запрещают для коммерческих целей копировать, продавать, перепродавать или эксплуатировать любую часть/использование/доступ к сервису.\n- Текущий официальный Autohome User Service Agreement дополнительно говорит, что commercial use требует предварительного письменного разрешения, а неавторизованное использование контента/сервиса включает операции через robot/spider и аналогичные программы/устройства.\n- Решение: \`autohome_new_china_open\` -> \`lead_only\`, \`publishAllowed=false\`. Public Autohome new-car pages не используются как автоматический коммерческий источник.\n- После этой записи non-Japan registry policy-triage доведён до текущих кандидатов. Следующий практический этап — единственный уже доказанный \`exact_catalog\` кандидат \`chngoodcar_china_candidate\`: dedicated adapter + deterministic kW→powerHp provenance/test + полный no-write ICE dry-run + ручной spot-check карточек и listing-bound gallery. Публикация по-прежнему запрещена до прохождения всех блокеров.\n`;
}

fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');
fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
fs.writeFileSync(roadmapPath,roadmap.replace(/\s*$/,'')+'\n');
