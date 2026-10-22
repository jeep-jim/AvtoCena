import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='https://avtocena.com', out='artifacts/catalog-budget-live';
fs.mkdirSync(out,{recursive:true});
// Confirm the requested app release (or a verified descendant), not a test-only commit.
const {execFileSync}=await import('node:child_process');
execFileSync(process.execPath,['scripts/wait-published-release.mjs'],{stdio:'inherit'});
const checks=[];
for(const market of ['japan','korea'])for(let repeat=0;repeat<2;repeat++){
 const start=performance.now();const response=await fetch(`${origin}/api/catalog/search?market=${market}&budget=2000000&pageSize=24`);
 assert.ok(response.ok);const data=await response.json();assert.equal(data.total,null,`${market}: do not claim an exact count before delivered-price checks`);
 assert.equal(data.filteredByPage,true);if(data.countSummary!==null){assert.equal(data.countSummary?.upperBound,true);assert.ok(Number.isSafeInteger(data.countSummary.total)&&data.countSummary.total>=0);}assert.equal(typeof data.hasMore,'boolean');assert.ok(Array.isArray(data.items));
 for(const item of data.items){const price=item.japanDeliveredPreview?.totalRub || item.deliveredCalculationPreview?.totalRub || item.totalRub;assert.ok(price>0&&price<=2000000,`${item.id}: delivered price ${price}`);}
 checks.push({market,repeat,total:data.total,candidateUpperBound:data.countSummary?.total??null,matchesOnPage:data.items.length,hasMore:data.hasMore,ms:Math.round(performance.now()-start),timing:response.headers.get('server-timing')});
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});const page=await context.newPage();
 // RSC navigation can fall back to a full document load. A changed URL and
 // visible server HTML do not yet mean the filter's React handlers are ready.
 const waitForFilters=()=>page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Расширенные фильтры"]');return b&&!b.disabled;},null,{timeout:60000});
 await page.route('**/*',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
 await page.goto(`${origin}/cars?budget=2000000`,{waitUntil:'domcontentloaded',timeout:120000});
 await waitForFilters();
 const japan=page.getByRole('heading',{name:/Япония/});await japan.waitFor();
 const korea=page.locator('section').filter({has:page.getByRole('heading',{name:/Корея/})}).last();
 const link=korea.getByRole('link',{name:'Все →'});assert.equal(new URL(await link.getAttribute('href'),origin).searchParams.get('budget'),'2000000');
 await link.click();await page.waitForURL(/market=korea/,{waitUntil:'domcontentloaded',timeout:90000});
 await waitForFilters();
 assert.equal(new URL(page.url()).searchParams.get('budget'),'2000000');
 const desktop=page.locator('.ac-catalog-filter-panel');const input=desktop.getByRole('textbox',{name:'Объём двигателя: до',exact:true});
 for(const [typed,expected] of [['1,5','1500'],['1498','1498']]){
  await waitForFilters();
  await input.fill(typed);await input.press('Tab');await page.waitForURL(url=>url.searchParams.get('engineTo')===expected,{waitUntil:'domcontentloaded',timeout:90000});
  assert.equal(new URL(page.url()).searchParams.get('budget'),'2000000');
 }
 await page.screenshot({path:`${out}/desktop.png`});
 await context.close();
 fs.writeFileSync(`${out}/results.json`,JSON.stringify({passed:true,checks,budgetNavigation:true,engineUnits:true},null,2));
 console.log(JSON.stringify({passed:true,checks,budgetNavigation:true,engineUnits:true}));
}finally{await browser.close();}
