import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import {defaultCollectionControls} from '../../apps/web/lib/catalog/collection-controls-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/collection-controls';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/collection-controls-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'}});
const css=await postcss([tailwindcss({content:['apps/web/components/site/CollectionControls.tsx'],theme:{extend:{}},plugins:[]})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'application/javascript':'text/html');res.end(req.url==='/fixture.js'?fs.readFileSync(`${out}/fixture.js`):`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}:root{--ac-border:#ddd;--ac-muted:#62676f}body{padding:16px;color:#182235}h1{font-size:24px;font-weight:bold;margin-bottom:20px}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let controls=defaultCollectionControls(),gets=0,puts=0,conflict=false;
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
 await page.getByText('Обновление каталога · парсеры и фиды',{exact:true}).click();
 const feed=page.getByRole('switch',{name:'Che168 · платный фид',exact:true}),reserve=page.getByRole('switch',{name:'Che168 · резервный парсер',exact:true}),market=page.getByRole('switch',{name:'Обновление рынка Китай',exact:true});
 await feed.waitFor();assert.equal(await feed.getAttribute('aria-checked'),'true');assert.equal(await reserve.getAttribute('aria-checked'),'false');
 await market.click();await page.getByRole('status').waitFor();assert.equal(await feed.getAttribute('aria-checked'),'true');await page.getByText('Остановлен выключателем рынка',{exact:true}).waitFor();
 await market.click();await feed.click();await reserve.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Che168 · резервный парсер"]')?.getAttribute('aria-checked')==='true');assert.equal(puts,4);
 await page.getByText('Источник, частота и настройки',{exact:true}).nth(1).click();
 await page.getByText(/Прямой сбор подержанных автомобилей/).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no mobile overflow');
 await page.screenshot({path:`${out}/controls-${width}.png`,fullPage:true});
 conflict=true;await reserve.click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('switch').count(),0,'unknown state is not displayed as saved');
 await page.getByRole('button',{name:'Обновить состояние',exact:true}).click();await reserve.waitFor();assert.equal(await reserve.getAttribute('aria-checked'),'true');
 assert.deepEqual(errors,[]);await page.close();console.log(`Owner controls ${width}: passed`);
}}finally{await browser.close();server.close();}
