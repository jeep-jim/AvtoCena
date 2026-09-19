import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const reports=[];
try{for(const width of [390,1440,390]){
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const requests=[],errors=[],tasks=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('requestfailed',r=>{if(r.url().startsWith('https://avtocena.com'))requests.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText});});
 page.on('requestfinished',r=>{if(!r.url().startsWith('https://avtocena.com'))return;tasks.push((async()=>{const response=await r.response();requests.push({path:new URL(r.url()).pathname,method:r.method(),type:r.resourceType(),status:response.status(),timing:r.timing(),sizes:await r.sizes(),headers:{cache:response.headers()['cache-control'],server:response.headers()['server'],serverTiming:response.headers()['server-timing']}});})());});
 const start=Date.now();await page.goto('https://avtocena.com/cars?market=japan',{waitUntil:'domcontentloaded',timeout:90000});const htmlMs=Date.now()-start;
 await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Открыть фильтры"]');return b&&!b.disabled;},null,{timeout:90000});const readyMs=Date.now()-start;
 const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
 const appendStart=Date.now();await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-catalog-batch] article').length===48,null,{timeout:90000});const appendMs=Date.now()-appendStart;
 await Promise.allSettled(tasks);reports.push({width,htmlMs,readyMs,appendMs,errors,requests});console.log(JSON.stringify(reports.at(-1)));await context.close();
}}finally{fs.mkdirSync('artifacts/catalog-latency',{recursive:true});fs.writeFileSync('artifacts/catalog-latency/browser.json',JSON.stringify(reports,null,2));await browser.close();}
