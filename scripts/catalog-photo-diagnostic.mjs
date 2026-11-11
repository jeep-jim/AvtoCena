import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const release=process.env.EXPECTED_RELEASE;
assert.match(release,/^[a-f0-9]{40}$/);
const health=await fetch('https://avtocena.com/api/health').then(r=>r.json());
assert.equal(health.releaseSha,release);assert.equal(health.ok,true);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),events=[];
 const add=x=>{if(events.length<100)events.push(x)};
 page.on('response',r=>{if(r.request().resourceType()==='image')add({host:new URL(r.url()).host,status:r.status()})});
 page.on('requestfailed',r=>{if(r.resourceType()==='image')add({host:new URL(r.url()).host,error:r.failure()?.errorText})});
 await page.goto('https://avtocena.com/cars?market=korea',{waitUntil:'domcontentloaded',timeout:90000});
 const images=page.locator('[data-catalog-batch="1"] article img[width="400"]');
 await images.nth(3).scrollIntoViewIfNeeded();
 let passed=true;
 try{await page.waitForFunction(()=>{const xs=[...document.querySelectorAll('[data-catalog-batch="1"] article img[width="400"]')].slice(0,4);return xs.length===4&&xs.every(x=>x.complete&&x.naturalWidth>0)},null,{timeout:60000})}catch{passed=false}
 const state=await images.evaluateAll(xs=>xs.slice(0,4).map(x=>({host:new URL(x.src).host,complete:x.complete,width:x.naturalWidth,loading:x.loading,top:x.getBoundingClientRect().top})));
 console.log('PHOTO_DIAGNOSTIC',JSON.stringify({release,passed,state,events}));
 assert.ok(passed,'Four public Korean card photos must load without changing the 60s limit');
}finally{await browser.close()}
