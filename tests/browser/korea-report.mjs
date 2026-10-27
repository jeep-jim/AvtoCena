import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/korea-report';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/korea-report-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:out+'/app.js',loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
const css=await postcss([tailwindcss({content:['apps/web/components/catalog/OfferSpecificationsDisclosure.tsx','apps/web/components/catalog/OfferUpdatedStatus.tsx','apps/web/components/catalog/KoreaReportPanel.tsx','tests/browser/korea-report-fixture.tsx']}),autoprefixer]).process('@tailwind base;@tailwind components;@tailwind utilities;:root{--ac-border:#d8dce5;--ac-surface:#fff;--ac-surface-2:#f3f5f8;--ac-text:#121826;--ac-muted:#677186;font-family:Arial}body{background:var(--ac-surface);color:var(--ac-text)}.dark{--ac-border:#3b4352;--ac-surface:#191f28;--ac-surface-2:#283342;--ac-text:#fff;--ac-muted:#b1bdcd}',{from:undefined});
const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(out+'/app.js'));return;}if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));let calls=0,resolveReport;const held=new Promise(r=>resolveReport=r);
  await page.route('**/api/catalog/korea-report?*',async route=>{calls++;if(calls===1){await held;await route.fulfill({status:503,json:{error:'unavailable'}});return;}await route.fulfill({json:{version:1,offerId:'ajes-korea-fixture',observedAt:'2026-10-27T03:30:00Z',sections:[{kind:'history',title:'Страховая история',status:'available',rows:[{label:'Смена владельцев',value:'2'},{label:'Ремонт по страховке',value:'Нет сведений'}]},{kind:'inspection',title:'Осмотр автомобиля',status:'missing',rows:[]}]}});});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(t=>document.documentElement.className=t,theme);
  const trigger=page.locator('[data-korea-report-trigger]:visible');await trigger.waitFor();await page.waitForTimeout(250);assert.equal(calls,0,'no report request on page load');
  await trigger.click();await page.getByText('Загружаем историю и осмотр автомобиля…',{exact:true}).waitFor();await trigger.click();await trigger.click();assert.equal(calls,1,'closing and reopening must reuse pending request');resolveReport();
  await page.getByRole('button',{name:'Повторить',exact:true}).click();await page.getByText('Смена владельцев',{exact:true}).waitFor();assert.equal(calls,2);assert.equal(await page.getByText('Страховых случаев нет',{exact:true}).count(),0,'missing data cannot imply clean history');
  await trigger.click();await trigger.click();assert.equal(calls,2,'completed report reused on reopen');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
  if(width>1280){const box=await trigger.boundingBox(),spec=await page.getByRole('button',{name:'Все характеристики',exact:true}).boundingBox();assert.ok(Math.abs(box.y-spec.y)<2&&box.x>spec.x,'history sits beside specifications');}
  await page.screenshot({path:`${out}/${width}-${theme}.png`,fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: four viewport/theme cases; zero initial requests; one pending request; explicit retry; reuse; truthful missing reports; no overflow');
}finally{await browser.close();await new Promise(r=>server.close(r));}
