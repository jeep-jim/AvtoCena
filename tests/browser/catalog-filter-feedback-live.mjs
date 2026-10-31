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
 await page.waitForFunction(()=>document.querySelector('.ac-filter-settings')?.disabled===false,null,{timeout:30000});
 report.initialMs=Date.now()-started;
 const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
 const filter=page.locator('.ac-catalog-filter-panel');
 await filter.getByRole('button',{name:'Топливо',exact:true}).click();
 const electric=filter.getByRole('checkbox',{name:'Электро',exact:true});
 const extraSearches=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/catalog/search')extraSearches.push(r.url());});
 await page.evaluate(()=>{
  window.__catalogLoaderProbe={max:0,seen:false};
  window.__catalogLoaderTimer=setInterval(()=>{
   const count=[...document.querySelectorAll('.ac-route-loader,.ac-catalog-section-loading.is-active')].filter(el=>{
    const style=getComputedStyle(el);return el.getAttribute('aria-hidden')!=='true'&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0&&el.getClientRects().length;
   }).length;
   window.__catalogLoaderProbe.max=Math.max(window.__catalogLoaderProbe.max,count);window.__catalogLoaderProbe.seen ||= count>0;
  },25);
 });
 const selectedAt=Date.now();await electric.check();
 report.checkedAfterClick=await electric.isChecked();
 report.loaderVisible=await page.locator('.ac-route-loader[aria-hidden="false"]').waitFor({state:'visible',timeout:1000}).then(()=>true,()=>false);
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('fuel')==='electric'&&document.querySelector('.ac-catalog-filter-panel')?.getAttribute('aria-busy')==='false',null,{timeout:30000});
 report.filterAcknowledgedMs=Date.now()-selectedAt;
 await page.waitForFunction(()=>![...document.querySelectorAll('.ac-catalog-section-loading.is-active')].some(el=>el.getClientRects().length),null,{timeout:30000});
 report.filterCompleteMs=Date.now()-selectedAt;report.withinTwoSeconds=report.filterCompleteMs<=2000;
 const loaders=await page.evaluate(()=>{clearInterval(window.__catalogLoaderTimer);return window.__catalogLoaderProbe;});
 report.maximumSimultaneousLoaders=loaders.max;report.loaderVisible ||= loaders.seen;
 assert.ok(loaders.max<=1,'at most one loading indicator may be visible');
 assert.ok(report.loaderVisible||report.filterCompleteMs<2000,'a slow request must show its indicator');
 report.colors={};for(const theme of ['dark','light']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  report.colors[theme]=await electric.evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(report.colors[theme],'rgb(255, 53, 61)');
  await page.screenshot({path:`${out}/electric-${theme}.png`});
 }
 report.duplicateSearches=extraSearches.length;assert.equal(extraSearches.length,0);assert.deepEqual(errors,[]);
 const after=await page.request.get('https://avtocena.com/api/health');report.healthAfter=await after.json();assert.equal(report.healthAfter.releaseSha,marker.expectedRelease);
 report.passed=true;
}catch(error){report.failure=String(error);report.failureState=await page.evaluate(()=>({url:location.href,fuel:document.querySelector('.ac-catalog-filter-panel input[name=fuel]')?.value,busy:document.querySelector('.ac-catalog-filter-panel')?.getAttribute('aria-busy'),ready:document.querySelector('.ac-filter-settings')?.disabled===false}));process.exitCode=1;await page.screenshot({path:`${out}/electric-failure.png`}).catch(()=>{});}
finally{report.errors=errors;fs.writeFileSync(`${out}/feedback.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
