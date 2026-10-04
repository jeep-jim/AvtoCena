import assert from 'node:assert/strict';
import {build} from 'esbuild';
import http from 'node:http';
const {chromium,webkit,devices}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const built=await build({entryPoints:['tests/browser/offer-share-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const targets=new Map();let count=0;
const server=http.createServer(async(req,res)=>{if(req.url==='/api/share'){let body='';for await(const chunk of req)body+=chunk;const record=JSON.parse(body);const path='/s/'+String(++count).padStart(16,'0');targets.set(path,record);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path}));return;}if(req.url.startsWith('/app.js')){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles[0].text);return;}res.setHeader('Content-Type','text/html');res.end('<html><head><title>Old title</title><link rel="canonical" href="/cars/offer/chevrolet-trax-2024--car"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
for(const device of (process.env.SKIP_WEBKIT?['desktop','android']:['desktop','android','iphone'])){
const browser=await (device==='iphone'?webkit:chromium).launch(device==='iphone'?{headless:true}:{headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{
 for(const mode of ['native','clipboard','mini','estimate','default','cancel','native-failure']){
  const page=await browser.newPage(device==='iphone'?devices['iPhone 13']:device==='android'?devices['Pixel 5']:{});await page.addInitScript(mode=>{window.calls=[];Object.defineProperty(navigator,'share',{configurable:true,value:['native','estimate','default','cancel','native-failure'].includes(mode)?async x=>{if(mode==='cancel')throw new DOMException('cancel','AbortError');if(mode==='native-failure')throw Error('unsupported');window.calls.push(x)}:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async x=>window.calls.push(x)}});},mode);
  await page.goto(origin+'/cars/offer/old--car?utm_source=test');if(mode==='mini')await page.evaluate(()=>document.documentElement.dataset.miniapp='true');
  if(mode==='default')await page.evaluate(()=>delete document.querySelector('[data-offer-id]').dataset.offerSavedVersion);
  if(mode==='estimate')await page.evaluate(()=>{delete document.querySelector('[data-offer-id]').dataset.offerSavedVersion;document.querySelector('.ac-inline-parameters').dataset.shareEstimate='eyJ5ZWFyIjoiMjAyMyJ9';});
  await page.getByRole('button',{name:'Поделиться ссылкой',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('button').textContent.includes('Готовим'));
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,device!=='desktop'&&mode==='cancel'?0:1);
  if(device==='desktop'){
   assert.equal(calls.length,1);assert.equal(typeof calls[0],'string');assert.match(calls[0],/^Chevrolet Trax Turbo 1.2 — 2023, 1,5 л — 1 800 000 ₽\nhttps?:/);
   const short=new URL(calls[0].split('\n')[1]);assert.equal(short.pathname.length,19);assert.equal(short.search,'');const target=targets.get(short.pathname);assert.equal(target.mini,mode==='mini');if(mode==='default')assert.equal(new URL(target.path,origin).search,'?share=3');
   await page.close();console.log('desktop '+mode+': complete message copied even when native share exists');continue;
  }
  const shared=typeof calls[0]==='string'?calls[0]:calls[0]?.text;
  const short=shared?new URL(shared.split('\n')[1]):null;
  if(short){assert.equal(short.pathname.length,19);assert.equal(short.search,'');}
  const record=short?targets.get(short.pathname):null;
  const resolved=record?origin+record.path:null;
  const expected=origin+'/cars/offer/chevrolet-trax-2024--car?calculation=11111111-1111-1111-1111-111111111111&share=3';
  if(mode==='native'){assert.equal(resolved,expected);assert.equal(calls[0].url,undefined);assert.equal(calls[0].text,calls[0].title+'\n'+short.href);assert.match(calls[0].text,/₽/);}
  else if(mode==='default'){const u=new URL(resolved);assert.equal(u.search,'?share=3');assert.equal(calls[0].text.split('\n')[0],'Chevrolet Trax Turbo 1.2 — 2023, 1,5 л — 1 800 000 ₽');}
  else if(mode==='estimate'){assert.match(calls[0].text,/₽/);const u=new URL(resolved);assert.equal(u.searchParams.get('estimate'),'eyJ5ZWFyIjoiMjAyMyJ9');assert.equal(u.searchParams.has('calculation'),false);}
  else if(mode==='mini'){assert.equal(record.mini,true);assert.equal((calls[0].match(/₽/g)||[]).length,1);}
  else if(mode!=='cancel'){assert.equal(resolved,expected);assert.equal((calls[0].match(/₽/g)||[]).length,1);}
  await page.evaluate(()=>{window.calls=[];document.querySelector('.ac-inline-parameters').dataset.sharePending='true';});await page.getByRole('button').click();assert.deepEqual(await page.evaluate(()=>window.calls),[]);await page.getByText('Дождитесь пересчёта').waitFor();
  await page.close();console.log(device+' '+mode+': live price/specs, identifiable text, correct URL and pending guard OK');
 }
}finally{await browser.close();}
}
server.close();
