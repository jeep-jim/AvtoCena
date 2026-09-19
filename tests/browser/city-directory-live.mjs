import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--no-sandbox']});
const reports=[];const out='artifacts/city-directory';fs.mkdirSync(out,{recursive:true});
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500});
 const page=await context.newPage();const errors=[],externalCityCalls=[];page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>{if(/\/api\/location\/city|dadata/.test(r.url()))externalCityCalls.push(r.url());});
 const initial=page.waitForResponse(r=>r.url().includes('/calculate')&&r.request().method()==='POST',{timeout:90000});
 await page.goto('https://avtocena.com/cars/offer/6c52ef91feab0a62d14a697c',{waitUntil:'domcontentloaded',timeout:90000});
 await initial;
 const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
 const panel=page.locator('[data-city-delivery]');await panel.getByRole('button',{name:/Выбрать город/}).click();
 const dialog=page.getByRole('dialog',{name:'Выбор города'});const input=dialog.getByPlaceholder('Начните вводить город');
 await input.fill('Тверь');await dialog.getByRole('button',{name:'Тверь Тверская обл',exact:true}).waitFor();
 const calc=page.waitForResponse(r=>r.url().includes('/calculate')&&r.request().method()==='POST'&&JSON.parse(r.request().postData()||'{}').deliveryCity==='Тверь',{timeout:90000});
 await dialog.getByRole('button',{name:'Тверь Тверская обл',exact:true}).click();
 const response=await calc;assert.equal(response.status(),200);const quote=(await response.json()).deliveryQuote;assert.equal(quote.amountRub,205000);
 await dialog.waitFor({state:'hidden'});
 await panel.getByRole('button',{name:/Выбрать город/}).click();await input.fill('Ржев');await dialog.getByRole('button',{name:'Ржев Тверская обл',exact:true}).waitFor();
 await input.fill('Киров');await dialog.getByRole('button',{name:'Киров Калужская обл',exact:true}).waitFor();await dialog.getByRole('button',{name:'Киров Кировская обл',exact:true}).click();
 await panel.getByRole('button',{name:/Киров, Кировская обл/}).waitFor();
 assert.deepEqual(externalCityCalls,[]);assert.deepEqual(errors,[]);
 await page.screenshot({path:`${out}/${width}.png`,fullPage:false});
 const started=Date.now();await page.goto('https://avtocena.com/cars?market=japan',{waitUntil:'domcontentloaded',timeout:90000});const htmlMs=Date.now()-started;
 await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Открыть фильтры"]');return b&&!b.disabled;},null,{timeout:90000});const readyMs=Date.now()-started;
 await page.getByRole('button',{name:'Показать ещё',exact:true}).waitFor();const appendStart=Date.now();await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-catalog-batch] article').length===48,null,{timeout:90000});
 reports.push({width,quote,citySearchExternalRequests:externalCityCalls.length,htmlMs,readyMs,appendMs:Date.now()-appendStart,errors});console.log(JSON.stringify(reports.at(-1)));
 if(width===1440){
  await page.goto('https://avtocena.com/cars/offer/c96d8ddee23bcaa040e9cc6a',{waitUntil:'domcontentloaded',timeout:90000});
  const summary=page.locator('summary.ac-specifications-trigger');await summary.click();
  const text=await summary.locator('..').innerText();assert.match(text,/Автоматическая/);assert.match(text,/Тёмно-серый/);assert.doesNotMatch(text,/오토|쥐색|전륜/);
  console.log('KOREAN_LIVE_TRANSLATION_OK');
 }
 assert.deepEqual(errors,[]);
 await context.close();
}}finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify(reports,null,2));await browser.close();}
