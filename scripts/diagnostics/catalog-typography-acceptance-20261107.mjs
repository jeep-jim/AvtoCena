import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire('/tmp/catalog-browser/package.json')('playwright');
const root=process.cwd(),out=path.join(root,'typography-output');await fs.mkdir(out,{recursive:true});
const next=createRequire(path.join(root,'apps/web/package.json')).resolve('next/dist/bin/next');
const child=spawn(process.execPath,['--import',path.join(root,'tests/helpers/offline-fetch.mjs'),next,'start','-p','3100'],{cwd:path.join(root,'apps/web'),env:{...process.env,NODE_ENV:'production',JSON_STORAGE_DRIVER:'local',AVTOCENA_RELEASE_SHA:'',CATALOG_LIVE_RATE_DISABLED:'true',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>{logs=(logs+b).slice(-50000)});child.stderr.on('data',b=>{logs=(logs+b).slice(-50000)});
let browser;const report={candidate:'aaceff2851aa1b290b0bec3814d294c3a93869d6',scope:'local production build only; no production storage, users, source calls or live inventory acceptance',views:[],redirect:null};
try{
 let ready=false;for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:3100/api/health',{signal:AbortSignal.timeout(1500)});if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,'isolated Next server did not start');
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[1440,1000],[390,844]]){
  for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height},colorScheme:theme}),page=await context.newPage();
   const fontResponses=[],external=[];page.on('response',r=>{if(/\.woff2(?:\?|$)/.test(r.url()))fontResponses.push({url:new URL(r.url()).pathname,status:r.status()})});
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:')return route.continue();external.push(u.origin);return route.abort();});
   const response=await page.goto('http://127.0.0.1:3100/privacy',{waitUntil:'domcontentloaded',timeout:30000});assert.equal(response?.status(),200);
   await page.evaluate(async(theme)=>{document.documentElement.dataset.theme=theme;await document.fonts.ready;},theme);
   const view=await page.evaluate(()=>({family:getComputedStyle(document.body).fontFamily,loaded:document.fonts.check('400 16px "Onest Variable"'),visibleH1:[...document.querySelectorAll('h1')].filter(e=>e.getBoundingClientRect().height>0).map(e=>({text:e.textContent,font:getComputedStyle(e).fontFamily,weight:getComputedStyle(e).fontWeight})),documentWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
   assert.match(view.family,/Onest/);assert.equal(view.loaded,true);assert.equal(view.visibleH1.length,1);assert.ok(fontResponses.some(x=>x.status===200),'self-hosted WOFF2 must load');
   assert.ok(fontResponses.every(x=>x.url.startsWith('/_next/static/')),'fonts must come from own build');
   const row={width,height,theme,...view,fontResponses,blockedExternalOrigins:[...new Set(external)]};report.views.push(row);console.log('TYPOGRAPHY_ACCEPTANCE',JSON.stringify(row));
   await page.screenshot({path:path.join(out,`${width}-${theme}.png`)});await context.close();
  }
 }
 const response=await fetch('http://127.0.0.1:3100/cars?market=china&powerTo=160&city=Kemerovo&page=2',{redirect:'manual',signal:AbortSignal.timeout(10000)});
 assert.equal(response.status,308);const target=new URL(response.headers.get('location'),'http://127.0.0.1:3100');assert.equal(target.pathname,'/cars/china');assert.equal(target.searchParams.get('powerTo'),'160');assert.equal(target.searchParams.get('city'),'Kemerovo');assert.equal(target.searchParams.get('page'),'2');
 report.redirect={status:response.status,target:target.pathname+target.search};report.ok=true;
}catch(error){report.ok=false;report.error=String(error);process.exitCode=1;}
finally{if(browser)await browser.close();child.kill('SIGTERM');await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(out,'local-server.log'),logs);console.log('BROWSER_ACCEPTANCE_RESULT',JSON.stringify({ok:report.ok,error:report.error,candidate:report.candidate}));}
