import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const cases=[['bbdc9f4661719617765f19ec',2727280],['ajes-korea-6d1nkfP5H0ngqu',7254985],['ajes-korea-6d1nIGC880T51e',5999801],['367c09969707c8221e8abf9e',2155149],['ajes-stats-2NgfFLkogQyQo',474961],['ajes-stats-2QFQ2qkxr4bP4Ru',509539],['ajes-stats-2QzWNA1OYHeOMD6',1215162]];
fs.mkdirSync('artifacts/calculation-acceptance',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const results=[];
try{
 for(const [id,total] of cases){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  try{
   const response=await page.goto('https://avtocena.com/api/catalog/offer-redirect/'+id,{waitUntil:'domcontentloaded',timeout:60000});
   assert.equal(response?.status(),200);
   await page.locator('main.ac-offer-page h1').waitFor({timeout:30000});
   await page.waitForFunction(expected=>[...document.querySelectorAll('.ac-offer-price-panel')].some(el=>(el.textContent||'').replace(/[^0-9]/g,'').includes(String(expected))),total,{timeout:45000});
   const panel=await page.locator('.ac-offer-price-panel').allTextContents();
   assert.deepEqual(errors,[]);
   results.push({id,totalRub:total,url:page.url(),panel,passed:true});
   await page.screenshot({path:'artifacts/calculation-acceptance/'+id+'.png'});
  }catch(e){results.push({id,totalRub:total,error:String(e),errors,panel:await page.locator('.ac-offer-price-panel').allTextContents(),passed:false});await page.screenshot({path:'artifacts/calculation-acceptance/'+id+'-failed.png'});}
  finally{await context.close();}
 }
 console.log('PUBLIC_CALCULATION_UI',JSON.stringify(results));
 assert.ok(results.length===7&&results.every(r=>r.passed),'all seven public cards must display their calculated totals');
}finally{fs.writeFileSync('artifacts/calculation-acceptance/results.json',JSON.stringify(results,null,2));await browser.close();}
