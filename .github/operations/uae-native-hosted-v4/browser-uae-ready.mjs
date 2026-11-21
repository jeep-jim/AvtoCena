// Must be run against the compiled, authenticated loopback fixture, never avtocena.com.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const [origin,proofPath]=process.argv.slice(2);
const pinnedInternal=process.env.UAE_TEST_INTERNAL_ORIGIN;
if(pinnedInternal){
 assert.equal(origin,pinnedInternal);
 assert.match(origin??'',/^http:\/\/172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}:3000$/);
}else assert.match(origin??'',/^http:\/\/127\.0\.0\.1:\d{1,5}$/);
const port=Number(new URL(origin).port);
assert.ok(port>=1&&port<=65535);
const proof=JSON.parse(await readFile(proofPath,'utf8'));
const GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/;
assert.match(proof.generationId,GEN);assert.ok(Number.isSafeInteger(proof.total)&&proof.total>=48);
for(const v of [proof.seller,proof.onRequest]){
 assert.ok(typeof v.id==='string'&&v.id&&!/[\s/]/.test(v.id));
 assert.ok(typeof v.href==='string'&&v.href.startsWith('/cars/offer/')&&!v.href.includes('://'));
}
assert.ok(Number.isSafeInteger(proof.seller.rub)&&proof.seller.rub>0);
const nativePhoto=proof.seller.photo;
assert.match(nativePhoto??'',/^https:\/\/www\.dubicars\.com\/images\/.+\.(?:jpe?g|png|webp|avif)$/i);
assert.ok(Number.isSafeInteger(proof.filter?.count)&&proof.filter.count>0&&typeof proof.filter.make==='string'&&typeof proof.filter.model==='string');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
const scope=new URLSearchParams({market:'uae',preparedCut:proof.generationId});
const offerId=url=>decodeURIComponent(url.pathname.split('/')[3]||'');
function originalPhoto(photo){
 if(typeof photo!=='string')return null;
 const url=new URL(photo,origin);
 const browserSite=url.origin===origin||url.origin==='https://avtocena.com';
 if(browserSite&&url.pathname.startsWith('/api/catalog/photo/')&&url.searchParams.get('market')==='uae')
  return url.searchParams.get('url');
 return url.href;
}
const api=async (q)=>{
 const url=origin+'/api/catalog/search?'+new URLSearchParams({...q,...Object.fromEntries(scope)});
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.equal(r.status,200);return r.json();
};
try{
 const onRequest=row=>row.market==='uae'&&row.sourceId==='dubicars_uae_exact'&&
  row.calculationStatus==='needs_data'&&row.totalRub==null&&row.sourcePrice==null&&row.sellerPriceRub==null;
 const [a,b,filter,neighborBefore]=await Promise.all([
  api({page:'1',marketPage:'1'}),api({page:'2',marketPage:'1'}),
  api({countOnly:'1',make:proof.filter.make,model:proof.filter.model,...proof.filter.params}),
  fetch(origin+'/api/catalog/search?market=georgia&marketPage=1').then(r=>{assert.ok(r.ok);return r.json();}),
 ]);
 assert.equal(a.generationId,proof.generationId);assert.equal(b.generationId,proof.generationId);
 assert.equal(a.total,proof.total);assert.equal(b.total,proof.total);assert.equal(a.items.length,24);assert.equal(b.items.length,24);
 assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,48);
 assert.equal(a.items.filter(onRequest).length,0);
 assert.equal(b.items.filter(onRequest).length,13);
 assert.equal(filter.total,proof.filter.count);
 const expectedCard=[...a.items,...b.items].find(item=>item.id===proof.seller.id);
 assert.equal(originalPhoto(expectedCard?.cardImageUrl),nativePhoto);
 for(const [width,height] of [[1440,900],[390,844]]){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
  await context.route('**/*',route=>{
   const request=route.request(),target=new URL(request.url());
   if(target.origin===origin)return route.continue();
   return route.abort();
  });
  const page=await context.newPage(),quoteAttempts=[];
  page.on('request',req=>{
   const url=new URL(req.url());
   if(req.method()==='POST'&&/^\/api\//.test(url.pathname)&&/calc|price|estimate|quote/i.test(url.pathname))quoteAttempts.push(url.pathname);
  });
  const readBatch=async n=>{
   const batch=page.locator(`[data-catalog-batch="${n}"]`);
   await batch.waitFor({timeout:20000});
   const hrefs=await batch.locator('a[href*="/cars/offer/"]').evaluateAll(links=>links.map(l=>l.getAttribute('href')));
   const urls=hrefs.map(href=>new URL(href,origin));
   assert.ok(urls.length>0);
   for(const url of urls){assert.equal(url.origin,origin);assert.equal(url.searchParams.get('market'),'uae');assert.equal(url.searchParams.get('preparedCut'),proof.generationId);}
   return [...new Set(urls.map(offerId))];
  };
  // Begin observation before navigation; native prefetch can finish before
  // explicit click. We still require real DOM cards after clicking and the
  // exact unmodified response IDs, never a test-only filtering threshold.
  const page2=page.waitForResponse(res=>{
   const url=new URL(res.url()),q=url.searchParams;
   return url.origin===origin&&url.pathname==='/api/catalog/search'&&q.get('market')==='uae'&&
    q.get('preparedCut')===proof.generationId&&q.get('marketPage')==='1'&&q.get('page')==='2'&&q.get('countOnly')!=='1';
  },{timeout:45000});
  void page2.catch(()=>{}); // Keep a navigation assertion the first error if it fails.
  const list=origin+'/cars/uae?'+scope;
  assert.ok((await page.goto(list,{waitUntil:'domcontentloaded'}))?.ok());
  assert.deepEqual(await readBatch(1),a.items.map(x=>x.id));
  await page.getByRole('button',{name:'Показать ещё'}).click();
  const response=await page2;assert.equal(response.status(),200);
  const afterClick=await response.json();
  assert.equal(afterClick.generationId,proof.generationId);
  assert.deepEqual(afterClick.items.map(x=>x.id),b.items.map(x=>x.id));
  assert.equal(afterClick.items.filter(onRequest).length,13);
  assert.deepEqual(await readBatch(2),b.items.map(x=>x.id));
  assert.equal(new Set([...(await readBatch(1)),...(await readBatch(2))]).size,48);
  assert.ok((await page.goto(list+'&page=2',{waitUntil:'domcontentloaded'}))?.ok());
  assert.deepEqual(await readBatch(2),b.items.map(x=>x.id));
  for(const v of [proof.seller,proof.onRequest]){
   const url=new URL(v.href,origin);url.searchParams.set('market','uae');url.searchParams.set('preparedCut',proof.generationId);
   assert.ok((await page.goto(url.href,{waitUntil:'domcontentloaded'}))?.ok());
   assert.equal(new URL(page.url()).searchParams.get('preparedCut'),proof.generationId);
   const main=page.locator('main[data-offer-id]');await main.waitFor({timeout:15000});
   if(v===proof.seller){
    const preview=JSON.parse(await main.getAttribute('data-offer-preview'));
    assert.equal(originalPhoto(preview.imageUrl),nativePhoto);
    const og=await page.locator('meta[property="og:image"]').evaluateAll(tags=>tags.map(t=>t.content));
    assert.ok(og.some(src=>originalPhoto(src)===nativePhoto));
   }
   assert.equal(await main.getAttribute('data-offer-id'),v.id);
   assert.equal(await main.getAttribute('data-offer-price-rub'),v===proof.seller?String(v.rub):null);
   if(v===proof.onRequest){
    await main.getByRole('heading',{name:'Цена по запросу',exact:true}).waitFor({timeout:10000});
    assert.equal(JSON.parse(await main.getAttribute('data-offer-preview')).totalRub??null,null);
   }
   // Keep the normal mount window long enough to detect the incumbent eager quote effect.
   await page.waitForTimeout(1000);
  }
  assert.deepEqual(quoteAttempts,[]);
  await context.close();
 }
 const neighborAfter=await fetch(origin+'/api/catalog/search?market=georgia&marketPage=1').then(r=>r.json());
 assert.deepEqual(neighborAfter,neighborBefore);
 console.log(JSON.stringify({status:'uae_browser_acceptance',generationId:proof.generationId,viewports:2,quotePosts:0,externalFetchesPerformed:0}));
}finally{await browser.close();}
