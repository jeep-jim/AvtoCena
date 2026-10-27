import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const expected=process.env.EXPECTED_RELEASE,origin='https://avtocena.com',out='artifacts/compact-encyclopedia-live';
assert.match(expected||'',/^[a-f0-9]{40}$/);fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN}),results=[];
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{const u=new URL(r.url());if(u.origin===origin)requests.push(u.pathname);});
 const health=async()=>assert.equal((await (await context.request.get(origin+'/api/health')).json()).releaseSha,expected);
 try{
  await health();const start=Date.now();await page.goto(origin+'/cars/autocatalog',{waitUntil:'domcontentloaded',timeout:60000});
  const rows=page.locator('.ac-model-list-item');await rows.first().waitFor({timeout:60000});const rowsMs=Date.now()-start;
  // This marker only exists after the client has mounted. Count readiness in
  // the opening duration; a server-rendered button alone is not interactive.
  await page.locator('.ac-route-loader').waitFor({state:'attached',timeout:60000});const openMs=Date.now()-start;
  const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
  assert.equal(await rows.count(),40);assert.equal(await page.locator('.ac-model-list a[href*="/cars/offer/"]').count(),0);
  assert.equal(requests.filter(p=>p.startsWith('/api/encyclopedia/')).length,0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`${out}/${width}.png`});
  let photoOpened=false;const photo=page.getByRole('button',{name:/Увеличить фото/}).first();
  if(await photo.count()){await photo.click();await page.locator('dialog[open]').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);photoOpened=true;}
  const firstName=await rows.first().locator('.ac-model-list-row strong').innerText(),pagination=page.getByRole('navigation',{name:'Страницы моделей'});
  const nextAt=Date.now();await pagination.getByRole('button',{name:'Далее',exact:true}).click();
  await page.waitForURL(u=>u.searchParams.get('page')==='2');await page.waitForFunction(name=>{const e=document.querySelector('.ac-model-list-row strong');return Boolean(e&&e.textContent!==name);},firstName);const nextMs=Date.now()-nextAt;
  const year=page.locator('.ac-ency-filters select').nth(1);await year.waitFor({state:'visible'});
  const years=await year.locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));assert.ok(years.length);
  const selected=years.includes('2025')?'2025':years[0],filterAt=Date.now();await year.selectOption(selected);
  await page.waitForURL(u=>u.searchParams.get('year')===selected&&!u.searchParams.has('page'));await page.waitForFunction(()=>document.querySelector('.ac-ency-filters')?.getAttribute('aria-busy')==='false');await rows.first().waitFor();const yearMs=Date.now()-filterAt;
  assert.ok(await rows.count()>0&&await rows.count()<=40);
  await rows.first().getByRole('button',{name:'Параметры',exact:true}).click();await rows.first().locator('.ac-ency-model-editor').waitFor({timeout:30000});assert.equal(await rows.first().locator('[role="alert"]').count(),0);
  assert.ok(requests.some(p=>p.startsWith('/api/encyclopedia/')));assert.deepEqual(errors,[]);await health();
  const result={width,release:expected,rowsMs,openMs,nextMs,yearMs,photoOpened,rows:await rows.count(),year:selected,withinTarget:{open:openMs<=2000,next:nextMs<=2000,year:yearMs<=2000},errors};results.push(result);console.log('COMPACT_LIVE',JSON.stringify(result));fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
 }catch(error){await page.screenshot({path:`${out}/${width}-failure.png`});throw error;}finally{await context.close();}
}}finally{await browser.close();}

assert.equal(results.length,2,'both mobile and desktop must finish');
assert.ok(results.every(r=>Object.values(r.withinTarget).every(Boolean)),'live_interaction_budget_exceeded');
