import {assertInteractionAcceptance} from './catalog-interaction-acceptance.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const expected=process.env.EXPECTED_RELEASE;if(!/^[a-f0-9]{40}$/.test(expected||''))throw Error('exact release required');
const origin='https://avtocena.com',out='artifacts/catalog-interaction';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});const results=[];
const widths=(process.env.CATALOG_PROFILE_WIDTHS||'390,1440').split(',').map(Number);assert.ok(widths.length>0&&widths.length<=2&&widths.every(x=>x===390||x===1440));
try{for(const width of widths){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768});
 const health=await (await context.request.get(origin+'/api/health')).json();assert.equal(health.releaseSha,expected);
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{const u=new URL(r.url());if(u.origin===origin)requests.push({method:r.method,path:u.pathname,search:u.search,at:Date.now()});});
 // Record the actual navigation requests, not just a later warm API probe.
 // No query values, headers/cookies, bodies or supplier addresses are retained.
 const network=[],tracked=new Map();let interaction='initial';
 page.on('request',request=>{const url=new URL(request.url());if(url.origin!==origin||!['document','fetch','xhr'].includes(request.resourceType()))return;
  const row={interaction,type:request.resourceType(),method:request.method(),path:url.pathname,queryKeys:[...new Set(url.searchParams.keys())].sort(),startedAt:Date.now()};network.push(row);tracked.set(request,row);});
 page.on('response',response=>{const row=tracked.get(response.request());if(row){row.status=response.status();row.firstMs=Date.now()-row.startedAt;row.serverTiming=response.headers()['server-timing']||null;}});
 page.on('requestfinished',request=>{const row=tracked.get(request);if(row){row.totalMs=Date.now()-row.startedAt;const t=request.timing();row.transferMs=t.responseEnd>=0&&t.responseStart>=0?t.responseEnd-t.responseStart:null;}});
 page.on('requestfailed',request=>{const row=tracked.get(request);if(row)row.failed=true;});
 const saveNetwork=()=>fs.writeFileSync(`${out}/${width}-network.json`,JSON.stringify(network,null,2));
 try{
  await page.goto(origin+'/cars',{waitUntil:'domcontentloaded',timeout:60000});
  const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
  const category=page.locator('a.ac-market-all-link[href*="market=korea"]').first();await category.waitFor();
  interaction='category';const categoryStart=Date.now(),requestStart=requests.length;await category.click();
  await page.waitForURL(u=>u.searchParams.get('market')==='korea',{timeout:60000});await page.locator('[data-catalog-batch="1"] article').last().waitFor({timeout:60000});
  const categoryMs=Date.now()-categoryStart;const before=await page.locator('[data-catalog-batch] article').count();assert.ok(before>0&&before<=24);
  const categoryRequests=requests.length-requestStart;
  let scope=page.locator('.ac-catalog-sidebar');
  if(width<1024){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();scope=page.locator('.ac-mobile-filter-sheet');await scope.waitFor();}
  await scope.waitFor({state:'visible'});
  await scope.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();
  const brand=scope.locator('.ac-brand-options [data-facet-value="HYUNDAI" i]');await brand.waitFor();
  await page.waitForFunction(()=>!document.querySelector('.ac-route-loader[aria-hidden="false"]'));
  await page.evaluate(()=>{
   window.__filterEvidence={samples:0,emptyCards:false,headerVisible:false};
   const sample=()=>{if(document.querySelector('[data-catalog-filter-pending="true"]')){const e=window.__filterEvidence;e.samples++;e.emptyCards ||= !document.querySelector('[data-catalog-batch] article');e.headerVisible ||= Boolean(document.querySelector('.ac-route-loader[aria-hidden="false"]'));}};
   window.__filterObserver=new MutationObserver(sample);window.__filterObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-catalog-filter-pending','aria-hidden']});
  });
  interaction='filter';const filterStart=Date.now(),filterRequestStart=requests.length;await brand.click();
  if(width<1024)await scope.getByRole('button',{name:/Показать/}).last().click();
  await page.waitForURL(u=>/hyundai/i.test(u.searchParams.get('make')||''),{timeout:60000});
  await page.waitForFunction(()=>{const cards=[...document.querySelectorAll('[data-catalog-batch] article')];return cards.length>0&&cards.every(c=>/hyundai|х[её]нд[аэ]й/i.test(c.innerText));},{},{timeout:60000});
  const filterMs=Date.now()-filterStart;
  const feedback=await page.evaluate(()=>{window.__filterObserver.disconnect();return window.__filterEvidence;});
  assert.ok(feedback.samples>0,'actual filter pending state was observed');
  assert.equal(feedback.emptyCards,false,'previous cards stay visible while filtering');
  assert.equal(feedback.headerVisible,false,'filtering does not activate the header loader');
  assert.equal(await page.locator('[data-catalog-unavailable]').count(),0);assert.deepEqual(errors,[]);
  const api=await context.request.get(origin+'/api/catalog/search?market=korea&make=HYUNDAI&pageSize=24',{timeout:60000});const data=await api.json();assert.ok(api.ok()&&data.ok&&data.items.length);assert.ok(data.items.every(x=>/hyundai/i.test(x.make)));
  const row={width,release:expected,categoryMs,categoryRequests,filterMs,feedback,filterRequests:requests.length-filterRequestStart,cards:data.items.length,apiServerTiming:api.headers()['server-timing']||null,withinTarget:{category:categoryMs<=2000,filter:filterMs<=2000},errors};results.push(row);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('CATALOG_INTERACTION',JSON.stringify(row));
  await page.screenshot({path:`${out}/${width}.png`});
  assert.equal((await (await context.request.get(origin+'/api/health')).json()).releaseSha,expected);
 }catch(error){await page.screenshot({path:`${out}/${width}-failure.png`});console.log('CATALOG_INTERACTION_FAILURE',JSON.stringify({width,error:String(error),errors}));throw error;}finally{saveNetwork();await context.close();}
}fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));if(process.env.CATALOG_PROFILE_ACCEPTANCE==='true')assertInteractionAcceptance(results,expected);}finally{await browser.close();}
