import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const marker=JSON.parse(fs.readFileSync('.github/market-runs/owner-retention-public.json','utf8'));
assert.match(marker.release,/^[0-9a-f]{40}$/);
const origin='https://avtocena.com',out='artifacts/owner-retention-public';
fs.mkdirSync(out,{recursive:true});
const report={release:marker.release,checkedAt:new Date().toISOString(),environment:'Public Chromium, fresh sessions at 390 and 1440 CSS pixels; no login, no customer data writes; HTTP cards ready, not completed image loads or VPN simulation',checks:[],partnerBudgets:[],retentionPassed:false};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
let active;
function params(url){const u=new URL(url),p=Object.fromEntries(u.searchParams),parts=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);if(parts[0]==='cars'&&parts[1]!=='offer'){p.market??=parts[1]||'';p.make??=parts[2]||'';p.model??=parts[3]||'';}return p;}
function set(value,separator){return String(value||'').split(separator).filter(Boolean).sort();}
function modelSet(value){return set(value,'|').map(x=>x.toLocaleLowerCase('ru-RU')).sort();}
function assertSelection(url,models,budget){const p=params(url);assert.deepEqual(modelSet(p.model),models.map(x=>x.toLocaleLowerCase('ru-RU')).sort(),'selected models retained');assert.deepEqual(set(p.make,','),['BMW','Toyota'],'selected brands retained');assert.equal(p.market,'china');assert.equal(p.city,'Москва');assert.equal(p.selection,'1');assert.equal(p.budget,String(budget));}
async function frame(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function health(context){const r=await context.request.get(origin+'/api/health',{timeout:30000});assert.equal(r.status(),200);const v=await r.json();assert.equal(v.releaseSha,marker.release,'public runtime changed');return {releaseSha:v.releaseSha,ok:v.ok??null};}
async function ready(page){await page.locator('.ac-catalog-filter-panel[aria-busy="false"]').first().waitFor({state:'attached',timeout:60000});await frame(page);}
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',locale:'ru-RU',isMobile:width===390,hasTouch:width===390});
  const page=await context.newPage();active=page;page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const row={width,checks:{},healthBefore:await health(context)};report.checks.push(row);
  const query=new URLSearchParams({city:'Москва',budget:'6000000',selection:'1'});
  const response=await page.goto(origin+'/cars/china/Toyota/Camry?'+query,{waitUntil:'domcontentloaded',timeout:90000});assert.equal(response.status(),200);
  const cards=page.locator('article.ac-catalog-card,article.ac-catalog-list-row');await cards.first().waitFor({timeout:60000});
  await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Открыть фильтры"]');return b&&!b.disabled;},null,{timeout:60000});
  const consent=page.getByRole('button',{name:'Хорошо',exact:true});if(await consent.isVisible())await consent.click();
  if(width===390)await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
  const scope=width===390?page.getByRole('dialog',{name:'Фильтры каталога'}):page.locator('.ac-catalog-filter-panel');
  assert.deepEqual(modelSet(await scope.locator('input[name=model]').inputValue()),['camry']);
  await scope.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();
  await scope.locator('[data-facet-value="BMW"]').click();
  await page.waitForURL(u=>set(params(u.href).make,',').join(',')==='BMW,Toyota',{timeout:60000,waitUntil:'commit'});
  await ready(page);assertSelection(page.url(),['Camry'],6000000);
  assert.deepEqual(modelSet(await scope.locator('input[name=model]').inputValue()),['camry']);row.checks.brandKeepsModel=true;
  const trigger=scope.getByRole('searchbox',{name:'Модель автомобиля'});await trigger.click();
  const picker=width===390?page.getByRole('dialog',{name:'Выбор моделей'}):scope;
  const input=width===390?picker.getByRole('searchbox',{name:'Поиск модели'}):trigger;
  await input.fill('Corolla');await picker.getByRole('button',{name:'Применить',exact:true}).click();
  assert.deepEqual(modelSet(await scope.locator('input[name=model]').inputValue()),['camry','corolla']);row.checks.secondModelAppends=true;
  // Edit budget before awaiting the model navigation: an older response must not erase either choice.
  row.modelResponseAwaitedBeforeBudget=false;
  const budget=scope.getByRole('textbox',{name:'Цена: до',exact:true});await budget.fill('5000000');await budget.press('Tab');
  await page.waitForURL(u=>u.searchParams.get('budget')==='5000000',{timeout:60000,waitUntil:'commit'});await ready(page);
  assertSelection(page.url(),['Camry','Corolla'],5000000);row.checks.budgetKeepsModelsBrandsCityAndSelection=true;row.checks.rapidModelAndBudgetEditsBothRetained=true;
  if(width===390){await scope.getByRole('button',{name:'Показать автомобили',exact:true}).click();await scope.waitFor({state:'hidden'});}
  await cards.first().waitFor({timeout:60000});await frame(page);
  assertSelection(page.url(),['Camry','Corolla'],5000000);row.checks.closingFiltersKeepsSelection=true;
  const initialCount=await cards.count(),more=page.getByRole('button',{name:'Показать ещё',exact:true});
  row.initialRows=initialCount;
  if(await more.count()&&await more.isVisible()){
   await more.click();await page.waitForFunction(n=>document.querySelectorAll('article.ac-catalog-card,article.ac-catalog-list-row').length>n,initialCount,{timeout:60000});
   row.checks.additionalRowsLoaded=true;
  }else row.additionalRowsScenario='not offered by current results';
  const count=await cards.count();assert.ok(count>=8,'enough real cards required for a meaningful scroll check');
  const target=cards.nth(Math.min(10,count-1)).locator('a[href*="/cars/offer/"]').first();
  await target.scrollIntoViewIfNeeded();await frame(page);
  const before={url:page.url(),y:await page.evaluate(()=>scrollY),rows:count,links:await cards.evaluateAll(nodes=>nodes.map(n=>n.querySelector('a[href*="/cars/offer/"]')?.getAttribute('href')||''))};
  assert.ok(before.y>200,'scroll check must start below the top');
  row.beforeDetail=before;
  await page.screenshot({path:out+'/'+width+'-catalog.png',fullPage:false});
  await target.click();await page.waitForURL(u=>u.pathname.startsWith('/cars/offer/'),{timeout:60000,waitUntil:'domcontentloaded'});
  await page.locator('h1').first().waitFor({timeout:60000});
  await page.waitForFunction(()=>scrollY<3,null,{timeout:5000});
  row.detail={url:page.url(),y:await page.evaluate(()=>scrollY)};
  row.checks.newDetailStartsAtTop=true;
  await page.screenshot({path:out+'/'+width+'-detail.png',fullPage:false});
  await page.goBack({waitUntil:'domcontentloaded',timeout:60000});await page.waitForURL(before.url,{timeout:60000,waitUntil:'commit'});
  await page.waitForFunction(({rows,y})=>document.querySelectorAll('article.ac-catalog-card,article.ac-catalog-list-row').length===rows&&Math.abs(scrollY-y)<=8,{rows:before.rows,y:before.y},{timeout:10000});
  assert.deepEqual(await cards.evaluateAll(nodes=>nodes.map(n=>n.querySelector('a[href*="/cars/offer/"]')?.getAttribute('href')||'')),before.links,'Back must retain exact displayed cars and order');
  assertSelection(page.url(),['Camry','Corolla'],5000000);
  row.afterBack={url:page.url(),y:await page.evaluate(()=>scrollY),rows:await cards.count()};
  row.checks.backRestoresPositionRowsAndFilters=true;
  await page.screenshot({path:out+'/'+width+'-back.png',fullPage:false});
  const retainedCamry=String(params(page.url()).model).split('|').find(x=>x.toLocaleLowerCase('ru-RU')==='camry');assert.ok(retainedCamry);
  await page.getByRole('button',{name:'Убрать '+retainedCamry,exact:true}).filter({visible:true}).first().click();
  await page.waitForURL(u=>modelSet(params(u.href).model).join('|')==='corolla',{timeout:60000,waitUntil:'commit'});await ready(page);
  assertSelection(page.url(),['Corolla'],5000000);row.checks.explicitRemovalKeepsOtherChoices=true;
  row.pageErrors=errors;assert.deepEqual(errors,[]);row.healthAfter=await health(context);row.passed=true;
  console.log('PUBLIC_RETENTION_WIDTH',JSON.stringify(row));await context.close();active=null;
 }
 report.retentionPassed=true;
 const diagnostic=await browser.newContext({serviceWorkers:'block'});
 report.partnerHealthBefore=await health(diagnostic);
 for(const market of ['japan','korea']){
  const started=performance.now();
  try{
   const q=new URLSearchParams({market,budgetTo:'1500000',pageSize:'6',city:'Москва'});
   const response=await diagnostic.request.get(origin+'/api/catalog/search?'+q,{timeout:35000});
   const value=await response.json().catch(()=>({}));
   report.partnerBudgets.push({market,status:response.status(),seconds:Number(((performance.now()-started)/1000).toFixed(3)),items:Array.isArray(value.items)?value.items.length:0,total:value.total??null,partial:!!value.partial,stale:!!value.stale,hasMore:!!value.hasMore,interrupted:!!value.interrupted,error:typeof value.error==='string'&&/^[a-z_]{1,64}$/.test(value.error)?value.error:null,serverTiming:response.headers()['server-timing']??null});
  }catch(e){report.partnerBudgets.push({market,seconds:Number(((performance.now()-started)/1000).toFixed(3)),error:String(e.message).slice(0,300)});}
 }
 report.partnerHealthAfter=await health(diagnostic);await diagnostic.close();
 report.partnerBudgetsReady=report.partnerBudgets.every(r=>r.status===200&&r.items>0&&!r.partial&&!r.stale&&!r.interrupted&&!r.error);
 report.partnerScope='Two ordinary public budget reads only; not whole-feed completeness, provider DUMP permission or general supplier availability.';
}catch(error){
 report.error=String(error.message).slice(0,1500);
 if(active){report.failureState=await active.evaluate(()=>({url:location.href,y:scrollY,rows:document.querySelectorAll('article.ac-catalog-card,article.ac-catalog-list-row').length,dialogs:Array.from(document.querySelectorAll('[role=dialog]')).map(n=>n.getAttribute('aria-label')),filters:Array.from(document.querySelectorAll('input[name=model],input[name=make],input[aria-label="Цена: до"]')).map(n=>({name:n.name,label:n.getAttribute('aria-label'),value:n.value})),bodyPosition:document.body.style.position,scrollRestoration:history.scrollRestoration})).catch(()=>null);await active.screenshot({path:out+'/failure.png',fullPage:false}).catch(()=>{});}
 throw error;
}finally{
 fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 console.log('PUBLIC_RETENTION_REPORT',JSON.stringify(report));await browser.close();
}
