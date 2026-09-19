import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='https://avtocena.com';
fs.mkdirSync('artifacts/catalog-live',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const results=[];
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}});
 const page=await context.newPage(),errors=[],unrelatedSearches=[];
 page.on("request",request=>{const u=new URL(request.url());if(u.pathname==="/api/catalog/search" && u.searchParams.get("pageSize")==="48" && !u.searchParams.has("market"))unrelatedSearches.push(u.pathname+u.search);});
 page.on('pageerror',e=>errors.push(String(e)));
 try{
  const start=Date.now();
  await page.goto(`${origin}/cars?market=japan`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('[data-catalog-batch="1"] article').last().waitFor({timeout:60000});
  const initialMs=Date.now()-start;
  await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Открыть фильтры"]');return b&&!b.disabled;});
  const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});
  if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
  if(width<1024){
   await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
   const sheet=page.locator('.ac-mobile-filter-sheet');await sheet.waitFor();
   await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});
  }
  const cards=page.locator('[data-catalog-batch] article > a');
  const before=await cards.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  assert.equal(before.length,24);
  const appendStart=Date.now();
  await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-catalog-batch] article').length===48,null,{timeout:60000});
  const appendMs=Date.now()-appendStart;
  const after=await cards.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  assert.deepEqual(after.slice(0,24),before);assert.equal(new Set(after).size,48);
  const target=cards.nth(28);await target.scrollIntoViewIfNeeded();
  // Playwright may scroll again to click (e.g. around a sticky header).
  // Compare with the actual departure position saved by the application.
  await target.evaluate(el=>el.addEventListener('click',()=>{window.__testCatalogDepartureY=window.scrollY;},{capture:true,once:true}));
  await target.click();
  const scrollY=await page.evaluate(()=>window.__testCatalogDepartureY);assert.ok(Number.isFinite(scrollY));
  await page.waitForURL(/\/cars\/offer\//,{timeout:60000});
  await page.locator('main.ac-offer-page h1').waitFor({timeout:60000});
  const backStart=Date.now();await page.goBack({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('[data-catalog-batch] article').length===48,null,{timeout:30000});
  await page.waitForFunction(y=>Math.abs(window.scrollY-y)<100,scrollY,{timeout:10000});
  assert.deepEqual(await cards.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),after);
  assert.deepEqual(errors,[]);assert.deepEqual(unrelatedSearches,[],"catalog must not fetch the home page trend list");
  results.push({width,initialMs,appendMs,backMs:Date.now()-backStart,cards:48,scrollY,errors});
  await page.screenshot({path:`artifacts/catalog-live/catalog-${width}.png`});
 }catch(e){console.log('FAIL',JSON.stringify({width,errors,error:String(e)}));await page.screenshot({path:`artifacts/catalog-live/failure-${width}.png`});throw e;}finally{await context.close();}
}
console.log('LIVE_JOURNEY',JSON.stringify(results));
}finally{fs.writeFileSync('artifacts/catalog-live/results.json',JSON.stringify(results,null,2));await browser.close();}
