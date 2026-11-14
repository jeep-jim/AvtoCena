import assert from 'node:assert/strict';
import fs from 'node:fs';
import {acceptedBrowserSpeed} from '../../scripts/lib/accepted-browser-speed.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const marker=JSON.parse(fs.readFileSync(process.env.OWNER_FILTER_BROWSER_MARKER||'.github/market-runs/owner-filter-browser.json','utf8'));
const origin='https://avtocena.com';
const report={release:marker.release,phase:marker.phase,checkedAt:new Date().toISOString(),environment:'GitHub Actions Chromium external network; cards ready, not image completion; no VPN simulation',checks:[],passed:false};
let activePage;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',locale:'ru-RU'});
  const page=await context.newPage(),errors=[];activePage=page;page.on('pageerror',e=>errors.push(e.message));
  const health=await context.request.get(origin+'/api/health',{timeout:30000});assert.equal((await health.json()).releaseSha,marker.release);
  let requests=[],networkStarts=new Map();let sampleStarted=0;
  page.on('request',r=>{
   if(new URL(r.url()).origin!==origin||!['document','fetch','xhr'].includes(r.resourceType()))return;
   const url=new URL(r.url()),at=performance.now(),headers=r.headers();
   requests.push(url.pathname);
   networkStarts.set(r,{path:url.pathname,budget:url.searchParams.get('budget'),type:r.resourceType(),requestAt:at,status:null,responseAt:null,finishAt:null,failed:false,rsc:headers.rsc==='1',prefetch:headers['next-router-prefetch']==='1'});
  });
  page.on('response',response=>{
   const row=networkStarts.get(response.request());if(!row)return;
   row.status=response.status();row.responseAt=performance.now();row.serverTiming=response.headers()['server-timing']??null;
  });
  page.on('requestfinished',r=>{const row=networkStarts.get(r);if(row)row.finishAt=performance.now();});
  page.on('requestfailed',r=>{const row=networkStarts.get(r);if(row){row.finishAt=performance.now();row.failed=true;}});
  const networkSnapshot=()=>[...networkStarts.values()].filter(r=>r.requestAt>=sampleStarted||r.finishAt===null||r.finishAt>=sampleStarted).map(r=>({
   path:r.path,budget:r.budget,type:r.type,status:r.status,startedMs:Math.round(r.requestAt-sampleStarted),
   headersMs:r.responseAt===null?null:Math.round(r.responseAt-r.requestAt),
   completeMs:r.finishAt===null?null:Math.round(r.finishAt-r.requestAt),
   pending:r.finishAt===null,failed:r.failed,rsc:r.rsc,prefetch:r.prefetch,serverTiming:r.serverTiming??null
  }));
  const started=performance.now();
  assert.equal((await page.goto(origin+'/cars/china',{waitUntil:'domcontentloaded',timeout:90000})).status(),200);
  const cards=page.locator('article.ac-catalog-card,article.ac-catalog-list-row');await cards.first().waitFor({timeout:60000});
  const firstCardsSeconds=(performance.now()-started)/1000;
  await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Открыть фильтры"]');return b&&!b.disabled;},null,{timeout:60000});
  const consent=page.getByRole('button',{name:'Хорошо',exact:true});if(await consent.isVisible())await consent.click();
  const result={width,firstCardsSeconds:Number(firstCardsSeconds.toFixed(3)),filters:[]};report.checks.push(result);
  for(const budget of [1500000,2000000]){
   if(width<1024)await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
   const panel=width<1024?page.getByRole('dialog',{name:'Фильтры каталога'}):page.locator('.ac-catalog-filter-panel');
   const input=panel.getByRole('textbox',{name:'Цена: до',exact:true});await input.fill(String(budget));
   requests=[];const start=performance.now();sampleStarted=start;await input.press('Tab');
   if(width<1024)await panel.getByRole('button',{name:'Показать автомобили',exact:true}).click();
   await page.waitForURL(url=>url.searchParams.get('budget')===String(budget),{timeout:60000,waitUntil:'commit'});
   await page.locator('.ac-catalog-filter-panel[aria-busy="false"]').waitFor({state:'attached',timeout:60000});
   await cards.first().waitFor({timeout:60000});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const seconds=(performance.now()-start)/1000;
   const prices=await cards.locator('.ac-price').evaluateAll(nodes=>nodes.map(node=>Number(node.textContent.replace(/[^0-9]/g,''))).filter(n=>n>0));
   assert.ok(prices.length>0,'priced cards required');assert.ok(prices.every(price=>price<=budget),'visible prices must satisfy the selected budget');
   result.filters.push({budget,seconds:Number(seconds.toFixed(3)),cards:await cards.count(),pricedCards:prices.length,largestPrice:Math.max(...prices),requests:requests.length,paths:requests,network:networkSnapshot()});
  }
  result.pageErrors=errors;assert.deepEqual(errors,[]);
  const ending=await context.request.get(origin+'/api/health',{timeout:30000});assert.equal((await ending.json()).releaseSha,marker.release);
  await context.close();
 }
 report.browserPassed=true;
 if(marker.verifyPartnerBudgets){
  const context=await browser.newContext({serviceWorkers:'block'});
  report.partnerBudgets=[];
  for(const market of ['japan','korea']){
   const params=new URLSearchParams({market,budgetTo:'1500000',pageSize:'6',city:'Москва'});
   const started=performance.now();
   const response=await context.request.get(origin+'/api/catalog/search?'+params,{timeout:35000});
   const value=await response.json().catch(()=>({}));
   report.partnerBudgets.push({market,status:response.status(),seconds:Number(((performance.now()-started)/1000).toFixed(3)),items:Array.isArray(value.items)?value.items.length:0,total:value.total??null,partial:!!value.partial,stale:!!value.stale,hasMore:!!value.hasMore,interrupted:!!value.interrupted,reads:value.reads??null,nextCursor:value.nextCursor??null,error:typeof value.error==='string'&&/^[a-z_]{1,64}$/.test(value.error)?value.error:null,serverTiming:response.headers()['server-timing']??null});
  }
  await context.close();
  report.partnerBudgetsReady=report.partnerBudgets.every(r=>r.status===200&&r.items>0&&!r.partial&&!r.stale);
  assert.ok(report.partnerBudgetsReady,'Japan/Korea budget availability remains unconfirmed; inspect source state');
 }
 if(marker.enforceSpeed){
  report.speedGuard=acceptedBrowserSpeed(report,JSON.parse(fs.readFileSync('docs/operations/2026-11-11-accepted-browser-speed-baseline.json','utf8')));
  assert.ok(report.speedGuard.passed,'accepted_browser_speed_regression');
 }
 // Additional functional scenarios run after frozen speed measurements.
 if(marker.verifyJapanAndSpecials){
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',locale:'ru-RU'});
  const page=await context.newPage();activePage=page;
  const health=await context.request.get(origin+'/api/health',{timeout:30000});assert.equal((await health.json()).releaseSha,marker.release);
  report.homeSpecials=[];
  for(const city of ['Новокузнецк','Москва']){
   const started=performance.now();
   assert.equal((await page.goto(origin+'/?city='+encodeURIComponent(city),{waitUntil:'domcontentloaded',timeout:90000})).status(),200);
   const cards=page.locator('[data-site-block="specials"] a.ac-special-card');
   await cards.first().waitFor({state:'visible',timeout:45000});
   const hrefs=await cards.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
   assert.ok(hrefs.length>0,'homepage special offers must be present in '+city);
   report.homeSpecials.push({city,hrefs,seconds:Number(((performance.now()-started)/1000).toFixed(3))});
  }
  const nk=report.homeSpecials[0].hrefs,moscow=new Set(report.homeSpecials[1].hrefs);
  assert.ok(nk.every(href=>moscow.has(href)),'hometown special offers must remain visible in Moscow');
  const started=performance.now();
  assert.equal((await page.goto(origin+'/cars?market=japan&powerTo=160',{waitUntil:'domcontentloaded',timeout:90000})).status(),200);
  const cards=page.locator('article.ac-catalog-card,article.ac-catalog-list-row');
  await cards.first().waitFor({state:'visible',timeout:60000});
  const texts=await cards.allTextContents();
  assert.ok(texts.length>0,'Japan <=160 must show actual cards');
  for(const text of texts){
   const matches=[...text.matchAll(/(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)*)\s*л\.с\./g)];
   assert.ok(matches.length>0,'each Japan card must show its power');
   assert.ok(matches.every(m=>m[1].split('/').every(v=>Number(v.trim().replace(',','.'))>0&&Number(v.trim().replace(',','.'))<=160)),'displayed Japan power must satisfy <=160');
  }
  report.japanPower={cards:texts.length,seconds:Number(((performance.now()-started)/1000).toFixed(3)),passed:true};
  const ending=await context.request.get(origin+'/api/health',{timeout:30000});assert.equal((await ending.json()).releaseSha,marker.release);
  await context.close();
 }
 if(marker.verifyTruckGrid){
  const context=await browser.newContext({viewport:{width:1920,height:1080},serviceWorkers:'block',locale:'ru-RU'});
  const page=await context.newPage();activePage=page;
  report.truckAdmission=[];
  for(const path of ['/','/cars','/cars?market=japan']){
   assert.equal((await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:90000})).status(),200);
   const scope=path!=='/cars?market=japan'?page.locator('section[aria-label="Япония"]'):page;
   const accepted=scope.locator('article.ac-catalog-card,article.ac-catalog-list-row');
   await accepted.first().waitFor({state:'visible',timeout:60000});
   const labels=await accepted.allTextContents();
   assert.ok(labels.length>0,'real admitted cars required');
   assert.equal(labels.length,path==='/cars?market=japan'?24:5,'Japan must show five overview cards or 24 catalog cards');
   if(path!=='/cars?market=japan'){
    const stock=page.locator('section[aria-label="Зелёный угол"] article.ac-catalog-card');
    assert.equal(await stock.count(),5,'Green corner must show five admitted cards');
   }
   for(const label of labels)assert.doesNotMatch(label,/NISSAN\s+(?:UD\s+SERIES|CONDOR)|(?:MITSUBISHI\s+)?FUSO\s+FIGHTER/i,'owner screenshot truck must not be published');
   report.truckAdmission.push({path,cards:labels.length,passed:true});
  }
  await context.close();
 }
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.message).slice(0,800);if(activePage)report.failureState=await activePage.evaluate(()=>({url:location.href,inputs:Array.from(document.querySelectorAll('input[aria-label="Цена: до"]')).map(e=>({value:e.value,visible:!!e.offsetParent})),busy:Array.from(document.querySelectorAll('.ac-catalog-filter-panel')).map(e=>e.getAttribute('aria-busy'))})).catch(()=>null);throw error;}
finally{fs.writeFileSync('owner-filter-browser-report.json',JSON.stringify(report,null,2)+'\n');console.log('OWNER_FILTER_BROWSER',JSON.stringify(report));await browser.close();}
