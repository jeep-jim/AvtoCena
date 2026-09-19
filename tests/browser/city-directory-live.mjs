import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--no-sandbox']});
const reports=[];const out='artifacts/city-directory';fs.mkdirSync(out,{recursive:true});
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500});
 const page=await context.newPage();const errors=[],externalCityCalls=[];page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>{if(/\/api\/location\/city|dadata/.test(r.url()))externalCityCalls.push(r.url());});
 await page.goto('https://avtocena.com/cars/offer/6c52ef91feab0a62d14a697c',{waitUntil:'domcontentloaded',timeout:90000});
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
 await page.getByRole('button',{name:'Показать ещё',exact:true}).waitFor();const appendStart=Date.now();await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-catalog-batch] article').length===48,null,{timeout:90000});
 reports.push({width,quote,citySearchExternalRequests:externalCityCalls.length,htmlMs,appendMs:Date.now()-appendStart,errors});console.log(JSON.stringify(reports.at(-1)));
 await context.close();
}}finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify(reports,null,2));await browser.close();}
