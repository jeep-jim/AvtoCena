import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const marker=JSON.parse(fs.readFileSync('.github/market-runs/catalog-filter-navigation-diagnostic.json','utf8'));
const out='artifacts/catalog-filter-navigation';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
const report={checkedAt:new Date().toISOString(),expectedRelease:marker.expectedRelease,passed:false},errors=[];
page.on('pageerror',e=>errors.push(String(e)));
try{
 const response=await page.request.get('https://avtocena.com/api/health');assert.equal(response.ok(),true);
 report.health=await response.json();assert.equal(report.health.releaseSha,marker.expectedRelease);
 const started=Date.now();await page.goto('https://avtocena.com/cars',{waitUntil:'domcontentloaded',timeout:90000});
 const japan=page.getByRole('region',{name:'Япония',exact:true});
 await japan.locator('.ac-catalog-card').nth(5).waitFor({timeout:30000});
 report.japanCards=await japan.locator('.ac-catalog-card').count();assert.equal(report.japanCards,6);
 report.initialMs=Date.now()-started;
 const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
 const filter=page.locator('.ac-catalog-filter-panel'),electric=filter.locator('.ac-electric-filter input[type=checkbox]');
 const extraSearches=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/catalog/search')extraSearches.push(r.url());});
 const selectedAt=Date.now();await electric.check();
 report.loaderVisible=await page.locator('.ac-catalog-section-loading').filter({visible:true}).count()>0;
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('fuel')==='electrified'&&document.querySelector('.ac-catalog-filter-panel')?.getAttribute('aria-busy')==='false',null,{timeout:30000});
 report.filterAcknowledgedMs=Date.now()-selectedAt;
 await page.waitForFunction(()=>![...document.querySelectorAll('.ac-catalog-section-loading.is-active')].some(el=>el.getClientRects().length),null,{timeout:30000});
 report.filterCompleteMs=Date.now()-selectedAt;report.withinTwoSeconds=report.filterCompleteMs<=2000;
 assert.ok(report.loaderVisible||report.filterCompleteMs<2000,'a slow request must show its indicator');
 report.colors={};for(const theme of ['dark','light']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  report.colors[theme]=await electric.evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(report.colors[theme],'rgb(255, 210, 31)');
  await page.screenshot({path:`${out}/electric-${theme}.png`});
 }
 report.duplicateSearches=extraSearches.length;assert.equal(extraSearches.length,0);assert.deepEqual(errors,[]);
 const after=await page.request.get('https://avtocena.com/api/health');report.healthAfter=await after.json();assert.equal(report.healthAfter.releaseSha,marker.expectedRelease);
 report.passed=true;
}catch(error){report.failure=String(error);process.exitCode=1;await page.screenshot({path:`${out}/electric-failure.png`}).catch(()=>{});}
finally{report.errors=errors;fs.writeFileSync(`${out}/feedback.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
