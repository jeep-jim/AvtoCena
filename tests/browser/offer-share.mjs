import assert from 'node:assert/strict';
import {build} from 'esbuild';
import http from 'node:http';
const {chromium,webkit,devices}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const built=await build({entryPoints:['tests/browser/offer-share-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const server=http.createServer((req,res)=>{if(req.url.startsWith('/app.js')){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles[0].text);return;}res.setHeader('Content-Type','text/html');res.end('<html><head><title>Old title</title><link rel="canonical" href="/cars/offer/chevrolet-trax-2024--car"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
for(const device of ['desktop','android','iphone']){
const browser=await (device==='iphone'?webkit:chromium).launch(device==='iphone'?{headless:true}:{headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 for(const mode of ['native','clipboard','mini','estimate','cancel','native-failure']){
  const page=await browser.newPage(device==='iphone'?devices['iPhone 13']:device==='android'?devices['Pixel 5']:{});await page.addInitScript(mode=>{window.calls=[];Object.defineProperty(navigator,'share',{configurable:true,value:['native','estimate','cancel','native-failure'].includes(mode)?async x=>{if(mode==='cancel')throw new DOMException('cancel','AbortError');if(mode==='native-failure')throw Error('unsupported');window.calls.push(x)}:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async x=>window.calls.push(x)}});},mode);
  await page.goto(origin+'/cars/offer/old--car?utm_source=test');if(mode==='mini')await page.evaluate(()=>document.documentElement.dataset.miniapp='true');
  if(mode==='estimate')await page.evaluate(()=>{delete document.querySelector('[data-offer-id]').dataset.offerSavedVersion;document.querySelector('.ac-inline-parameters').dataset.shareEstimate='eyJ5ZWFyIjoiMjAyMyJ9';});
  await page.getByRole('button',{name:'Поделиться ссылкой',exact:true}).click();
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,mode==='cancel'?0:1);
  const expected=origin+'/cars/offer/chevrolet-trax-2024--car?calculation=11111111-1111-1111-1111-111111111111&share=2';
  if(mode==='native')assert.deepEqual(calls[0],{url:expected});
  else if(mode==='estimate'){assert.deepEqual(Object.keys(calls[0]),['url']);const u=new URL(calls[0].url);assert.equal(u.searchParams.get('estimate'),'eyJ5ZWFyIjoiMjAyMyJ9');assert.equal(u.searchParams.has('calculation'),false);}
  else if(mode==='mini'){assert.ok(calls[0].includes('https://t.me/'));assert.equal((calls[0].match(/₽/g)||[]).length,1);}
  else if(mode!=='cancel')assert.equal(calls[0],expected);
  await page.evaluate(()=>{window.calls=[];document.querySelector('.ac-inline-parameters').dataset.sharePending='true';});await page.getByRole('button').click();assert.deepEqual(await page.evaluate(()=>window.calls),[]);await page.getByText('Дождитесь пересчёта').waitFor();
  await page.close();console.log(device+' '+mode+': live price/specs, identifiable text, correct URL and pending guard OK');
 }
}finally{await browser.close();}
}
server.close();
