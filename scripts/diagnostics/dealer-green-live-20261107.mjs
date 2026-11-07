import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='https://avtocena.com',expected=process.env.EXPECTED_RELEASE;
assert.match(expected||'',/^[a-f0-9]{40}$/);
const out='dealer-green-live';fs.mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),expected,scope:'Anonymous bounded public acceptance of the owner-reported dealer route; no writes, load test, VPN comparison or claim of complete horsepower coverage.',cases:[],failures:[]};
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
async function health(){const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(15000)});const h=await r.json();assert.equal(r.status,200);assert.equal(h.ok,true);assert.equal(h.releaseSha,expected);return {releaseSha:h.releaseSha,calculationVersion:h.calculationVersion};}
const inspect=()=>{
 const rect=s=>{const el=document.querySelector(s);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
 const cards=[...document.querySelectorAll('#catalog .ac-catalog-card,#catalog .ac-catalog-list-row')].filter(el=>el.getClientRects().length);
 const text=document.querySelector('#catalog')?.innerText||'';
 const nav=performance.getEntriesByType('navigation')[0];
 return {url:location.pathname+location.search,timeOrigin:performance.timeOrigin,banner:rect('.dealer-profile-home-banner'),heading:rect('#catalog .ac-catalog-heading'),results:rect('#catalog .ac-catalog-results'),sidebar:rect('#catalog .ac-catalog-sidebar'),footer:rect('.dealer-profile-footer'),directSharedRoot:!!document.querySelector('#catalog>.dealer-shared-catalog'),contexts:document.querySelectorAll('[data-dealer-context]').length,nestedDocks:document.querySelectorAll('.dealer-context-dock').length,cards:cards.length,headingText:document.querySelector('#catalog .ac-green-heading')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth+1,countIncomplete:/Количество уточняется/i.test(text),visibleErrors:['Не удалось загрузить эту страницу','Не удалось обновить автомобили','Источник отклонил подключение'].filter(t=>text.includes(t)),font:document.querySelector('#catalog h1')?getComputedStyle(document.querySelector('#catalog h1')).fontFamily:null,loadedOnest:[...document.fonts].some(f=>f.family.includes('Onest')&&f.status==='loaded'),protocol:nav?.nextHopProtocol,ttfbMs:nav?Math.round(nav.responseStart-nav.startTime):null,domMs:nav?Math.round(nav.domContentLoadedEventEnd-nav.startTime):null};
};
async function ready(page){await page.locator('#catalog .ac-green-heading').waitFor({state:'visible'});await page.waitForFunction(()=>[...document.querySelectorAll('#catalog a')].some(a=>a.textContent==='Аукционы Японии'&&Object.keys(a).some(k=>k.startsWith('__reactProps$'))),{},{timeout:20000});await page.evaluate(async()=>{await document.fonts.ready;});await page.waitForTimeout(250);}
let browser;
try{
 report.before=await health();browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const probe of [{width:1440,theme:'dark',power:false},{width:1024,theme:'light',power:false},{width:390,theme:'light',power:true}]){
  const context=await browser.newContext({viewport:{width:probe.width,height:1000},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(25000);
  const row={...probe,pageErrors:[],networkFailures:[]};
  page.on('pageerror',e=>row.pageErrors.push(String(e.message).slice(0,250)));
  page.on('requestfailed',request=>{const u=new URL(request.url());if(u.origin===origin&&row.networkFailures.length<30)row.networkFailures.push({path:u.pathname,error:request.failure()?.errorText||'',type:request.resourceType()});});
  try{
   const q=new URLSearchParams({make:'Nissan',market:'japan',stock:'green',city:'Новокузнецк',...(probe.power?{powerTo:'160'}:{})});
   const started=performance.now();const r=await page.goto(origin+'/dealers/avtograd?'+q,{waitUntil:'domcontentloaded',timeout:45000});row.status=r?.status();assert.equal(row.status,200);
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},probe.theme);await ready(page);row.readyMs=Math.round(performance.now()-started);row.initial=await page.evaluate(inspect);
   const g=row.initial;assert.equal(g.directSharedRoot,true);assert.equal(g.contexts,1);assert.equal(g.nestedDocks,0);assert.equal(g.overflow,false);assert.deepEqual(g.visibleErrors,[]);assert.ok(g.results.width>probe.width*.4);assert.ok(g.footer.y>=g.results.bottom-3);
   if(probe.width>=1024){assert.ok(Math.abs(g.heading.x-g.banner.x)<3);assert.ok(Math.abs(g.results.x-g.banner.x)<3);assert.ok(Math.abs(g.results.width-g.banner.width)<3);assert.ok(g.sidebar.x<g.banner.x);assert.ok(g.sidebar.y<=g.banner.y+3);}
   if(!probe.power)assert.ok(g.cards>0,'reported Nissan green search must show actual cards');
   await page.screenshot({path:`${out}/green-${probe.width}-${probe.theme}.png`,fullPage:true});
   const before=await page.evaluate(()=>performance.timeOrigin);const startClick=performance.now();
   await page.locator('#catalog').getByRole('link',{name:'Аукционы Японии',exact:true}).click();
   await page.waitForURL(u=>u.pathname==='/dealers/avtograd'&&u.searchParams.get('stock')!=='green',{timeout:45000});
   await page.locator('#catalog').getByRole('link',{name:'В наличии',exact:true}).waitFor({state:'visible'});
   row.auctionTransitionMs=Math.round(performance.now()-startClick);row.auctionSameDocument=await page.evaluate(()=>performance.timeOrigin)===before;assert.equal(row.auctionSameDocument,true);
   let url=new URL(page.url());assert.equal(url.searchParams.get('make'),'Nissan');assert.equal(url.searchParams.get('city'),'Новокузнецк');if(probe.power)assert.equal(url.searchParams.get('powerTo'),'160');
   const startBack=performance.now();await page.locator('#catalog').getByRole('link',{name:'В наличии',exact:true}).click();await ready(page);row.greenTransitionMs=Math.round(performance.now()-startBack);row.afterRoundTrip=await page.evaluate(inspect);assert.equal(row.afterRoundTrip.timeOrigin,before);assert.equal(row.afterRoundTrip.directSharedRoot,true);
   url=new URL(page.url());for(const [key,value] of q)assert.equal(url.searchParams.get(key),value);
   await page.reload({waitUntil:'domcontentloaded',timeout:45000});await ready(page);row.afterReload=await page.evaluate(inspect);assert.equal(row.afterReload.directSharedRoot,true);assert.equal(row.afterReload.contexts,1);assert.equal(row.afterReload.overflow,false);assert.deepEqual(row.pageErrors,[]);
   row.accepted=true;
  }catch(error){row.accepted=false;row.error=String(error.message).slice(0,500);report.failures.push(`${probe.width}:${probe.theme}:${row.error}`);await page.screenshot({path:`${out}/failure-${probe.width}-${probe.theme}.png`,fullPage:true}).catch(()=>{});}
  finally{report.cases.push(row);save();console.log('DEALER_GREEN_CASE',JSON.stringify(row));await context.close();}
 }
 report.after=await health();report.accepted=report.failures.length===0;report.completeCatalogPerformanceAccepted=false;
}catch(error){report.failures.push(String(error.message).slice(0,500));report.accepted=false;}
finally{await browser?.close();save();console.log('DEALER_GREEN_SUMMARY',JSON.stringify({expected,accepted:report.accepted,failures:report.failures}));}
if(!report.accepted)process.exitCode=1;
