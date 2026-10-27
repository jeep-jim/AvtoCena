import assert from 'node:assert/strict';import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const expected=process.env.EXPECTED_RELEASE;if(!/^[a-f0-9]{40}$/.test(expected||''))throw Error('exact release required');
const origin='https://avtocena.com',out='artifacts/catalog-interaction';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});const results=[];
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768});
 const health=await (await context.request.get(origin+'/api/health')).json();assert.equal(health.releaseSha,expected);
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{const u=new URL(r.url());if(u.origin===origin)requests.push({method:r.method,path:u.pathname,search:u.search,at:Date.now()});});
 try{
  await page.goto(origin+'/cars',{waitUntil:'domcontentloaded',timeout:60000});
  const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
  const category=page.locator('a.ac-market-all-link[href*="market=korea"]').first();await category.waitFor();
  const categoryStart=Date.now(),requestStart=requests.length;await category.click();
  await page.waitForURL(u=>u.searchParams.get('market')==='korea',{timeout:60000});await page.locator('[data-catalog-batch="1"] article').last().waitFor({timeout:60000});
  const categoryMs=Date.now()-categoryStart;const before=await page.locator('[data-catalog-batch] article').count();assert.ok(before>0&&before<=24);
  const categoryRequests=requests.length-requestStart;
  await page.getByRole('button',{name:'Открыть фильтры',exact:true}).waitFor({state:'attached'});
  let scope=page.locator('.ac-catalog-sidebar');
  if(width<1024){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();scope=page.locator('.ac-mobile-filter-sheet');await scope.waitFor();}
  await scope.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();
  const brand=scope.locator('.ac-brand-options [data-facet-value="HYUNDAI" i]');await brand.waitFor();
  const filterStart=Date.now(),filterRequestStart=requests.length;await brand.click();
  if(width<1024)await scope.getByRole('button',{name:/Показать/}).last().click();
  await page.waitForURL(u=>/hyundai/i.test(u.searchParams.get('make')||''),{timeout:60000});
  await page.waitForFunction(()=>{const cards=[...document.querySelectorAll('[data-catalog-batch] article')];return cards.length>0&&cards.every(c=>/hyundai|х[её]нд[аэ]й/i.test(c.innerText));},{},{timeout:60000});
  const filterMs=Date.now()-filterStart;assert.equal(await page.locator('[data-catalog-unavailable]').count(),0);assert.deepEqual(errors,[]);
  const api=await context.request.get(origin+'/api/catalog/search?market=korea&make=HYUNDAI&pageSize=24',{timeout:60000});const data=await api.json();assert.ok(api.ok()&&data.ok&&data.items.length);assert.ok(data.items.every(x=>/hyundai/i.test(x.make)));
  const row={width,release:expected,categoryMs,categoryRequests,filterMs,filterRequests:requests.length-filterRequestStart,cards:data.items.length,apiServerTiming:api.headers()['server-timing']||null,withinTarget:{category:categoryMs<=2000,filter:filterMs<=2000},errors};results.push(row);console.log('CATALOG_INTERACTION',JSON.stringify(row));
  await page.screenshot({path:`${out}/${width}.png`});
  assert.equal((await (await context.request.get(origin+'/api/health')).json()).releaseSha,expected);
 }catch(error){await page.screenshot({path:`${out}/${width}-failure.png`});console.log('CATALOG_INTERACTION_FAILURE',JSON.stringify({width,error:String(error),errors}));throw error;}finally{await context.close();}
}fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));}finally{await browser.close();}
