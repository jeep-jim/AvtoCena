import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import {defaultCollectionControls} from '../../apps/web/lib/catalog/collection-controls-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const reportPath=process.env.COLLECTION_CONTROLS_REPORT,completedWidths=[];
let passed=false;
function writeReport(){
 if(!reportPath)return;
 assert.equal(path.isAbsolute(reportPath),true,'browser report path must be absolute');
 const checks=Object.fromEntries(['readyStatus','statusFailureIsolated','scheduleAndLinks','reserveSourcesPreserved','neighborControlsPreserved','lazyStatusReads','revisionConflictPreserved','noOverflow'].map(key=>[key,passed]));
 fs.writeFileSync(reportPath,JSON.stringify({version:1,kind:'china-crm-collection-controls-browser-v1',passed,caseCount:completedWidths.length,widths:[...completedWidths],checks},null,2)+'\n',{mode:0o600});
}
writeReport();
const out='artifacts/collection-controls';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/collection-controls-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'}});
const css=await postcss([tailwindcss({content:['apps/web/components/site/CollectionControls.tsx'],theme:{extend:{}},plugins:[]})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'application/javascript':'text/html');res.end(req.url==='/fixture.js'?fs.readFileSync(`${out}/fixture.js`):`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}:root{--ac-border:#ddd;--ac-muted:#62676f}body{padding:16px;color:#182235}h1{font-size:24px;font-weight:bold;margin-bottom:20px}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],retiredRequests=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',request=>{if(request.url().includes('/api/crm/ajes/markets/'))retiredRequests.push(request.url());});
 let controls=defaultCollectionControls(),gets=0,puts=0,conflict=false,statusGets=0,statusMode='ready';
 controls.markets.china.enabledAt='2026-10-10T06:00:00Z';
 await page.route('**/api/crm/ajes/settings',route=>route.fulfill({json:{configured:true}}));
 await page.route('**/api/crm/china-catalog-status',route=>{
  statusGets++;assert.equal(route.request().method(),'GET');
  if(statusMode==='failed')return route.fulfill({status:503,json:{error:'fixture-private-diagnostic'}});
  if(statusMode==='unavailable')return route.fulfill({json:{status:'unavailable'}});
  return route.fulfill({json:{status:'ready',sourceObservedAt:statusMode==='malformed'?'invalid-date':'2026-11-25T17:34:57.542Z',rows:279450,generationId:'gen_china_45655051136_1'}});
 });
 await page.route('**/api/crm/collection-controls',async route=>{
  if(route.request().method()==='GET'){gets++;return route.fulfill({json:controls});}
  puts++;if(conflict)return route.fulfill({status:409,json:{error:'Настройки уже изменились. Обновите список.'}});
  const body=route.request().postDataJSON();assert.equal(body.revision,controls.revision);
  const field=body.scope==='market'?'markets':'sources',at='2026-10-10T06:00:00Z';
  controls[field][body.id]={...controls[field][body.id],enabled:body.enabled,[body.enabled?'enabledAt':'disabledAt']:at};controls.revision++;
  controls.history.unshift({revision:controls.revision,at,scope:body.scope,id:body.id,enabled:body.enabled,actor:'fixture-owner'});
  return route.fulfill({json:controls});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/crm/site`);
 assert.equal(gets,0,'collapsed section does not add a storage/API read');
 assert.equal(statusGets,0,'collapsed section does not read China status');
 await page.getByText('Обновление каталога · парсеры и фиды',{exact:true}).click();
 const feed=page.getByRole('switch',{name:'Che168 · платный фид Auto API',exact:true}),reserve=page.getByRole('switch',{name:'Che168 · резервный парсер',exact:true}),market=page.getByRole('switch',{name:'Обновление рынка Китай',exact:true});
 await feed.waitFor();assert.equal(await feed.getAttribute('aria-checked'),'true');assert.equal(await reserve.getAttribute('aria-checked'),'false');
 const china=page.locator('section').filter({has:page.getByRole('heading',{name:'Китай',exact:true})}),feedSettings=page.locator('div.py-3').filter({has:feed});
 await china.getByText('Данные поставщика на: 26.11.2026, 00:34:57',{exact:true}).waitFor();
 await china.getByText(/Автомобилей в каталоге: 279\s450/).waitFor();
 await china.getByText('Последнее включение: 10.10.2026, 13:00:00',{exact:true}).waitFor();
 assert.equal(await page.getByText('gen_china_45655051136_1',{exact:false}).count(),0,'private generation identifier is not displayed');
 assert.equal(await china.getByRole('link',{name:'Запуски и обновление в GitHub',exact:true}).getAttribute('href'),'https://github.com/jeep-jim/AvtoCena/actions/workflows/catalog-next-china-daily.yml');
 await feedSettings.getByText('Источник, частота и настройки',{exact:true}).click();
 await feedSettings.getByText('Ежедневно, 21:00 по Красноярску. Плановое время может сдвигаться.',{exact:true}).waitFor();
 await feedSettings.getByText('Резервная проверка — каждые 3 часа. Если данные уже обновлены после последних 21:00, повторный сбор не начинается.',{exact:true}).waitFor();
 for(const label of ['Che168 · резервный парсер','Autohome · резервный парсер новых авто']){
  const sourceSwitch=page.getByRole('switch',{name:label,exact:true}),settings=page.locator('div.py-3').filter({has:sourceSwitch});
  assert.equal(await sourceSwitch.getAttribute('aria-checked'),'false','reserve source selection is preserved');
  const summary=settings.getByText('Источник, частота и настройки',{exact:true});await summary.click();
  await settings.getByText('Резервный источник без автоматического расписания.',{exact:true}).waitFor();
  assert.equal(await settings.getByText(/01:11|21:00|Плановое время может сдвигаться/).count(),0,'reserve sources have no daily schedule claim');
  await summary.click();
 }
 for(const [label,workflow] of [['Япония','catalog-refresh-green.yml'],['Корея','catalog-refresh-korea.yml'],['ОАЭ','catalog-refresh-uae.yml'],['Европа','catalog-refresh-europe.yml'],['Грузия','catalog-refresh-georgia.yml']]){
  const section=page.locator('section').filter({has:page.getByRole('heading',{name:label,exact:true})});
  assert.equal(await section.getByRole('link',{name:'Открыть ручной запуск в GitHub',exact:true}).getAttribute('href'),`https://github.com/jeep-jim/AvtoCena/actions/workflows/${workflow}`);
  assert.equal(await section.getByText(/Данные поставщика на:|Автомобилей в каталоге:|Дата данных недоступна/).count(),0,'China status stays in its market');
 }
 assert.equal(await page.getByRole('switch',{name:/AJ System/}).count(),1);
 await page.getByRole('switch',{name:'AJ System · платный фид Японии',exact:true}).waitFor();
 await page.getByText('AJ System · доступ настроен',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('API-пароль',{exact:true}).count(),1);
 for(const label of ['Китай','Корея']){
  const section=page.locator('section').filter({has:page.getByRole('heading',{name:label,exact:true})});
  assert.equal(await section.getByText(/AJ System/).count(),0);
 }
 assert.deepEqual(retiredRequests,[],'admin never loads removed AJ China/Korea connections');
 assert.equal(statusGets,1,'opening source settings does not reread China status');
 for(const mode of ['unavailable','failed','malformed']){
  statusMode=mode;
  const replies=Promise.all([page.waitForResponse('**/api/crm/collection-controls'),page.waitForResponse('**/api/crm/china-catalog-status')]);
  await page.getByRole('button',{name:'Обновить состояние',exact:true}).click();await replies;
  await china.getByText('Дата данных недоступна',{exact:true}).waitFor();
  assert.equal(await page.getByRole('alert').count(),0,'status failure does not become a collection-controls error');
  assert.equal(await feed.getAttribute('aria-checked'),'true');
  assert.equal(await page.getByText('fixture-private-diagnostic',{exact:false}).count(),0,'status diagnostics are not displayed');
 }
 assert.equal(statusGets,4,'each manual reload performs one China status read');
 const readsBeforeSwitches=statusGets;
 await market.click();await page.getByRole('status').filter({hasText:'Сохранено. Новые задания учтут настройку'}).waitFor();assert.equal(await feed.getAttribute('aria-checked'),'true');await page.getByText('Остановлен выключателем рынка',{exact:true}).waitFor();
 await market.click();await feed.click();await reserve.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Che168 · резервный парсер"]')?.getAttribute('aria-checked')==='true');assert.equal(puts,4);
 const korea=page.getByRole('switch',{name:'Обновление рынка Корея',exact:true});
 await korea.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Обновление рынка Корея"]')?.getAttribute('aria-checked')==='false');
 await korea.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Обновление рынка Корея"]')?.getAttribute('aria-checked')==='true');assert.equal(puts,6,'neighbor-market switches still use the existing revision-protected write');
 assert.equal(statusGets,readsBeforeSwitches,'switch writes do not reread or poll China status');
 statusMode='ready';
 const refreshed=page.waitForResponse('**/api/crm/china-catalog-status');
 await page.getByRole('button',{name:'Обновить состояние',exact:true}).click();await refreshed;
 await china.getByText('Данные поставщика на: 26.11.2026, 00:34:57',{exact:true}).waitFor();
 await page.locator('div.py-3').filter({has:reserve}).getByText('Источник, частота и настройки',{exact:true}).click();
 await page.getByText(/Прямой сбор подержанных автомобилей/).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no mobile overflow');
 await page.screenshot({path:`${out}/controls-${width}.png`,fullPage:true});
 conflict=true;await reserve.click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('switch').count(),0,'unknown state is not displayed as saved');
 await page.getByRole('button',{name:'Обновить состояние',exact:true}).click();await reserve.waitFor();assert.equal(await reserve.getAttribute('aria-checked'),'true');
 await china.getByText('Данные поставщика на: 26.11.2026, 00:34:57',{exact:true}).waitFor();
 assert.equal(statusGets,6);assert.equal(gets,6,'only opening and explicit reload read controls');
 assert.deepEqual(errors,[]);await page.close();completedWidths.push(width);console.log(`Owner controls ${width}: passed`);
}passed=true;}finally{
 try{await browser.close();}catch(error){passed=false;throw error;}
 finally{server.close();writeReport();}
}
