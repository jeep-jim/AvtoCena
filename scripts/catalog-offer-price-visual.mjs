import assert from 'node:assert/strict';
import fs from 'node:fs';
const marker=JSON.parse(fs.readFileSync('.github/market-runs/catalog-filter-navigation-diagnostic.json','utf8'));
assert.equal(marker.mode,'offer-price-visual');
assert.match(marker.offerId,/^[a-f0-9]{24}$/);
assert.match(marker.expectedRelease,/^[a-f0-9]{40}$/);
assert.ok(Number.isSafeInteger(marker.expectedTotalRub)&&marker.expectedTotalRub>0);
const origin='https://avtocena.com',out='artifacts/catalog-filter-navigation';
fs.mkdirSync(out,{recursive:true});
const result={startedAt:new Date().toISOString(),offerId:marker.offerId,expectedRelease:marker.expectedRelease,expectedTotalRub:marker.expectedTotalRub,cases:[],passed:false,scope:'Bounded public card DOM/screenshots only; no authentication, form submission, data mutation or speed certification.'};
let browser;
async function health(){
 const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(20000)});
 assert.equal(r.status,200);
 const h=await r.json();assert.equal(h.ok,true);assert.equal(h.releaseSha,marker.expectedRelease,'release changed; keep evidence isolated');
 return h;
}
try{
 result.healthBefore=await health();
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
 for(const width of [390,1280])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',colorScheme:theme});
  await context.addInitScript(t=>localStorage.setItem('theme',t),theme);
  const page=await context.newPage(),row={width,theme,pageErrors:[],passed:false};
  result.cases.push(row);page.on('pageerror',e=>row.pageErrors.push(e.message));
  try{
   const r=await page.goto(origin+'/cars/offer/'+marker.offerId,{waitUntil:'domcontentloaded',timeout:30000});
   row.http=r?.status();assert.equal(row.http,200);
   const root=page.locator('main[data-offer-id="'+marker.offerId+'"]');
   await root.waitFor({state:'visible',timeout:30000});
   assert.equal(await root.getAttribute('data-offer-price-rub'),String(marker.expectedTotalRub));
   assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
   const price=root.locator('.ac-offer-price-panel .ac-price').filter({visible:true}).first();
   await price.waitFor({state:'visible',timeout:30000});await price.scrollIntoViewIfNeeded();
   row.priceText=await price.innerText();
   assert.equal(Number(row.priceText.replace(/[^\d]/g,'')),marker.expectedTotalRub,'visible price must equal accepted target total');
   assert.match(row.priceText,/₽/);
   row.heading=await root.locator('h1').innerText();assert.match(row.heading,/DBX/i);
   row.layout=await page.evaluate(()=>({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));
   assert.ok(row.layout.scrollWidth<=row.layout.clientWidth+1,'no horizontal overflow');
   if(marker.checkPrimaryPhoto === true){
    const photo=root.locator('button[aria-label="Открыть фотографии автомобиля"] img').first();
    await photo.scrollIntoViewIfNeeded();
    await photo.waitFor({state:'visible',timeout:30000});
    await page.waitForFunction(()=>{const img=document.querySelector('main button[aria-label="Открыть фотографии автомобиля"] img');return img instanceof HTMLImageElement&&img.complete&&img.naturalWidth>0;},null,{timeout:30000});
    row.primaryPhoto=await photo.evaluate(img=>({complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,sourceHost:new URL(img.currentSrc,location.href).hostname}));
    row.photoScreenshot=width+'-'+theme+'-photo.png';await page.screenshot({path:out+'/'+row.photoScreenshot});
    await price.scrollIntoViewIfNeeded();
   }
   row.screenshot=width+'-'+theme+'.png';await page.screenshot({path:out+'/'+row.screenshot});
   assert.deepEqual(row.pageErrors,[]);row.passed=true;
  }catch(error){row.error=String(error);await page.screenshot({path:out+'/'+width+'-'+theme+'-failure.png'}).catch(()=>{});throw error;}
  finally{await context.close();}
 }
 result.healthAfter=await health();assert.equal(result.healthAfter.calculationVersion,result.healthBefore.calculationVersion);
 result.passed=true;
}catch(error){result.error=String(error);process.exitCode=1;}
finally{await browser?.close();result.finishedAt=new Date().toISOString();fs.writeFileSync(out+'/offer-price-visual.json',JSON.stringify(result,null,2));console.log('OFFER_PRICE_VISUAL',JSON.stringify(result));}
