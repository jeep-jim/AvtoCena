import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const [origin,fixture]=process.argv.slice(2);
assert.equal(origin,process.env.BRAND_INTERNAL_ORIGIN);
assert.match(origin,/^http:\/\/172\.(?:1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}:3000$/);
const ids=JSON.parse(await readFile(fixture,'utf8')),city='Уссурийск';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
const markets=['china','georgia'];
const exact=(p,market)=>p.origin===origin&&p.pathname===`/cars/${market}/Toyota`&&p.searchParams.get('city')===city;
async function launch(market,phone=false){
 const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:900},serviceWorkers:'block'});
 await context.addCookies([{name:'avtocena_city',value:encodeURIComponent(city),url:origin}]);
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();
 await page.goto(origin+'/cars/'+market,{waitUntil:'domcontentloaded'});
 assert.equal(new URL(page.url()).searchParams.has('city'),false,'fixture must start with saved city only');
 const logo=page.locator('section[aria-label="Марки автомобилей"] a[title="Автомобили Toyota под заказ"]').first();
 await logo.waitFor({state:phone?'attached':'visible',timeout:20000});
 await page.waitForFunction(({selector,city})=>{
  const a=document.querySelector(selector);
  return a instanceof HTMLAnchorElement&&new URL(a.href).searchParams.get('city')===city;
 },{selector:'section[aria-label="Марки автомобилей"] a[title="Автомобили Toyota под заказ"]',city},{timeout:20000});
 const links=()=>page.locator('.ac-catalog-results [data-catalog-batch] a[href*="/cars/offer/"]').evaluateAll(els=>[...new Set(els.map(a=>new URL(a.href).pathname.split('/')[3]))]);
 assert.deepEqual((await links()).sort(),ids[market].map(x=>x[1]).sort());
 assert.equal(await page.locator('[data-catalog-market-count]').first().getAttribute('data-catalog-market-count'),'2');
 await page.evaluate(()=>{
  window.brandUnexpectedGlobalLoader=false;
  const observe=()=>{const node=document.querySelector('.ac-route-loader');if(node?.getAttribute('aria-hidden')==='false')window.brandUnexpectedGlobalLoader=true;};
  new MutationObserver(observe).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-hidden']});
  observe();
 });
 const finish=async()=>{
  await page.waitForURL(p=>exact(p,market),{timeout:30000});
  await page.locator('.ac-catalog-sidebar input[name="make"][value="Toyota"]').first().waitFor({state:'attached',timeout:20000});
  const toyota=ids[market].find(([b])=>b==='Toyota')[1];
  assert.deepEqual(await links(),[toyota]);
  assert.equal(await page.locator('[data-catalog-market-count]').first().getAttribute('data-catalog-market-count'),'1');
  assert.equal(await page.evaluate(()=>window.brandUnexpectedGlobalLoader),false);
  return new URL(page.url()).pathname+new URL(page.url()).search;
 };
 return {context,page,logo,finish};
}
try{
 for(const market of markets){
  const a=await launch(market),requests=[];
  a.page.on('request',r=>{const u=new URL(r.url());if(exact(u,market)&&(r.headers().rsc==='1'||r.isNavigationRequest()))requests.push(r.url());});
  assert.match(await a.logo.getAttribute('data-no-route-loader'),/^true$/);
  const brandActionAt=performance.now();
  await a.logo.click({clickCount:2});
  const logoHref=await a.finish();
  const logoToVerifiedCardsAndCountMs=Math.round(performance.now()-brandActionAt);
  assert.equal(requests.length,1,'one canonical navigation after double click');
  await a.page.goBack({waitUntil:'domcontentloaded'});
  await a.page.waitForURL(u=>u.pathname==='/cars/'+market&&!u.searchParams.has('make'),{timeout:30000});
  await a.page.locator('[data-catalog-market-count="2"]').first().waitFor({state:'attached',timeout:20000});
  assert.equal(await a.page.locator('[data-catalog-market-count]').first().getAttribute('data-catalog-market-count'),'2');
  await a.context.close();
  const b=await launch(market);
  await b.page.getByRole('button',{name:'Выбрать марки автомобилей'}).first().click();
  const sideActionAt=performance.now();
  await b.page.locator('.ac-catalog-sidebar button[data-facet-value="Toyota"]').first().click();
  assert.equal(await b.finish(),logoHref,'ordinary left and logo route must be byte-identical');
  console.log(JSON.stringify({fixtureOnly:true,market,logoToVerifiedCardsAndCountMs,sidebarToVerifiedCardsAndCountMs:Math.round(performance.now()-sideActionAt),verifiedCount:1}));
  await b.context.close();
 }
 const mobile=await launch('china',true);
 const mobileRailVisible=await mobile.logo.isVisible();
 let mobileAffordance;
 if(mobileRailVisible){
  await mobile.logo.click();
  mobileAffordance='visible_brand_logo';
 }else{
  // Incumbent compiled mobile did hydrate the link, but the exact primary
  // anchor was hidden. Exercise the actual visible filter instead of forcing
  // a non-buyer click or silently skipping mobile.
  const open=mobile.page.getByRole('button',{name:'Открыть фильтры'}).filter({visible:true}).first();
  await open.click();
  const drawer=mobile.page.getByRole('dialog',{name:'Фильтры каталога'});
  await drawer.getByRole('button',{name:'Выбрать марки автомобилей'}).click();
  await drawer.locator('button[data-facet-value="Toyota"]').click();
  mobileAffordance='mobile_filter_drawer';
 }
 await mobile.finish();
 await mobile.context.close();
 console.log(JSON.stringify({status:'brand_logo_native_browser_fixture',markets:2,viewports:2,mobileRailVisible,mobileAffordance,queryCitiesEqual:true,globalLoaderCaptures:0,duplicateNavigations:0,externalFetchesPerformed:0}));
}finally{await browser.close();}
