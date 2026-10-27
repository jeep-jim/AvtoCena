const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 const seen=[];
 page.on('response',async r=>{try{const u=new URL(r.url());if(u.hostname!=='api.encar.com'||!u.pathname.includes('/record/vehicle/43014653'))return;let j=null;try{j=await r.json();}catch{}
 const shape=(v,d=0)=>d>8?'...':Array.isArray(v)?{length:v.length,sample:v.slice(0,2).map(x=>shape(x,d+1))}:v&&typeof v==='object'?Object.fromEntries(Object.entries(v).slice(0,100).map(([k,x])=>[k,shape(x,d+1)])):typeof v==='string'?`string(${v.length})`:v;
 seen.push({path:u.pathname,status:r.status(),shape:shape(j)});
 }catch{}});
 await page.goto('https://fem.encar.com/cars/report/accident/43014653',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForTimeout(10000);
 console.log('REPORT_BROWSER',JSON.stringify({responses:seen,title:await page.title(),bodySummary:(await page.locator('body').innerText()).replace(/\d+/g,'#').replace(/https?:\S+|[\w.+-]+@[\w.-]+/g,'[omitted]').slice(0,4000)}));
}finally{await browser.close();}
