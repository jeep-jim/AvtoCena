import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='https://avtocena.com';
const health=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(20000)}).then(r=>r.json());
assert.equal(health.ok,true);
if(process.env.EXPECTED_RELEASE_SHA)assert.equal(health.releaseSha,process.env.EXPECTED_RELEASE_SHA,'inspect the deployed release only');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
fs.mkdirSync('artifacts/offer-header-live',{recursive:true});
const links={specials:'/cars/offer/special_dealer_topavto__360b1200-7f7f-458b-b25b-60a2ede219e3',stock:'/cars/offer/special_dealer_topavto__f7579564-ecc5-4c74-bb0e-fdf824f598d5'};
try{
 for(const [kind,href] of Object.entries(links))for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>{localStorage.setItem('theme',t);},theme);
  try{
   const response=await page.goto(origin+href,{waitUntil:'domcontentloaded',timeout:60000});assert.ok(response?.ok(),'dealer card must respond successfully');
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   const anchor=page.locator('.ac-offer-contact-anchor');await anchor.waitFor();
   // Scroll the actual rendered anchor, after page layout, rather than a stale SSR coordinate.
   await anchor.scrollIntoViewIfNeeded();const distance=await anchor.evaluate(e=>Math.max(0,e.getBoundingClientRect().top)+180);await page.mouse.wheel(0,distance);
   const bar=page.locator('.ac-offer-contact-floating');await bar.waitFor();
   const button=bar.locator('[data-offer-action="lead"]');
   assert.ok(await button.evaluate(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===e;}),'live header action is clickable');
   assert.ok(await bar.evaluate(e=>+getComputedStyle(e).zIndex>+getComputedStyle(document.querySelector('.ac-public-header')).zIndex));
   await page.screenshot({path:`artifacts/offer-header-live/${kind}-${theme}.png`});
   await bar.getByRole('button',{name:'Закрыть панель заявки и показать шапку'}).click();await bar.waitFor({state:'detached'});
   assert.equal(await page.locator('.ac-public-header').evaluate(e=>e.inert),false);
   console.log(JSON.stringify({kind,theme,release:health.releaseSha,headerOnTop:true,errors}));
  }catch(error){
   console.log(JSON.stringify({kind,theme,errors,geometry:await page.evaluate(()=>({scrollY,viewport:{w:innerWidth,h:innerHeight},height:document.documentElement.scrollHeight,anchor:document.querySelector('.ac-offer-contact-anchor')?.getBoundingClientRect().toJSON(),anchorState:document.querySelector('.ac-offer-contact-anchor')?.outerHTML.slice(0,500),header:document.querySelector('.ac-public-header')?.getBoundingClientRect().toJSON(),bodyOverflow:getComputedStyle(document.body).overflow,cityDisabled:document.querySelector('[data-city-delivery] button')?.disabled})).catch(()=>null)}));
   await page.screenshot({path:`artifacts/offer-header-live/failure-${kind}-${theme}.png`}).catch(()=>{});throw error;
  }finally{await page.close();}
 }
}finally{await browser.close();}
