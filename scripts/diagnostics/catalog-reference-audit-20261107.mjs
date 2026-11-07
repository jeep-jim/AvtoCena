// One owner-requested audit: fixed public GETs only, sequential, no scraping or login.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire('/tmp/catalog-browser/package.json');
const {chromium}=require('playwright');
await fs.mkdir('audit-output',{recursive:true});
const routes=[
 ['zma-china','https://zmaimport.ru/avto-iz-kitaya-pod-zakaz'],
 ['zma-catalog','https://zmaimport.ru/katalog?market=china'],
 ['zma-offer','https://zmaimport.ru/avto/china/60411536/mercedes-benz-glc-class-2023'],
 ['ac-health','https://avtocena.com/api/health'],
 ['ac-cars','https://avtocena.com/cars'],
 ['ac-china','https://avtocena.com/cars?market=china'],
 ['ac-china160','https://avtocena.com/cars?market=china&powerTo=160'],
 ['ac-japan160','https://avtocena.com/cars?market=japan&powerTo=160'],
 ['ac-korea160','https://avtocena.com/cars?market=korea&powerTo=160'],
 ['ac-offer','https://avtocena.com/cars/offer/volkswagen-lamando-2020--d24fa615fb67ae4957a421ba'],
];
const report={checkedAt:new Date().toISOString(),sourceSha:process.env.GITHUB_SHA,location:'GitHub ubuntu-latest; no VPN comparison',http:[],browser:[]};
const headersAllowed=['content-type','content-length','content-encoding','cache-control','age','etag','vary','server','server-timing','x-cache','x-nextjs-cache','x-powered-by','cf-cache-status','link'];
for(const [name,url] of routes){
 for(let attempt=1;attempt<=2;attempt++){
  const start=performance.now();let row={name,url,attempt};
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'Mozilla/5.0 (compatible; AvtoCenaOwnerReadOnlyAudit/1.0)','Accept':'text/html,application/json'}});
   row.status=r.status;row.finalUrl=r.url;row.ttfbMs=Math.round(performance.now()-start);row.headers=Object.fromEntries(headersAllowed.map(k=>[k,r.headers.get(k)]).filter(([,v])=>v));
   const text=await r.text();row.totalMs=Math.round(performance.now()-start);row.bytes=Buffer.byteLength(text);row.errorBoundary=text.includes('Не удалось загрузить эту страницу');row.streamError=/\$RX\(|NEXT_HTTP_ERROR_FALLBACK|"digest"\s*:/.test(text);
   if(name==='ac-health')try{row.health=JSON.parse(text);}catch{}
   if(attempt===1)await fs.writeFile(`audit-output/${name}.html`,text);
  }catch(e){row.error=String(e);row.totalMs=Math.round(performance.now()-start);}
  report.http.push(row);console.log('HTTP_AUDIT',JSON.stringify(row));
 }
}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 for(const [name,url] of routes.filter(([n])=>['zma-china','zma-offer','ac-cars','ac-china','ac-japan160','ac-korea160','ac-offer'].includes(n))){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const errors=[],failures=[],responses=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('requestfailed',r=>failures.push({url:r.url().split('?')[0],error:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)responses.push({url:r.url().split('?')[0],status:r.status()});});
  await page.addInitScript(()=>{window.__lcp=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp.push({startTime:e.startTime,size:e.size,url:e.url});}).observe({type:'largest-contentful-paint',buffered:true});}catch{}});
  const start=performance.now();let row={name,url};
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});row.status=response?.status();row.domContentMs=Math.round(performance.now()-start);
   await page.waitForTimeout(5000);
   row=Object.assign(row,await page.evaluate(()=>{
    const sample=selector=>{const e=document.querySelector(selector);if(!e)return null;const s=getComputedStyle(e);return {text:e.textContent?.slice(0,180),family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing};};
    const faces=[];for(const sheet of document.styleSheets){try{for(const r of sheet.cssRules){if(r.type===CSSRule.FONT_FACE_RULE)faces.push(r.cssText);}}catch{}}
    return {title:document.title,h1:[...document.querySelectorAll('h1')].map(x=>x.textContent),description:document.querySelector('meta[name=description]')?.content,canonical:document.querySelector('link[rel=canonical]')?.href,robots:document.querySelector('meta[name=robots]')?.content,fonts:faces,computed:{body:sample('body'),h1:sample('h1'),paragraph:sample('p'),card:sample('h3'),button:sample('button')},errorBoundary:document.body.innerText.includes('Не удалось загрузить эту страницу'),text:document.body.innerText.slice(0,4500),css:[...document.querySelectorAll('link[rel=stylesheet]')].map(x=>x.href),scripts:[...document.scripts].map(x=>x.src).filter(Boolean),nav:performance.getEntriesByType('navigation').map(x=>x.toJSON()),lcp:window.__lcp,resources:performance.getEntriesByType('resource').map(x=>({url:x.name,kind:x.initiatorType,start:x.startTime,duration:x.duration,transfer:x.transferSize,encoded:x.encodedBodySize})),links:[...document.querySelectorAll('a[href]')].slice(0,70).map(x=>({text:x.textContent?.trim().slice(0,80),href:x.getAttribute('href')}))};
   }));
   row.elapsedMs=Math.round(performance.now()-start);
   await page.screenshot({path:`audit-output/${name}.png`,fullPage:false});
   await fs.writeFile(`audit-output/${name}-rendered.html`,await page.content());
   for(const [i,css] of (row.css||[]).slice(0,8).entries()){
    try{const r=await fetch(css,{signal:AbortSignal.timeout(10000)});if(r.ok)await fs.writeFile(`audit-output/${name}-style${i}.css`,await r.text());}catch{}
   }
   if(name==='zma-china'){
    const a=page.locator('a[href^="/avto/china/"]').first();
    if(await a.count()){
     const href=await a.getAttribute('href');const before=await page.evaluate(()=>performance.getEntriesByType('resource').map(x=>x.name));
     await a.hover();await page.waitForTimeout(700);const after=await page.evaluate(()=>performance.getEntriesByType('resource').map(x=>x.name));
     row.hover={href,newRequests:after.filter(x=>!before.includes(x))};const t=performance.now();await a.click();await page.waitForTimeout(1500);row.click={elapsedMs:Math.round(performance.now()-t),url:page.url(),title:await page.title(),h1:await page.locator('h1').allTextContents()};
    }
   }
  }catch(e){row.error=String(e);}
  row.errors=errors;row.failedRequests=failures.slice(0,30);row.httpErrors=responses.slice(0,30);
  report.browser.push(row);await fs.writeFile('audit-output/report.json',JSON.stringify(report,null,2));
  console.log('BROWSER_AUDIT',JSON.stringify({...row,fonts:row.fonts?.slice(0,4),resources:undefined,scripts:undefined,css:undefined,links:undefined,text:row.text?.slice(0,1200)}));
  await context.close();
 }
}finally{await browser.close();await fs.writeFile('audit-output/report.json',JSON.stringify(report,null,2));}
