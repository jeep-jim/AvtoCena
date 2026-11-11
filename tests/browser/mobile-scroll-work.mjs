import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/mobile-scroll-work';fs.mkdirSync(out,{recursive:true});
const baseline=process.env.SCROLL_BASE_REF;
const modes=baseline?['before','after']:['after'];
for(const mode of modes) await build({entryPoints:['tests/browser/mobile-scroll-work-fixture.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:`${out}/${mode}.js`,define:{'process.env.NODE_ENV':'"production"'},plugins:[
 {name:'navigation-fixture',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'next'}));b.onLoad({filter:/.*/,namespace:'next'},a=>({contents:a.path.endsWith('/navigation')?'export const useRouter=()=>({prefetch(url){(window.__prefetches||=[]).push(url)}});':`import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}`,resolveDir:process.cwd()}));}},
 ...(mode==='before'?[{name:'previous-implementation',setup(b){b.onLoad({filter:/(CatalogFilterUiEnhancer|IntentPrefetchLink)\.tsx$/},a=>({contents:execFileSync('git',['show',`${baseline}:${path.relative(process.cwd(),a.path)}`],{encoding:'utf8'}),loader:'tsx',resolveDir:path.dirname(a.path)}));}}]:[])
]});
const server=http.createServer((req,res)=>{const name=req.url?.endsWith('.js')?path.basename(req.url):null;res.setHeader('Content-Type',name?'text/javascript':'text/html; charset=utf-8');res.end(name?fs.readFileSync(`${out}/${name}`):`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}.ac-catalog-filter-panel{height:500px;overflow:hidden}.card{display:block;width:100%;height:280px;background:#ddd}.ac-range-value-menu{display:none}</style><div id="root"></div><script src="/${req.url?.includes('before')?'before':'after'}.js"></script>`)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const results=[];
try{
 for(const mode of modes){
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.__scrollProbe={active:false,decorations:0,duration:0};
   const original=Document.prototype.querySelectorAll;
   Document.prototype.querySelectorAll=function(selector){if(window.__scrollProbe.active&&selector==='.ac-catalog-filter-panel .ac-range-input-box input, .ac-mobile-filter-sheet .ac-range-input-box input')window.__scrollProbe.decorations++;return original.call(this,selector)};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
  await page.locator('.ac-range-value-toggle').first().waitFor();await page.waitForTimeout(150);
  await page.evaluate(()=>scrollTo(0,560));await page.waitForTimeout(150);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.evaluate(()=>{window.__scrollProbe.active=true;window.__prefetches=[];});
  // Real touch gestures begin on linked cards. They must scroll without
  // prefetching detail routes, repainting filter controls or navigating.
  const started=Date.now();
  for(let n=0;n<3;n++){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:680}]});
   for(const y of [610,530,440,330,220]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:190,y}]});await page.waitForTimeout(24);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);
  }
  await page.waitForTimeout(200);
  const measured=await page.evaluate(()=>{window.__scrollProbe.active=false;return {decorations:window.__scrollProbe.decorations,prefetches:window.__prefetches,y:scrollY}});
  assert.ok(measured.y>1000,'native mobile scrolling must advance');
  if(mode==='after'){assert.equal(measured.decorations,0,'scroll must not redecorate filter fields');assert.deepEqual(measured.prefetches,[],'touch scroll must not prefetch detail routes');}
  results.push({mode,baseRef:mode==='before'?baseline:undefined,cpuSlowdown:4,gestureMs:Date.now()-started,...measured});
  if(mode==='after'){
   // Values still update decoration, and intentional mouse/keyboard prefetch stays.
   await page.evaluate(()=>scrollTo(0,0));
   await page.getByLabel('Год: от',{exact:true}).fill('2020');
   await page.waitForTimeout(100);
   assert.equal(await page.getByLabel('Год: от',{exact:true}).evaluate(e=>e.closest('.ac-range-card').classList.contains('is-filled')),true);
   await page.getByRole('link',{name:'Автомобиль 0',exact:true}).dispatchEvent('pointerdown',{pointerType:'mouse'});
   assert.ok((await page.evaluate(()=>window.__prefetches)).includes('/cars/offer-0'));
   await page.getByRole('link',{name:'Автомобиль 1',exact:true}).focus();
   assert.ok((await page.evaluate(()=>window.__prefetches)).includes('/cars/offer-1'));
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));}
