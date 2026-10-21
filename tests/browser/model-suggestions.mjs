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
const server=http.createServer((req,res)=>{if(req.url==='/api/catalog/models?scope=inventory'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,brands:[],models:[['Haval','M6',[],1],['Haval','F7',[],1],['Great Wall','Poer',[],1],['Isuzu','RE-MAX Ruimai',[],1]]}));return;}if(req.url===meta.asset){res.setHeader('Content-Type','application/json');res.end(fs.readFileSync('apps/web/public'+meta.asset));return;}if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(out+req.url));return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();let directoryRequests=0,apiRequests=0;
 page.on('request',request=>{if(request.url().includes('/model-directory.'))directoryRequests++;if(request.url().includes('/api/catalog/'))apiRequests++;});
 await page.goto(`http://127.0.0.1:${server.address().port}`);const input=page.getByRole('searchbox',{name:'Модель автомобиля'});
 await input.fill('Corolla Z');const cross=page.getByRole('button').filter({has:page.getByText('Corolla Cross',{exact:true})});await cross.waitFor();assert.ok(await cross.isVisible());assert.match(await cross.textContent(),/Похожая модель/);
 await input.fill('Королла Z');await cross.waitFor();await page.screenshot({path:`${out}/${width}.png`});await cross.click();assert.match(await page.getByLabel('Выбрано').textContent(),/Toyota \/ Corolla Cross/);
 await page.getByRole('heading',{name:'Поиск модели'}).click();await page.getByRole('button',{name:'Сбросить',exact:true}).click();await input.fill('Corolla Cross');await page.getByRole('button').filter({has:page.getByText('Corolla Cross',{exact:true})}).waitFor();
 const timings=[];for(const q of ['Cor','Corolla Z','Королла Кросс','Corolla']){const at=performance.now();await input.fill(q);await page.getByRole('button',{name:/Corolla Cross/}).first().waitFor();timings.push(performance.now()-at);}
 assert.equal(directoryRequests,1);assert.equal(apiRequests,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('heading',{name:'Поиск модели'}).click();await page.getByRole('button',{name:'Сбросить',exact:true}).click();
 for(const q of ['M6','Haval M6','Poer','RE-MAX']){
  await input.fill(q);const model=q.includes('M6')?'M6 Haval':q==='Poer'?'Poer Great Wall':'RE-MAX Ruimai Isuzu';
  await page.getByRole('button',{name:model,exact:true}).waitFor();
 }
 await input.fill('Haval M6');await page.getByRole('button',{name:'M6 Haval',exact:true}).click();
 assert.match(await page.getByLabel('Выбрано').textContent(),/Haval \/ M6/);
 await page.getByText('Ищем модель…',{exact:true}).waitFor({state:'hidden'});
 assert.equal(apiRequests,1,'typing and reopening share the inventory download');
 await page.screenshot({path:`${out}/${width}-inventory.png`});
 console.log(JSON.stringify({width,directoryRequests,apiRequests,inputToSuggestionMs:timings}));await context.close();
}
 // An unreachable dictionary must not hide live inventory or spin forever;
 // retry must replace the rejected shared request.
 const context=await browser.newContext(),page=await context.newPage();
 await page.route('**/model-directory.*.json',route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const input=page.getByRole('searchbox',{name:'Модель автомобиля'});
 await input.fill('M6');await page.getByRole('button',{name:'M6 Haval'}).waitFor();
 await page.getByRole('button',{name:'Не удалось загрузить все модели. Повторить'}).waitFor();
 await page.unroute('**/model-directory.*.json');
 await page.getByRole('button',{name:'Не удалось загрузить все модели. Повторить'}).click();
 await input.fill('Corolla Cross');await page.getByRole('button').filter({has:page.getByText('Corolla Cross',{exact:true})}).waitFor();
 await context.close();
 const stalled=await browser.newContext(),stalledPage=await stalled.newPage();
 await stalledPage.route('**/api/catalog/models?scope=inventory',()=>{});
 await stalledPage.goto(`http://127.0.0.1:${server.address().port}`);
 await stalledPage.getByRole('searchbox',{name:'Модель автомобиля'}).fill('not-a-model');
 await stalledPage.getByRole('button',{name:'Не удалось загрузить все модели. Повторить'}).waitFor({timeout:16000});
 await stalledPage.getByText('Ищем модель…',{exact:true}).waitFor({state:'hidden'});
 await stalled.close();
 console.log('inventory-only models, pickup models, error retry and request deadline passed');
}finally{await browser.close();server.close();}
