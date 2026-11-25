import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {pausePhotoRecoveryTimers,decodedChinaPhotoControl} from '../../scripts/catalog-next/photo-japan-browser-acceptance.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const plan=JSON.parse(await fs.readFile(path.join(root,'.github/operations/catalog-next/china-code-serving-plan.json')));
assert.match(plan.runtimeSha,/^[a-f0-9]{40}$/);
const readRuntime=async file=>process.env.PHOTO_RUNTIME_ROOT
 ? fs.readFile(path.join(process.env.PHOTO_RUNTIME_ROOT,file),'utf8')
 : execFileSync('git',['show',`${plan.runtimeSha}:${file}`],{cwd:root,encoding:'utf8',timeout:30_000});
const sources=new Map(await Promise.all([
 ['fixture:cover','apps/web/components/catalog/CatalogCover.tsx'],
 ['./protected-photo-retry','apps/web/components/catalog/protected-photo-retry.ts'],
 ['@/lib/catalog/cover-image','apps/web/lib/catalog/cover-image.ts'],
].map(async([key,file])=>[key,await readRuntime(file)])));
// Bundle the exact isolated runtime components; the harness owns only the two
// cards and their callback button. No production component is recreated here.
const result=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React,{useCallback,useState} from 'react';
 import {createRoot} from 'react-dom/client';
 import {CatalogCover} from 'fixture:cover';
 const caseId=new URLSearchParams(location.search).get('case');
 const source=kind=>'/api/catalog/photo/'+caseId+'-'+kind+'?url=local-fixture&market=china';
 function App(){
  const [recovery,setRecovery]=useState(null);
  const change=useCallback(value=>setRecovery(value),[]);
  return <><article className="ac-catalog-card" data-target="true">
   <a href="/unexpected-navigation"><CatalogCover src={source('target')} alt="Target" eager onRecoveryChange={change}/></a>
   {recovery&&<button data-catalog-photo-retry onClick={recovery.retry}>Retry photo</button>}
  </article><article className="ac-catalog-card"><CatalogCover src={source('control')} alt="Control" eager/></article></>;
 }
 createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,
 define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'exact-photo-runtime',setup(bundle){
  bundle.onResolve({filter:/^(?:fixture:cover|\.\/protected-photo-retry|@\/lib\/catalog\/cover-image)$/},args=>({path:args.path,namespace:'runtime'}));
  bundle.onLoad({filter:/.*/,namespace:'runtime'},args=>({contents:sources.get(args.path),loader:'tsx',resolveDir:root}));
 }}]});
const javascript=result.outputFiles[0].contents;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGElEQVQokWOoW7CDJMQwqmHBaCjVYQsDAMF4YJCRaxoZAAAAAElFTkSuQmCC','base64');
const cases=new Map();
const imageResponse=response=>{response.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public,max-age=86400'});response.end(png);};
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,'http://fixture.invalid');
 if(url.pathname==='/app.js'){response.setHeader('Content-Type','application/javascript');response.end(javascript);return;}
 const image=url.pathname.match(/^\/api\/catalog\/photo\/(running|paused)-(target|control)$/);
 if(image){
  const state=cases.get(image[1]),kind=image[2];state.requests[kind].push(request.url);
  if(kind==='control'){
   if(state.controlReady)imageResponse(response);else state.controls.push(response);
  }else if(state.requests.target.length<=3){
   response.writeHead(503,{'Cache-Control':'no-store','Retry-After':'15','X-Photo-Status':'photo_busy'});response.end();
  }else imageResponse(response);
  return;
 }
 response.setHeader('Content-Type','text/html');
 response.end('<!doctype html><html><head><style>article{display:inline-block;position:relative;width:250px;height:230px;vertical-align:top;margin:10px}article a,article [role="img"]{display:block;width:250px;height:180px}img{width:250px;height:180px}button{position:absolute;top:190px}</style></head><body><div id="root"></div><script>window.photoErrors=0;addEventListener("error",e=>{if(e.target instanceof HTMLImageElement&&e.target.src.includes("-target?"))window.photoErrors++},true)</script><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const wait=async(check,message,timeout=10_000)=>{
 const end=Date.now()+timeout;
 do{if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);
 assert.fail(message);
};
async function scenario(paused){
 const id=paused?'paused':'running';
 const state={requests:{target:[],control:[]},controls:[],controlReady:false};cases.set(id,state);
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 let timer;
 try{
  await page.clock.install({time:new Date()});
  await page.goto(`${origin}/?case=${id}`,{waitUntil:'domcontentloaded'});
  const card=page.locator('[data-target="true"]'),retry=card.locator('[data-catalog-photo-retry]');
  await wait(()=>page.evaluate(()=>window.photoErrors===1),'initial photo failure');
  if(paused)await pausePhotoRecoveryTimers(page);
  await page.clock.runFor(18_001);
  await wait(()=>page.evaluate(()=>window.photoErrors>=2),'first retry');
  await page.clock.runFor(38_001);
  await wait(()=>page.evaluate(()=>window.photoErrors>=3),'second retry');
  await retry.waitFor({state:'visible',timeout:5000});
  assert.equal(state.requests.target.length,3);
  assert.equal(await retry.evaluate(button=>button.closest('a')===null),true);
  // An unrelated native response takes longer than the15s automatic-recovery
  // timer. The old running-clock live gate therefore loses its manual button.
  timer=setTimeout(()=>{state.controlReady=true;for(const response of state.controls)imageResponse(response);state.controls=[];},16_000);
  const target=new URL(`/api/catalog/photo/${id}-target?url=local-fixture&market=china&view=card`,origin).href;
  const control=await decodedChinaPhotoControl(page,target);
  assert.ok(control.includes(`${id}-control?`));
  if(!paused){
   await wait(()=>state.requests.target.length===4,'old automatic recovery');
   await wait(()=>retry.count().then(count=>count===0),'old gate loses the manual button');
   return {scenario:id,automaticRecoveryBeforeClick:true,targetRequests:state.requests.target.length};
  }
  assert.equal(state.requests.target.length,3,'native waiting must not consume manual recovery');
  assert.equal(await retry.isVisible(),true);
  assert.ok((await page.screenshot({fullPage:true,animations:'disabled',timeout:5000})).byteLength>0,
   'the live screenshot must work while application timers are paused');
  const before=page.url();
  await retry.click({timeout:5000});
  await wait(async()=>await card.locator('img').count()===1&&
   await card.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),'manual decode');
  assert.equal(await card.locator('img').evaluate(image=>image.src),target);
  assert.equal(page.url(),before);assert.equal(state.requests.target.length,4);
  assert.equal(state.requests.control.length,1);assert.equal(await retry.count(),0);
  await page.clock.resume();await page.clock.runFor(60_000);
  assert.equal(state.requests.target.length,4);assert.equal(state.requests.control.length,1);
  assert.equal(new Set(state.requests.target).size,1);assert.deepEqual(errors,[]);
  return {scenario:id,manualRecoveryPassed:true,targetRequests:4,controlRequests:1,sameUrl:true,pausedScreenshotPassed:true};
 }finally{
  if(timer)clearTimeout(timer);
  for(const response of state.controls)response.destroy();
  await context.close();
 }
}
try{
 const results=await Promise.all([scenario(false),scenario(true)]);
 console.log('PHOTO_JAPAN_RECOVERY_CLOCK',JSON.stringify({passed:true,results}));
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
