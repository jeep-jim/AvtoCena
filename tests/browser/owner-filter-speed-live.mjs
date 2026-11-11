import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const marker=JSON.parse(fs.readFileSync('.github/market-runs/owner-filter-browser.json','utf8'));
const origin='https://avtocena.com';
const report={release:marker.release,phase:marker.phase,checkedAt:new Date().toISOString(),environment:'GitHub Actions Chromium external network; cards ready, not image completion; no VPN simulation',checks:[],passed:false};
let activePage;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',locale:'ru-RU'});
  const page=await context.newPage(),errors=[];activePage=page;page.on('pageerror',e=>errors.push(e.message));
  const health=await context.request.get(origin+'/api/health',{timeout:30000});assert.equal((await health.json()).releaseSha,marker.release);
  let requests=[],network=[],networkStarts=new Map();let sampleStarted=0;
  page.on('request',r=>{if(new URL(r.url()).origin===origin&&['document','fetch','xhr'].includes(r.resourceType())){requests.push(new URL(r.url()).pathname);networkStarts.set(r,performance.now());}});
  page.on('requestfinished',async r=>{
   const at=networkStarts.get(r);if(at===undefined||at<sampleStarted)return;
   const response=await r.response().catch(()=>null),timing=r.timing();
   network.push({path:new URL(r.url()).pathname,status:response?.status()??null,type:r.resourceType(),startedMs:Math.round(at-sampleStarted),headersMs:Math.round(timing.responseStart-timing.requestStart),completeMs:Math.round(timing.responseEnd-timing.requestStart),serverTiming:response?.headers()['server-timing']??null});
  });
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
   requests=[];network=[];const start=performance.now();sampleStarted=start;await input.press('Tab');
   if(width<1024)await panel.getByRole('button',{name:'Показать автомобили',exact:true}).click();
   await page.waitForURL(url=>url.searchParams.get('budget')===String(budget),{timeout:60000,waitUntil:'commit'});
   await page.locator('.ac-catalog-filter-panel[aria-busy="false"]').waitFor({state:'attached',timeout:60000});
   await cards.first().waitFor({timeout:60000});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const seconds=(performance.now()-start)/1000;
   const prices=await cards.locator('.ac-price').evaluateAll(nodes=>nodes.map(node=>Number(node.textContent.replace(/[^0-9]/g,''))).filter(n=>n>0));
   assert.ok(prices.length>0,'priced cards required');assert.ok(prices.every(price=>price<=budget),'visible prices must satisfy the selected budget');
   result.filters.push({budget,seconds:Number(seconds.toFixed(3)),cards:await cards.count(),pricedCards:prices.length,largestPrice:Math.max(...prices),requests:requests.length,paths:requests,network:[...network]});
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
 report.passed=true;
}catch(error){report.error=String(error.message).slice(0,800);if(activePage)report.failureState=await activePage.evaluate(()=>({url:location.href,inputs:Array.from(document.querySelectorAll('input[aria-label="Цена: до"]')).map(e=>({value:e.value,visible:!!e.offsetParent})),busy:Array.from(document.querySelectorAll('.ac-catalog-filter-panel')).map(e=>e.getAttribute('aria-busy'))})).catch(()=>null);throw error;}
finally{fs.writeFileSync('owner-filter-browser-report.json',JSON.stringify(report,null,2)+'\n');console.log('OWNER_FILTER_BROWSER',JSON.stringify(report));await browser.close();}
