import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='https://avtocena.com',expected=process.env.EXPECTED_RELEASE;
assert.match(expected||'',/^[a-f0-9]{40}$/);
const out='speed-filter-readback';fs.mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),expected,scope:'Two anonymous model-picker interactions; no saved data, no feed crawl or load test. Verify model lookup remains available after removal of an unused serialized array.',cases:[],failures:[]};
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
async function health(){const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(15000)}),h=await r.json();assert.equal(r.status,200);assert.equal(h.releaseSha,expected);return {releaseSha:h.releaseSha,calculationVersion:h.calculationVersion};}
let browser;
try{
 report.before=await health();browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const probe of [{width:1440,theme:'dark'},{width:390,theme:'light'}]){
  const context=await browser.newContext({viewport:{width:probe.width,height:1000},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(20000);
  const row={...probe,pageErrors:[],directoryResponses:[]};
  page.on('pageerror',e=>row.pageErrors.push(String(e.message).slice(0,200)));
  page.on('response',response=>{const u=new URL(response.url());if(u.origin===origin&&(u.pathname.startsWith('/model-directory.')||u.pathname==='/api/catalog/models'))row.directoryResponses.push({path:u.pathname,status:response.status()});});
  try{
   const response=await page.goto(origin+'/cars/china?'+new URLSearchParams({make:'Toyota',city:'Новокузнецк',powerTo:'160'}),{waitUntil:'domcontentloaded',timeout:45000});assert.equal(response?.status(),200);
   await page.locator('.ac-catalog-card').first().waitFor({state:'visible'});
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},probe.theme);
   const originalUrl=page.url();row.initialUrl=new URL(originalUrl).pathname+new URL(originalUrl).search;
   let scope=page.locator('.ac-catalog-sidebar');
   if(probe.width<1024){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).first().click();scope=page.getByRole('dialog',{name:'Фильтры каталога',exact:true});await scope.waitFor();}
   const model=scope.getByRole('searchbox',{name:'Модель автомобиля',exact:true});
   await model.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('input[aria-label="Модель автомобиля"]')].some(e=>Object.keys(e).some(k=>k.startsWith('__reactProps$'))),{},{timeout:20000});
   await model.click();
   let menu;
   if(probe.width<1024){menu=page.getByRole('dialog',{name:'Выбор моделей',exact:true});await menu.waitFor();await menu.getByRole('searchbox',{name:'Поиск модели',exact:true}).fill('Camry');}
   else{await model.fill('Camry');menu=scope.locator('.ac-filter-dropdown').filter({has:page.getByRole('button',{name:'Закрыть список моделей',exact:true})});}
   await menu.getByRole('button',{name:/^Camry(?:\s|$)/i}).first().waitFor({state:'visible',timeout:25000});
   row.matchingModels=await menu.locator('button.ac-filter-option').allTextContents();
   assert.ok(row.matchingModels.some(text=>/Camry/i.test(text)));
   assert.ok(row.directoryResponses.some(r=>r.path.startsWith('/model-directory.')&&r.status===200),'complete directory must remain available');
   row.modelDirectoryPreserved=true;
   row.visibleCards=await page.locator('.ac-catalog-card').count();assert.ok(row.visibleCards>0);
   row.overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(row.overflow,false);
   assert.equal(page.url(),originalUrl,'typing without applying must not change the selected search');
   assert.deepEqual(row.pageErrors,[]);
   await page.screenshot({path:`${out}/model-${probe.width}-${probe.theme}.png`});row.accepted=true;
  }catch(error){row.accepted=false;row.error=String(error.message).slice(0,500);report.failures.push(`${probe.width}:${row.error}`);await page.screenshot({path:`${out}/failure-${probe.width}.png`}).catch(()=>{});}
  finally{report.cases.push(row);save();await context.close();}
 }
 report.after=await health();report.accepted=report.failures.length===0;
}catch(error){report.failures.push(String(error.message).slice(0,500));report.accepted=false;}
finally{await browser?.close();save();console.log('SPEED_FILTER_READBACK',JSON.stringify(report));}
if(!report.accepted)process.exitCode=1;
