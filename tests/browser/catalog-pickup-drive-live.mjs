import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const marker=JSON.parse(fs.readFileSync('.github/market-runs/catalog-filter-navigation-diagnostic.json','utf8'));
const out='artifacts/catalog-filter-navigation';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();
const report={checkedAt:new Date().toISOString(),expectedRelease:marker.expectedRelease,checks:[],passed:false};
const failures=[];
const price=o=>Number(o.savedCalculationPreview?(o.totalRub||o.savedCalculationPreview.totalRub):o.japanDeliveredPreview?.totalRub||(o.catalogPricingMode!=='seller'&&o.totalRub)||o.deliveredCalculationPreview?.totalRub)||0;
async function check(name,run){try{const result=await run();report.checks.push({name,pass:true,...result});}catch(e){failures.push(name);report.checks.push({name,pass:false,error:String(e)});}}
async function search(params){const path='/api/catalog/search?'+new URLSearchParams({...params,pageSize:'12'}),start=Date.now();const r=await context.request.get('https://avtocena.com'+path,{timeout:90000});assert.equal(r.status(),200,path);const d=await r.json();assert.equal(d.ok,true);return {path,ms:Date.now()-start,data:d};}
try{
 const health=await context.request.get('https://avtocena.com/api/health');report.health=await health.json();assert.equal(report.health.releaseSha,marker.expectedRelease);
 for(const market of ['japan','korea','china','uae','europe','georgia'])await check(`market:${market}`,async()=>{const r=await search({market});assert.ok(r.data.items.length>0&&r.data.total>0);return {path:r.path,ms:r.ms,total:r.data.total,items:r.data.items.length};});
 let pickupOffer;
 for(const market of ['japan','korea'])await check(`pickup:${market}`,async()=>{const r=await search({market,bodyType:'pickup'});assert.ok(r.data.items.length>0,'known pickup market must yield candidates');assert.ok(r.data.items.every(o=>o.bodyType==='pickup'));if(market==='korea')pickupOffer=r.data.items.find(o=>/rexton|musso/i.test(o.model+' '+o.trim))||r.data.items[0];return {path:r.path,ms:r.ms,total:r.data.total,items:r.data.items.map(o=>({id:o.id,model:o.model,bodyType:o.bodyType}))};});
 await check('japan:forester:awd',async()=>{const r=await search({market:'japan',make:'Subaru',model:'Forester',drive:'awd'});assert.ok(r.data.items.length>0,'Forester AWD must be searchable');assert.ok(r.data.items.every(o=>o.drive==='awd'));return {path:r.path,ms:r.ms,total:r.data.total,items:r.data.items.map(o=>({id:o.id,drive:o.drive,chassisCode:o.chassisCode}))};});
 for(const params of [{market:'japan',make:'Subaru',model:'Forester',sort:'totalRub'},{market:'korea',budgetTo:'3000000',sort:'totalRub'}])await check(`price:${params.market}`,async()=>{const r=await search(params);assert.ok(r.data.items.length>0);let previous=0,unknown=false;for(const o of r.data.items){const rub=price(o);if(!rub){unknown=true;continue;}assert.equal(unknown,false,'calculated quote appears after seller-only card');assert.ok(rub>=previous,'calculated prices must be ascending');if(params.budgetTo)assert.ok(rub<=Number(params.budgetTo));previous=rub;}if(params.budgetTo)assert.equal(unknown,false,'budget filter must not substitute seller price');return {path:r.path,ms:r.ms,prices:r.data.items.map(o=>({id:o.id,calculatedRub:price(o),sellerRub:o.sellerPriceRub||null}))};});
 await check('pickup:card-controls',async()=>{assert.ok(pickupOffer,'pickup search must provide a real card');await page.goto('https://avtocena.com/cars/offer/'+encodeURIComponent(pickupOffer.id),{waitUntil:'domcontentloaded',timeout:90000});await page.locator('main.ac-offer-page h1').waitFor({timeout:60000});const body=await page.locator('main.ac-offer-page').innerText();assert.match(body,/пикап/i);assert.match(body,/полная масса|категория и масса/i);await page.screenshot({path:`${out}/pickup-card.png`,fullPage:true});return {id:pickupOffer.id,url:page.url(),title:await page.locator('h1').innerText()};});
 const after=await context.request.get('https://avtocena.com/api/health');report.healthAfter=await after.json();assert.equal(report.healthAfter.releaseSha,marker.expectedRelease);
 report.passed=failures.length===0;if(failures.length)process.exitCode=1;
}catch(e){report.failure=String(e);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/pickup-drive-pricing.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
