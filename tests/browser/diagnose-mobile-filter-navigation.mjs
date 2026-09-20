const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const c=await browser.newContext({viewport:{width:320,height:900},hasTouch:true,serviceWorkers:'block'});
const page=await c.newPage();
const events=[];
page.on('pageerror',e=>events.push({error:String(e)}));
page.on('request',r=>{if(new URL(r.url()).pathname==='/cars')events.push({request:r.url(),time:Date.now()});});
page.on('requestfailed',r=>events.push({failed:r.url().split('?')[0],reason:r.failure()?.errorText}));
page.on('response',r=>{if(new URL(r.url()).pathname==='/cars')events.push({response:r.url(),status:r.status(),time:Date.now()});});
const state=async label=>console.log(JSON.stringify({label,url:page.url(),state:await page.evaluate(()=>({ready:document.readyState,count:document.querySelector('[data-catalog-count]')?.textContent,heading:document.querySelector('h1')?.textContent,sheet:!!document.querySelector('.ac-mobile-filter-sheet'),body:[...document.querySelectorAll('input[name="bodyType"]')].map(e=>e.value),notices:[...document.querySelectorAll('.ac-notice-stack')].map(e=>getComputedStyle(e).visibility)})),events}));
try {
 await page.goto('https://avtocena.com/cars',{waitUntil:'domcontentloaded',timeout:90000});
 await page.getByRole('button',{name:'Открыть фильтры',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Открыть фильтры"]').disabled);
 const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});
 if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
 const sheet=page.locator('.ac-mobile-filter-sheet');
 await sheet.locator('input[name="bodyType"]').locator('..').locator(':scope > button').click();
 await sheet.getByRole('button',{name:'Кроссовер',exact:true}).click();
 await state('selected');
 await sheet.locator('button[data-ac-mobile-close="1"],button[aria-label="Закрыть"]').click();
 await state('closed');
 try{await page.waitForURL(/bodyType=suv/,{waitUntil:'domcontentloaded',timeout:30000});}catch(e){console.log(String(e));}
 await state('after navigation wait');
}finally{await browser.close();}
