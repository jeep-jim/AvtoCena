import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/model-suggestions';fs.mkdirSync(out,{recursive:true});
const meta=JSON.parse(fs.readFileSync('apps/web/lib/catalog/model-search-asset.json'));
await build({entryPoints:['tests/browser/model-suggestions-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/app.js`,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'}});
const css=await postcss([tailwindcss({content:['apps/web/components/catalog/VehicleModelSearch.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});fs.writeFileSync(`${out}/app.css`,css.css);
const server=http.createServer((req,res)=>{if(req.url.startsWith('/api/catalog/source-models?')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,brands:[],models:[]}));return;}if(req.url==='/api/catalog/models?scope=inventory'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,brands:[],models:[['Haval','M6',[],1],['Haval','F7',[],1],['Great Wall','Poer',[],1],['Isuzu','RE-MAX Ruimai',[],1]]}));return;}if(req.url===meta.asset){res.setHeader('Content-Type','application/json');res.end(fs.readFileSync('apps/web/public'+meta.asset));return;}if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(out+req.url));return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const modelInput=page=>({fill:async text=>{
 const trigger=page.getByRole('searchbox',{name:'Модель автомобиля',exact:true});
 if(await trigger.getAttribute('readonly')!==null){
  const dialog=page.getByRole('dialog',{name:'Выбор моделей'});
  if(!await dialog.isVisible())await trigger.click();
  await dialog.getByRole('searchbox',{name:'Поиск модели',exact:true}).fill(text);
 }else await trigger.fill(text);
}});
const closeMobile=async page=>{if(await page.getByRole('dialog',{name:'Выбор моделей'}).isVisible())await page.getByRole('button',{name:'Закрыть список моделей',exact:true}).click();};
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();let directoryRequests=0,inventoryRequests=0;
 page.on('request',request=>{if(request.url().includes('/model-directory.'))directoryRequests++;if(request.url().includes('/api/catalog/models?scope=inventory'))inventoryRequests++;});
 await page.goto(`http://127.0.0.1:${server.address().port}`);const input=modelInput(page);
 await input.fill('Corolla Z');const family=page.getByRole('button').filter({has:page.getByText('Corolla',{exact:true})});await family.waitFor();assert.match(await family.textContent(),/Похожая модель/);const cross=page.getByRole('button').filter({has:page.getByText('Corolla Cross',{exact:true})});
 await input.fill('Королла Z');await family.waitFor();await input.fill('Королла Кросс');await cross.waitFor();await page.screenshot({path:`${out}/${width}.png`});await cross.click();assert.match(await page.getByLabel('Выбрано').textContent(),/Toyota \/ Corolla Cross/);
 await closeMobile(page);await page.getByRole('heading',{name:'Поиск модели'}).click();await page.getByRole('button',{name:'Сбросить',exact:true}).click();await input.fill('Corolla Cross');await page.getByRole('button').filter({has:page.getByText('Corolla Cross',{exact:true})}).waitFor();
 const timings=[];for(const q of ['Cor','Corolla Z','Королла Кросс','Corolla']){const at=performance.now();await input.fill(q);await page.getByRole('button',{name:/Corolla/}).first().waitFor();timings.push(performance.now()-at);}
 assert.equal(directoryRequests,1);assert.equal(inventoryRequests,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await closeMobile(page);await page.getByRole('heading',{name:'Поиск модели'}).click();await page.getByRole('button',{name:'Сбросить',exact:true}).click();
 for(const q of ['M6','Haval M6','Poer','RE-MAX']){
  await input.fill(q);const model=q.includes('M6')?'M6 Haval':q==='Poer'?'Poer Great Wall':'RE-MAX Ruimai Isuzu';
  await page.getByRole('button',{name:model,exact:true}).waitFor();
 }
 await input.fill('Haval M6');await page.getByRole('button',{name:'M6 Haval',exact:true}).click();
 assert.match(await page.getByLabel('Выбрано').textContent(),/Haval \/ M6/);
 await page.getByText('Ищем модель…',{exact:true}).waitFor({state:'hidden'});
 assert.equal(inventoryRequests,1,'typing and reopening share the inventory download');
 await page.screenshot({path:`${out}/${width}-inventory.png`});
 console.log(JSON.stringify({width,directoryRequests,inventoryRequests,inputToSuggestionMs:timings}));await context.close();
}
 // Empty source facets plus a failed supplier directory must keep the model picker useful.
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();let attempts=0;
  await page.route('**/api/catalog/source-models?**',route=>{attempts++;return route.fulfill({status:503,json:{error:'directory_unavailable'}});});
  await page.goto(`http://127.0.0.1:${server.address().port}/?source=korea`);
  await page.getByRole('button',{name:'Hyundai',exact:true}).click();
  await modelInput(page).fill('ix 35');
  const option=page.getByRole('button').filter({has:page.getByText('ix35',{exact:true})});await option.waitFor();
  await page.getByRole('button',{name:'Не удалось загрузить все модели. Повторить'}).waitFor();
  await page.getByRole('button',{name:'Закрыть список моделей',exact:true}).click();
  assert.match(await page.getByLabel('Выбрано').textContent(),/Hyundai \/ ix35/);
  await page.getByRole('button',{name:'Сбросить',exact:true}).click();
  await modelInput(page).fill('ix 35');await option.waitFor();
  await page.getByRole('button',{name:'Закрыть список моделей',exact:true}).click();
  assert.match(await page.getByLabel('Выбрано').textContent(),/Hyundai \/ ix35/,'typed exact model also selects its unambiguous make');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${out}/${width}-korea-directory-failure.png`});
  console.log(JSON.stringify({width,koreaDirectoryFallback:true,supplierAttempts:attempts}));await context.close();
 }
 // The common picker must recover on every public market, with several makes,
 // and a make change must not retain the previous brand's model selection.
 for(const width of [390,1440])for(const [market,make,model] of [
  ['china','Haval','H6'],['japan','Honda','Fit'],['korea','Kia','Seltos'],
  ['uae','BMW','X5'],['europe','Audi','A6'],['georgia','Toyota','Camry'],
 ]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  await page.route('**/api/catalog/**',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
  const facets=['japan','korea'].includes(market)?'&facets=empty':'';
  await page.goto(`http://127.0.0.1:${server.address().port}/?market=${market}${facets}`);
  await page.getByLabel('Марка теста').selectOption(make);
  await modelInput(page).fill(model);
  const choice=page.getByRole('button').filter({has:page.getByText(model,{exact:true})});
  await choice.waitFor();await choice.click();
  await page.getByRole('button',{name:'Закрыть список моделей',exact:true}).click();
  assert.equal(await page.getByLabel('Выбрано').textContent(),`${make} / ${model}`);
  await page.getByLabel('Марка теста').selectOption('Hyundai');
  assert.equal(await page.getByLabel('Выбрано').textContent(),'Hyundai / ');
  await modelInput(page).fill('Kona');
  await page.getByRole('button').filter({has:page.getByText('Kona',{exact:true})}).waitFor();
  assert.equal(await page.getByRole('button').filter({has:page.getByText(model,{exact:true})}).count(),0,'another make cannot leak into suggestions');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${out}/${width}-${market}-recovery.png`});
  console.log(JSON.stringify({width,market,make,model,recovery:true,makeChangeClearsModel:true}));await context.close();
 }
 // An unreachable dictionary must not hide live inventory or spin forever;
 // retry must replace the rejected shared request.
 const context=await browser.newContext(),page=await context.newPage();
 await page.route('**/model-directory.*.json',route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const input=modelInput(page);
 await input.fill('M6');await page.getByRole('button',{name:'M6 Haval'}).waitFor();
 await page.getByRole('button',{name:'Не удалось загрузить все модели. Повторить'}).waitFor();
 await page.unroute('**/model-directory.*.json');
 await page.getByRole('button',{name:'Не удалось загрузить все модели. Повторить'}).click();
 await input.fill('Corolla Cross');await page.getByRole('button').filter({has:page.getByText('Corolla Cross',{exact:true})}).waitFor();
 await context.close();
 const stalled=await browser.newContext(),stalledPage=await stalled.newPage();
 await stalledPage.route('**/api/catalog/models?scope=inventory',()=>{});
 await stalledPage.goto(`http://127.0.0.1:${server.address().port}`);
 await modelInput(stalledPage).fill('not-a-model');
 await stalledPage.getByRole('button',{name:'Не удалось загрузить все модели. Повторить'}).waitFor({timeout:16000});
 await stalledPage.getByText('Ищем модель…',{exact:true}).waitFor({state:'hidden'});
 await stalled.close();
 console.log('inventory-only models, pickup models, error retry and request deadline passed');
}finally{await browser.close();server.close();}
