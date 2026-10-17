import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='https://avtocena.com';fs.mkdirSync('artifacts/city-picker-live',{recursive:true});
let ready=false;
for(let i=0;i<36;i++){
 try{const health=await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(15000)}).then(r=>r.json());if(health.releaseSha===process.env.EXPECTED_RELEASE){ready=true;break;}}catch{}
 await new Promise(r=>setTimeout(r,10000));
}
assert.ok(ready,'exact release must be published');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});const results=[];
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
 try{
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:90000});
 const trigger=page.locator('.ac-city-selector button').first();await trigger.waitFor();await page.waitForFunction(()=>{const b=document.querySelector('.ac-city-selector button');return b&&!b.disabled;},null,{timeout:60000});
 const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
 await trigger.tap();const dialog=page.getByRole('dialog',{name:'Выбор города',exact:true});await dialog.getByRole('textbox',{name:'Поиск города'}).fill('Новоалт');await dialog.getByRole('button',{name:/Новоалтайск/}).tap();await dialog.waitFor({state:'hidden'});assert.match(await trigger.textContent(),/Новоалтайск/);
 await page.locator('[data-home-lead]:visible').first().tap();const lead=page.locator('.ac-lead-dialog');await lead.waitFor();const name=lead.locator('input[autocomplete="name"]');await name.fill('Проверка интерфейса');
 await lead.locator('[data-native-city-field]').getByRole('button',{name:width<768?/Выбрать город. Сейчас:/:/Открыть выбор города/}).tap();
 await dialog.getByRole('textbox',{name:'Поиск города'}).fill('Новокуз');await dialog.getByRole('button',{name:/Новокузнецк/}).tap();await dialog.waitFor({state:'hidden'});
 assert.equal(await name.inputValue(),'Проверка интерфейса');
 if(width<768)assert.match(await lead.locator('[data-native-city-field]').textContent(),/Новокузнецк/);else assert.equal(await lead.getByRole('textbox',{name:'Ваш город',exact:true}).inputValue(),'Новокузнецк');
 await lead.locator('[data-native-city-field]').getByRole('button',{name:width<768?/Выбрать город. Сейчас:/:/Открыть выбор города/}).tap();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.ok(await lead.isVisible());
 await page.screenshot({path:`artifacts/city-picker-live/${width}.png`});assert.deepEqual(errors,[]);results.push({width,firstTap:true,leadPreserved:true,errors});
 }catch(e){await page.screenshot({path:`artifacts/city-picker-live/failure-${width}.png`});throw e;}finally{await context.close();}
}console.log(JSON.stringify({passed:true,results}));}finally{fs.writeFileSync('artifacts/city-picker-live/results.json',JSON.stringify(results));await browser.close();}
