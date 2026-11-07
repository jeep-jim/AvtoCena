import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='https://avtocena.com',expected=process.env.EXPECTED_RELEASE,out='catalog-single-rail-live';
assert.match(expected||'',/^[a-f0-9]{40}$/);fs.mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),expected,scope:'Two bounded anonymous public routes; single measurements, not load/VPN testing or full inventory acceptance.',routes:[],failures:[]};
async function health(){const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(15000)}),h=await r.json();assert.equal(r.ok,true);assert.equal(h.releaseSha,expected);return {releaseSha:h.releaseSha,calculationVersion:h.calculationVersion};}
let browser;
try{
 report.before=await health();browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const path of ['/cars','/cars/china']){
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage(),row={path,errors:[],networkFailures:[]};
  page.on('pageerror',e=>row.errors.push(String(e.message).slice(0,250)));page.on('requestfailed',request=>{const u=new URL(request.url());if(u.origin===origin&&row.networkFailures.length<20)row.networkFailures.push({path:u.pathname,type:request.resourceType(),error:request.failure()?.errorText||''});});
  try{
   const start=performance.now(),r=await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:45000});row.status=r?.status();row.domWaitMs=Math.round(performance.now()-start);
   await page.locator('.ac-brand-rail').first().waitFor({state:'attached',timeout:20000});await page.evaluate(async()=>{await document.fonts.ready;});await page.waitForTimeout(500);
   Object.assign(row,await page.evaluate(()=>{const nav=performance.getEntriesByType('navigation')[0],rails=[...document.querySelectorAll('.ac-brand-rail')],visible=e=>e.getClientRects().length>0;return {railCount:rails.length,logoImages:rails.reduce((n,rail)=>n+rail.querySelectorAll('img').length,0),uniqueLogoSources:new Set(rails.flatMap(r=>[...r.querySelectorAll('img')].map(i=>i.getAttribute('src')))).size,cardCount:[...document.querySelectorAll('.ac-catalog-card,.ac-catalog-list-row')].filter(visible).length,h1:[...document.querySelectorAll('h1')].filter(visible).map(e=>e.textContent),protocol:nav?.nextHopProtocol,ttfbMs:nav?Math.round(nav.responseStart-nav.startTime):null,htmlDecodedBytes:nav?.decodedBodySize||null,overflow:document.documentElement.scrollWidth>innerWidth+1,visibleError:document.body.innerText.includes('Не удалось загрузить эту страницу')};}));
   assert.equal(row.status,200);assert.equal(row.railCount,1);assert.equal(row.overflow,false);assert.equal(row.visibleError,false);assert.ok(row.cardCount>0);assert.equal(row.h1.length,1);assert.deepEqual(row.errors,[]);await page.screenshot({path:out+'/'+(path==='/cars'?'all':'china')+'.png'});row.accepted=true;
  }catch(error){row.accepted=false;row.error=String(error.message).slice(0,400);report.failures.push(path+':'+row.error);await page.screenshot({path:out+'/'+(path==='/cars'?'all':'china')+'-failure.png'}).catch(()=>{});}
  finally{report.routes.push(row);console.log('SINGLE_RAIL_LIVE',JSON.stringify(row));fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await context.close();}
 }
 report.after=await health();report.accepted=report.failures.length===0;report.completeCatalogPerformanceAccepted=false;
}catch(error){report.failures.push(String(error.message).slice(0,400));report.accepted=false;}
finally{await browser?.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
if(!report.accepted)process.exitCode=1;
