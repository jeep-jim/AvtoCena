import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--no-sandbox']});
const output='artifacts/city-delivery-live';fs.mkdirSync(output,{recursive:true});
const reports=[];
try {for(const width of [390,1440]) {
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500});
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 const calculation=(city)=>page.waitForResponse(response=>response.url().includes('/calculate') && response.request().method()==='POST' && (JSON.parse(response.request().postData()||'{}').deliveryCity||'')===city,{timeout:90000});
 const first=calculation('');
 await page.goto('https://avtocena.com/cars/offer/6c52ef91feab0a62d14a697c',{waitUntil:'domcontentloaded',timeout:90000});
 const initialResponse=await first;assert.equal(initialResponse.status(),200);const initial=await initialResponse.json();
 const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
 const panel=page.locator('[data-city-delivery]');await panel.waitFor({state:'visible'});
 assert.match(await panel.innerText(),/0 ₽.*не включена/);
 const rows=[];
 for(const [city,amount] of [['Новосибирск',130000],['Новокузнецк',120000],['Москва',200000]]) {
  await panel.getByRole('button',{name:/Выбрать город/}).click();
  const dialog=page.getByRole('dialog',{name:'Выбор города'});
  await dialog.getByPlaceholder('Начните вводить город').fill(city);
  const response=calculation(city);
  await dialog.getByRole('button',{name:'Выбрать город',exact:true}).click();
  const result=await response;assert.equal(result.status(),200);const body=await result.json();
  assert.equal(body.deliveryQuote.amountRub,amount);assert.equal(body.deliveryQuote.city,city);
  assert.equal(body.breakdown.filter(row=>row.id==='rf-delivery').length,1);
  assert.equal(body.breakdown.find(row=>row.id==='rf-delivery').amountRub,amount);
  assert.equal(body.totalRub-initial.totalRub,amount);
  await dialog.waitFor({state:'hidden'});
  await page.locator(".ac-inline-parameters .ac-offer-price-panel").getByText(body.totalRub.toLocaleString("ru-RU")+" ₽",{exact:true}).waitFor({state:"visible"});
  rows.push({city,amount,totalRub:body.totalRub});
 }
 await page.getByRole('button',{name:'Оставить заявку',exact:true}).click();
 const cityInput=page.getByPlaceholder('Например, Москва');await cityInput.waitFor({state:'visible'}).catch(async error=>{await page.screenshot({path:`${output}/${width}-lead-failure.png`,fullPage:true});console.log((await page.locator('body').innerText()).slice(-5000));throw error;});assert.equal(await cityInput.inputValue(),'Москва');
 await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
 await panel.getByRole('button',{name:/Выбрать город/}).click();
 const clear=calculation('');await page.getByRole('dialog',{name:'Выбор города'}).getByRole('button',{name:'Не выбирать город'}).click();
 const cleared=await (await clear).json();assert.equal(cleared.totalRub,initial.totalRub);
 await page.locator('.ac-inline-parameters .ac-offer-price-panel').getByText(initial.totalRub.toLocaleString('ru-RU')+' ₽',{exact:true}).waitFor({state:'visible'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
 await panel.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${width}.png`,fullPage:false});

 reports.push({width,initialTotal:initial.totalRub,rows,clearedTotal:cleared.totalRub,errors});console.log(JSON.stringify(reports.at(-1)));
 await context.close();
}assert.deepEqual(reports.flatMap(report=>report.errors),[]);}finally{fs.writeFileSync(`${output}/report.json`,JSON.stringify(reports,null,2));await browser.close();}
