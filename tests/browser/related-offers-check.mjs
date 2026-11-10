import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const serveOnly=process.argv.includes('--serve-only');
const id='000000000000000000000001';
const city='Новокузнецк';
const out = 'artifacts/related-offers';
fs.mkdirSync(out,{recursive:true});
await build({
  entryPoints:['tests/browser/related-offers-fixture.tsx'],bundle:true,splitting:true,
  format:'esm',platform:'browser',jsx:'automatic',outdir:out,entryNames:'fixture',
  define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},
  plugins:[{name:'next-navigation-fixture',setup(builder){
    builder.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({
      contents:args.path==='next/link'
        ? `import React from 'react';export default function Link({prefetch,scroll,children,...props}){return React.createElement('a',props,children);}`
        : `export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);const router={push:href=>history.pushState({},'',href),replace:href=>history.replaceState({},'',href),prefetch:()=>{},back:()=>history.back()};export const useRouter=()=>router;`,
      loader:'jsx',resolveDir:process.cwd(),
    }));
  }}],
});
const sourceCss=['select-controls.css','globals.css','catalog-ui.css','public-polish.css','flat-ui.css','public-regression-fixes.css']
  .map(file=>fs.readFileSync('apps/web/app/'+file,'utf8')).join('\n');
const css=await postcss([tailwindcss({content:['tests/browser/related-offers-fixture.tsx','apps/web/components/{catalog,dealers,ui}/**/*.tsx']})])
  .process(sourceCss+`\n@tailwind base;@tailwind components;@tailwind utilities;
html{--ac-surface:#1b222c;--ac-surface-2:#303b4c;--ac-text:#fff;--ac-muted:#b8c0cd;--ac-border:#465368;background:#101722;color:#fff}
.related-fixture-page{max-width:1200px;margin:auto;padding:150px 16px 100px}
.related-fixture-controls{position:fixed;z-index:100;top:0;left:0;right:0;display:flex;gap:12px;align-items:center;padding:12px;background:#263244}
.related-fixture-controls label{display:flex;flex-direction:column;max-width:48%}.related-fixture-controls input{color:#111;background:#fff;min-width:0;width:100%}
.related-fixture-controls button{background:#c62626;color:#fff;padding:8px;border-radius:6px;min-height:44px}.related-fixture-controls output{min-width:20px}
.related-fixture-network{position:fixed;z-index:110;right:8px;bottom:80px;width:min(360px,calc(100vw - 16px));background:#edf4ff;color:#152238;border:2px solid #3076bd;padding:10px;border-radius:8px;font-size:12px}.related-fixture-network summary{cursor:pointer;font-weight:700}.related-fixture-network-actions{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.related-fixture-network button{border:1px solid #667;padding:5px;border-radius:5px;background:white;color:#152238}.related-fixture-network button:disabled{opacity:.45}.related-fixture-network pre{white-space:pre-wrap;max-height:150px;overflow:auto;font-size:11px}
`,{from:undefined});
fs.writeFileSync(`${out}/app.css`,css.css);
const html='<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
fs.writeFileSync(`${out}/index.html`,html);
let manualRequests=[];
const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(serveOnly&&url.pathname==='/api/catalog/related'){
    const entry={number:manualRequests.length+1,query:Object.fromEntries(url.searchParams),status:'pending',response};
    manualRequests.push(entry);
    response.on('close',()=>{if(entry.status==='pending')entry.status='aborted';});
    return;
  }
  if(serveOnly&&url.pathname.startsWith('/__fixture/')){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    if(url.pathname==='/__fixture/state'){
      response.end(JSON.stringify({count:manualRequests.length,pending:manualRequests.filter(entry=>entry.status==='pending').length,requests:manualRequests.map(({number,query,status})=>({number,query,status}))}));return;
    }
    if(request.method!=='POST'){response.writeHead(405);response.end('{}');return;}
    if(url.pathname==='/__fixture/reset'){
      for(const entry of manualRequests)if(entry.status==='pending'){entry.status='reset';entry.response.destroy();}
      manualRequests=[];response.end('{"ok":true}');return;
    }
    if(url.pathname==='/__fixture/respond'){
      const entry=manualRequests.find(entry=>entry.status==='pending'),mode=url.searchParams.get('mode');
      if(!entry||!['partial','success','failure'].includes(mode)){response.writeHead(409);response.end('{}');return;}
      entry.status=mode==='failure'?'HTTP 500':mode==='partial'?'HTTP 200 partial':'HTTP 200 complete';
      entry.response.writeHead(mode==='failure'?500:200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      entry.response.end(JSON.stringify(mode==='failure'?{error:'related_offers_unavailable'}:payload(mode==='partial')));
      response.end('{"ok":true}');return;
    }
    response.writeHead(404);response.end('{}');return;
  }
  if(url.pathname.startsWith('/api/')){
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify(url.pathname.includes('saved-previews')?{previews:{}}:url.pathname.includes('rates')?{rates:[]}:{ok:true,items:[],ids:[]}));
    return;
  }
  if(url.pathname==='/'||url.pathname.startsWith('/cars/offer/')){
    response.setHeader('Content-Type','text/html');response.end(html);return;
  }
  const root=/^\/(pdf-flags|brands)\//.test(url.pathname)?path.resolve('apps/web/public'):path.resolve(out);
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    response.writeHead(404);response.end();return;
  }
  response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
  response.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(serveOnly?Number(process.env.RELATED_OFFERS_PORT||4179):0,serveOnly?'0.0.0.0':'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
function offer(id,market='china'){
  return {id,market,make:'Toyota',model:'Camry',year:2024,mileageKm:20000,
    sourcePrice:150000,sourceCurrency:market==='korea'?'KRW':'CNY',sellerPriceRub:1700000,
    totalRub:null,catalogPricingMode:'seller',calculationStatus:'needs_data',
    engineCc:2000,powerHp:150,fuel:'petrol',transmission:'automatic',drive:'fwd',
    images:[],updatedAt:'2026-11-10T00:00:00Z'};
}
function payload(partial=true){
  return {current:{market:'china',liveStock:false,greenCurrent:false},
    make:'Toyota',familyModel:'Camry',modelTitle:'Toyota Camry',marketLabel:'Китай',marketTotal:3,
    stockModels:[],sameModel:[offer('000000000000000000000002')],
    crossMarketGroups:[{market:'korea',items:[offer('000000000000000000000003','korea')]}],
    marketRows:[offer('000000000000000000000004')],partial};
}
if(serveOnly){
  console.log(JSON.stringify({status:'serving',url:origin+'/cars/offer/'+id+'?'+new URLSearchParams({id,city,dealer:'dealer_fixture',preview:'1',manual:'1'}),manualControls:true}));
}else{
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[];
async function waitForRequests(requests,count){
  const limit=Date.now()+10000;
  while(requests.length<count&&Date.now()<limit)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(requests.length,count,`Expected exactly ${count} related requests`);
}
async function unchangedRequests(page,requests,count){
  await page.clock.fastForward(60_000);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(requests.length,count,'No automatic request retry or intersection repeat');
}
async function verifyLinks(page,dealer,width){
  const links=await page.locator('[data-related-offers] a[href]').evaluateAll(nodes=>nodes.map(node=>({href:node.getAttribute('href'),card:Boolean(node.closest('.ac-catalog-card'))})));
  assert.ok(links.length>=6,'Real recommendation cards and catalog links rendered');
  for(const {href,card} of links){
    const url=new URL(href,origin);
    // Existing cards preserve the selected city through shared client context.
    // Catalog/All links must additionally carry it in the navigation URL.
    if(!card)assert.equal(url.searchParams.get('city'),city,`${width}px catalog link retains city: ${href}`);
    if(dealer){
      if(url.pathname.startsWith('/cars/offer/')){
        assert.equal(url.searchParams.get('dealer'),'dealer_fixture');assert.equal(url.searchParams.get('preview'),'1');
      }else{assert.equal(url.pathname,'/nvkz/test-dealer');assert.equal(url.searchParams.get('preview'),'1');}
    }else assert.equal(url.searchParams.has('dealer'),false);
  }
}
async function setup(width,dealer,{failChunk=false}={}){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:width<640,hasTouch:width<640});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(value=>localStorage.setItem('avtocena_city',value),city);
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const chunkRequests=[];
  await page.route('**/RelatedOffersContent-*.js',route=>{
    chunkRequests.push(route.request().url());
    if(failChunk&&chunkRequests.length===1)return route.fulfill({status:503,headers:{'Cache-Control':'no-store'},contentType:'text/javascript',body:'temporarily unavailable'});
    return route.continue();
  });
  const requests=[];
  await page.route('**/api/catalog/related?*',route=>{requests.push(route);});
  const query=new URLSearchParams({id,city,...dealer?{dealer:'dealer_fixture',preview:'1'}:{}});
  await page.goto(origin+'/cars/offer/'+id+'?'+query);
  await page.locator('[data-related-offers-deferred]').waitFor();
  assert.equal(await page.evaluate(()=>typeof IntersectionObserver),'function','Use the real browser IntersectionObserver');
  const below=await page.locator('[data-related-offers-deferred]').evaluate(element=>element.getBoundingClientRect().top>innerHeight+240);
  assert.equal(below,true);
  await page.getByLabel('Заметка по автомобилю').fill('Заметка сохранена в форме');
  await page.locator('#primary-action').click();
  assert.equal(await page.locator('#primary-count').innerText(),'1');
  await unchangedRequests(page,requests,0);
  assert.equal(chunkRequests.length,0,'The recommendations bundle is not fetched before visibility');
  await page.locator('[data-related-offers-deferred]').evaluate(element=>window.scrollTo(0,window.scrollY+element.getBoundingClientRect().top-innerHeight-120));
  await waitForRequests(requests,1);
  const endpoint=new URL(requests[0].request().url());
  assert.equal(endpoint.searchParams.get('id'),id);
  assert.equal(endpoint.searchParams.get('dealer'),dealer?'dealer_fixture':null);
  assert.equal(endpoint.searchParams.get('preview'),dealer?'1':null);
  assert.equal(await page.locator('[data-related-offers-deferred]').getAttribute('aria-busy'),'true');
  await page.locator('#primary-action').click();
  assert.equal(await page.locator('#primary-count').innerText(),'2');
  assert.equal(await page.getByLabel('Заметка по автомобилю').inputValue(),'Заметка сохранена в форме');
  return {page,requests,errors,chunkRequests};
}
try{
  for(const width of [390,1440]){
    const {page,requests,errors}=await setup(width,true);
    await requests[0].fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload(true))});
    await page.locator('[data-related-offers] .ac-catalog-card').first().waitFor();
    assert.equal(await page.locator('[data-related-offers] .ac-catalog-card').count(),3);
    await verifyLinks(page,true,width);
    const originalLinks=await page.locator('[data-related-offers] .ac-catalog-card a[href]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
    await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
    await waitForRequests(requests,2);
    assert.equal(await page.locator('[data-related-offers] .ac-catalog-card').count(),3,'Retain partial rows during retry');
    await page.locator('#primary-action').click();
    assert.equal(await page.locator('#primary-count').innerText(),'3');
    await requests[1].fulfill({status:503,contentType:'application/json',body:'{"error":"related_offers_unavailable"}'});
    await page.getByRole('button',{name:'Повторить загрузку',exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('[data-related-offers-deferred]').hasAttribute('aria-busy'));
    assert.deepEqual(await page.locator('[data-related-offers] .ac-catalog-card a[href]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href'))),originalLinks,'Failed retry preserves visible partial rows');
    await unchangedRequests(page,requests,2);
    await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
    await waitForRequests(requests,3);
    assert.equal(await page.locator('[data-related-offers] .ac-catalog-card').count(),3);
    await requests[2].fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload(false))});
    await page.getByRole('button',{name:'Повторить загрузку',exact:true}).waitFor({state:'detached'});
    assert.equal(await page.getByLabel('Заметка по автомобилю').inputValue(),'Заметка сохранена в форме');
    await unchangedRequests(page,requests,3);
    assert.deepEqual(errors,[]);
    await page.locator('[data-related-offers]').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/${width}-related.png`,fullPage:false});
    results.push({width,dealer:true,initialRequests:0,nearViewportRequests:1,manualRetryRequests:2,partialCardsPreserved:3,pageErrors:errors.length});
    await page.close();

    const failed=await setup(width,false);
    await failed.requests[0].fulfill({status:500,contentType:'application/json',body:'{"error":"related_offers_unavailable"}'});
    await failed.page.getByText('Не удалось загрузить похожие автомобили. Попробуйте ещё раз.',{exact:true}).waitFor();
    await failed.page.locator('#primary-action').click();
    assert.equal(await failed.page.locator('#primary-count').innerText(),'3');
    await unchangedRequests(failed.page,failed.requests,1);
    await failed.page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
    await waitForRequests(failed.requests,2);
    await failed.requests[1].fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload(false))});
    await failed.page.locator('[data-related-offers] .ac-catalog-card').first().waitFor();
    await verifyLinks(failed.page,false,width);
    assert.equal(await failed.page.locator('[data-related-offers] .ac-catalog-card').count(),3);
    assert.deepEqual(failed.errors,[]);
    results.push({width,dealer:false,initialRequests:0,nearViewportRequests:1,manualRetryRequests:1,initialFailureRecovered:true,pageErrors:failed.errors.length});
    await failed.page.close();

    // Fail the actual deferred module request after a successful data response.
    // A secondary chunk failure must never unmount the primary offer/form.
    const chunkFailure=await setup(width,false,{failChunk:true});
    await chunkFailure.requests[0].fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload(false))});
    const localFailure=chunkFailure.page.getByText('Не удалось загрузить похожие автомобили. Попробуйте ещё раз.',{exact:true});
    await localFailure.waitFor();
    assert.equal(chunkFailure.chunkRequests.length,1);
    assert.equal(await chunkFailure.page.locator('[data-primary-details]').isVisible(),true);
    await chunkFailure.page.locator('#primary-action').click();
    assert.equal(await chunkFailure.page.locator('#primary-count').innerText(),'3');
    assert.equal(await chunkFailure.page.getByLabel('Заметка по автомобилю').inputValue(),'Заметка сохранена в форме');
    assert.deepEqual(chunkFailure.errors,[],'Chunk rejection is handled locally, not by a page error boundary');
    await unchangedRequests(chunkFailure.page,chunkFailure.requests,1);
    assert.equal(chunkFailure.chunkRequests.length,1,'No automatic chunk retry');
    await chunkFailure.page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
    await waitForRequests(chunkFailure.requests,2);
    await chunkFailure.requests[1].fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload(false))});
    await chunkFailure.page.waitForFunction(()=>!document.querySelector('[data-related-offers-deferred]').hasAttribute('aria-busy'));
    const chunkRetryRecovered=await chunkFailure.page.locator('[data-related-offers] .ac-catalog-card').first().isVisible();
    // This fixture uses native ESM, whose failed-module cache can differ from
    // Next's webpack loader. Record recovery only when it actually occurred;
    // either outcome must preserve the form and stay under manual control.
    if(chunkRetryRecovered){
      assert.equal(await chunkFailure.page.locator('[data-related-offers] .ac-catalog-card').count(),3);
      await verifyLinks(chunkFailure.page,false,width);
    }else await localFailure.waitFor();
    await chunkFailure.page.locator('#primary-action').click();
    assert.equal(await chunkFailure.page.locator('#primary-count').innerText(),'4');
    assert.equal(await chunkFailure.page.getByLabel('Заметка по автомобилю').inputValue(),'Заметка сохранена в форме');
    assert.deepEqual(chunkFailure.errors,[]);
    const chunkAttemptCount=chunkFailure.chunkRequests.length;
    assert.ok(chunkAttemptCount>=1&&chunkAttemptCount<=2);
    await unchangedRequests(chunkFailure.page,chunkFailure.requests,2);
    assert.equal(chunkFailure.chunkRequests.length,chunkAttemptCount);
    results.push({width,chunkFailureIsolated:true,formPreserved:true,manualRetryRequests:1,chunkRetryRecovered,chunkRequests:chunkAttemptCount,pageErrors:chunkFailure.errors.length});
    await chunkFailure.page.close();
  }
  fs.writeFileSync(`${out}/report.json`,JSON.stringify({results},null,2)+'\n');
  console.log(JSON.stringify({status:'PASS',results}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
