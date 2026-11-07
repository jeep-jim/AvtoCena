import fs from 'node:fs';
import {chromium} from '/tmp/catalog-readback/node_modules/playwright/index.mjs';
const origin='https://avtocena.com';
const expected=process.env.EXPECTED_RELEASE;
if(!/^[a-f0-9]{40}$/.test(expected||''))throw Error('expected_release_required');
const out='catalog-release-readback';fs.mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),expected,scope:'Anonymous public readback; no authenticated writes, bulk collection, VPN comparison or load test',routes:[],redirects:[],failures:[]};
async function health(){const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(15000)});const v=await r.json();if(!r.ok||v.ok!==true||v.releaseSha!==expected)throw Error('exact_release_not_active');return {releaseSha:v.releaseSha,calculationVersion:v.calculationVersion};}
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
const countries={china:'Китая',japan:'Японии',korea:'Кореи',uae:'ОАЭ',europe:'Европы',georgia:'Грузии'};
let browser;
try{
 report.before=await health();
 for(const market of ['china','japan','korea']){
  const input=new URL('/cars',origin);input.searchParams.set('market',market);input.searchParams.set('powerTo','160');input.searchParams.set('city','Новокузнецк');input.searchParams.set('page','2');
  const r=await fetch(input,{redirect:'manual',signal:AbortSignal.timeout(20000)}),loc=r.headers.get('location');await r.body?.cancel();
  const u=loc?new URL(loc,origin):null;
  const ok=[301,308].includes(r.status)&&u?.pathname==='/cars/'+market&&u.searchParams.get('powerTo')==='160'&&u.searchParams.get('city')==='Новокузнецк'&&u.searchParams.get('page')==='2';
  report.redirects.push({market,status:r.status,location:u?.pathname,parametersPreserved:ok});if(!ok)report.failures.push('legacy_redirect_'+market);
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const probes=[{key:'all',path:'/cars',width:1440,theme:'dark'},...Object.keys(countries).flatMap(market=>[false,true].map(power=>({key:market+(power?'160':''),path:'/cars/'+market+(power?'?powerTo=160':''),market,width:1440,theme:'light'}))),{key:'china-mobile',path:'/cars/china?city='+encodeURIComponent('Новокузнецк'),market:'china',width:390,theme:'light'},{key:'korea-mobile',path:'/cars/korea',market:'korea',width:390,theme:'dark'}];
 let offerPath=null;
 for(const probe of probes){
  const context=await browser.newContext({viewport:{width:probe.width,height:1000},serviceWorkers:'block'});
  const page=await context.newPage();let pageErrors=0,failedSameOriginRequests=0;
  page.on('pageerror',()=>{pageErrors++;});page.on('requestfailed',req=>{if(req.url().startsWith(origin))failedSameOriginRequests++;});
  const row={...probe,pageErrors:0};const started=performance.now();
  try{
   const response=await page.goto(origin+probe.path,{waitUntil:'domcontentloaded',timeout:45000});row.status=response?.status();row.domWaitMs=Math.round(performance.now()-started);
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},probe.theme);
   await page.waitForTimeout(1500);
   Object.assign(row,await page.evaluate(()=>{
    const visible=el=>el.getClientRects().length>0;
    const heads=[...document.querySelectorAll('h1')].filter(visible);
    const cards=[...document.querySelectorAll('.ac-catalog-card,.ac-catalog-list-row')].filter(visible);
    const text=document.body.innerText;
    const warnings=['Не удалось загрузить эту страницу','Не удалось обновить автомобили','Не удалось загрузить автомобили этого направления','Источник отклонил подключение'];
    const nav=performance.getEntriesByType('navigation')[0];
    return {url:location.pathname+location.search,h1:heads.map(el=>el.innerText),font:heads[0]?getComputedStyle(heads[0]).fontFamily:null,title:document.title,canonical:document.querySelector('link[rel=canonical]')?.getAttribute('href')||null,robots:document.querySelector('meta[name=robots]')?.getAttribute('content')||null,cards:cards.length,offerLinks:[...new Set([...document.querySelectorAll('a[href*="/cars/offer/"]')].map(a=>new URL(a.href).pathname))].slice(0,2),warnings:warnings.filter(w=>text.includes(w)),countIncomplete:text.includes('Количество уточняется'),horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,protocol:nav?.nextHopProtocol,ttfbMs:nav?Math.round(nav.responseStart-nav.startTime):null,htmlDecodedBytes:nav?.decodedBodySize||null};
   }));
   row.pageErrors=pageErrors;row.failedSameOriginRequests=failedSameOriginRequests;
   if(row.status!==200)report.failures.push(probe.key+':http');
   if(row.h1?.length!==1)report.failures.push(probe.key+':heading_count');
   if(probe.market&&!row.h1?.[0]?.includes(countries[probe.market]))report.failures.push(probe.key+':country_heading');
   if(!row.font?.includes('Onest'))report.failures.push(probe.key+':font');
   if(row.warnings?.length)report.failures.push(probe.key+':visible_error');
   if(pageErrors)report.failures.push(probe.key+':browser_error');
   if(row.horizontalOverflow)report.failures.push(probe.key+':horizontal_overflow');
   if(!offerPath&&row.offerLinks?.length)offerPath=row.offerLinks[0];
   if(['all','china','japan160','korea160','china-mobile','korea-mobile'].includes(probe.key))await page.screenshot({path:out+'/'+probe.key+'.png'});
  }catch{row.error='navigation_or_inspection_failed';report.failures.push(probe.key+':navigation');}
  finally{report.routes.push(row);save();console.log('CATALOG_ROUTE',JSON.stringify(row));await context.close();}
 }
 if(offerPath){
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();
  try{const response=await page.goto(origin+offerPath,{waitUntil:'domcontentloaded',timeout:45000});report.offer={path:offerPath,status:response?.status(),h1:await page.locator('h1').allTextContents(),canonical:await page.locator('link[rel=canonical]').getAttribute('href').catch(()=>null)};if(response?.status()!==200)report.failures.push('offer:http');await page.screenshot({path:out+'/offer.png'});}catch{report.failures.push('offer:navigation');}finally{await context.close();}
 }
 report.after=await health();
 report.scopeAccepted=report.failures.length===0;
 report.completePowerCoverageAccepted=false;
 report.note='Zero cards/incomplete counts are retained as unresolved findings, not proof of zero market inventory. No authenticated CRM or full database correctness acceptance.';
}catch(error){report.failures.push(String(error?.message||'readback_failed'));report.scopeAccepted=false;}
finally{await browser?.close();save();console.log('READBACK_SUMMARY',JSON.stringify({expected,scopeAccepted:report.scopeAccepted,failures:report.failures,routes:report.routes.length}));}
if(report.failures.length)process.exitCode=1;
