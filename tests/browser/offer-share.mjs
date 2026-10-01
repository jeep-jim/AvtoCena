import assert from 'node:assert/strict';
import {build} from 'esbuild';
import http from 'node:http';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const built=await build({entryPoints:['tests/browser/offer-share-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const server=http.createServer((req,res)=>{if(req.url.startsWith('/app.js')){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles[0].text);return;}res.setHeader('Content-Type','text/html');res.end('<html><head><title>Old title</title><link rel="canonical" href="/cars/offer/chevrolet-trax-2024--car"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 for(const mode of ['native','clipboard','mini']){
  const page=await browser.newPage();await page.addInitScript(mode=>{window.calls=[];Object.defineProperty(navigator,'share',{configurable:true,value:mode==='native'?async x=>window.calls.push(x):undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async x=>window.calls.push(x)}});},mode);
  await page.goto(origin+'/cars/offer/old--car?utm_source=test');if(mode==='mini')await page.evaluate(()=>document.documentElement.dataset.miniapp='true');
  await page.getByRole('button',{name:'Поделиться ссылкой',exact:true}).click();
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,1);
  const title='Chevrolet Trax Turbo 1.2 — 2023, 1,5 л — 1 800 000 ₽';
  if(mode==='native'){assert.equal(calls[0].title,title);assert.equal(calls[0].text,title);assert.equal(calls[0].url,origin+'/cars/offer/chevrolet-trax-2024--car?calculation=11111111-1111-1111-1111-111111111111');}
  else{assert.ok(calls[0].startsWith(title+'\n'));assert.ok(calls[0].includes(mode==='mini'?'https://t.me/':origin+'/cars/offer/chevrolet-trax-2024--car'));}
  await page.evaluate(()=>{window.calls=[];document.querySelector('.ac-inline-parameters').dataset.sharePending='true';});await page.getByRole('button').click();assert.deepEqual(await page.evaluate(()=>window.calls),[]);await page.getByText('Дождитесь пересчёта').waitFor();
  await page.close();console.log(mode+': live price/specs, identifiable text, correct URL and pending guard OK');
 }
}finally{await browser.close();server.close();}
