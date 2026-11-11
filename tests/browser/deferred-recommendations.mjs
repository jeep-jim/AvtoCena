import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/deferred-recommendations';fs.mkdirSync(out,{recursive:true});
const fixture={name:'next-fixture',setup(b){
  b.onResolve({filter:/^next\/(navigation|link)$|\/CatalogCard$|^\.\/CatalogCard$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path==='next/navigation'?`export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>history.pushState(null,'',url),prefetch:()=>{}});`:a.path==='next/link'?`import React from 'react';export default function Link({prefetch,scroll,children,...props}){return <a {...props}>{children}</a>;}`:`import React from 'react';export const CatalogCard=({offer})=><article data-offer-id={offer.id}>{offer.make} {offer.model}</article>;`}));
}};
await build({entryPoints:['tests/browser/deferred-recommendations-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:out+'/fixture.js',tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},plugins:[fixture]});
const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8');
  res.end(req.url==='/fixture.js'?fs.readFileSync(out+'/fixture.js'):'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[];
const row=id=>({id,make:'BMW',model:'3 Series'});
function payload(id,kind){return kind==='alternatives'?{kind,title:'Другие автомобили BMW',items:[row(id)],partial:false}:{kind,current:{id,market:'china'},make:'BMW',familyModel:'3 Series',greenCurrent:false,modelTitle:'BMW 3 Series',marketLabel:'Китай',marketTotal:891,stockModels:[],sameModel:[row(id)],crossMarketGroups:[{market:'japan',items:[row('japan-'+id)]}],marketRows:[row('market-'+id)],partial:false};}
try{
  for(const width of [390,1280])for(const kind of ['related','alternatives']){
    const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage();
    const calls=[],errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await context.addInitScript(()=>localStorage.setItem('avtocena_city','Новокузнецк'));
    let fail=false,hold=false,release;
    await context.route('**/api/catalog/recommendations?*',async route=>{
      const url=new URL(route.request().url());calls.push(Object.fromEntries(url.searchParams));
      if(hold)await new Promise(resolve=>release=resolve);
      try{await route.fulfill({status:fail?503:200,json:fail?{error:'recommendations_busy'}:payload(url.searchParams.get('id'),kind)});}catch{}
    });
    await page.goto(origin+(kind==='alternatives'?'/?alternatives=1':'/'));
    await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
    await page.waitForTimeout(350);assert.equal(calls.length,0,'initial page must not start any recommendation query');
    assert.equal(await page.locator('h1').textContent(),'Основная карточка');
    await page.locator('[data-deferred-recommendations]').scrollIntoViewIfNeeded();
    await page.locator('[data-offer-id="first"]').waitFor();assert.equal(calls.length,1);
    assert.deepEqual(calls[0],{kind,id:'first',markets:'china,japan'});
    if(kind==='related'){
      assert.match(await page.locator('[data-related-section="market-model"]').textContent(),/Ещё BMW 3 Series/);
      const href=await page.locator('[data-related-section="market-model"] a').getAttribute('href');
      const q=new URL(href,origin).searchParams;assert.equal(q.get('city'),'Новокузнецк');assert.equal(new URL(href,origin).pathname,'/dealers/dealer_topavto');assert.equal(q.get('model'),'3 Series');
    }
    await page.evaluate(()=>scrollTo(0,0));await page.locator('[data-deferred-recommendations]').scrollIntoViewIfNeeded();await page.waitForTimeout(200);assert.equal(calls.length,1,'re-entering viewport must not refetch');
    fail=true;
    await page.locator('#next-offer').click();await page.locator('[data-deferred-recommendations]').scrollIntoViewIfNeeded();
    const retry=page.getByRole('button',{name:'Повторить',exact:true});await retry.waitFor();
    assert.equal(await page.locator('[data-offer-id="first"]').count(),0,'a new identity must discard old recommendations');
    assert.equal(calls.length,2);await page.waitForTimeout(250);assert.equal(calls.length,2,'failure must not start an automatic retry loop');
    fail=false;await retry.click();await page.locator('[data-offer-id="second"]').waitFor();assert.equal(calls.length,3);
    // Navigate away while a request is pending; aborted work cannot render late.
    hold=true;release=undefined;await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
    await page.locator('[data-deferred-recommendations]').scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelector('[data-deferred-recommendations]')?.getAttribute('aria-busy')==='true');
    for(let i=0;!release&&i<1000;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(release,'pending request must reach the test server');
    hold=false;await page.locator('#next-offer').click();release();
    await page.locator('[data-deferred-recommendations]').scrollIntoViewIfNeeded();await page.locator('[data-offer-id="second"]').waitFor();
    assert.equal(await page.locator('[data-offer-id="first"]').count(),0);assert.deepEqual(errors,[]);
    results.push({width,kind,noInitialQuery:true,oneQueryOnScroll:true,retry:true,navigationIsolation:true,dealerCityLinks:kind==='related'});
    await context.close();
  }
  fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({ok:true,checks:results},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
