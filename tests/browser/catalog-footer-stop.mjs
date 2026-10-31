import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out='artifacts/catalog-footer-stop';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/catalog-footer-stop-fixture.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:`${out}/app.js`,plugins:[{name:'action-stub',setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'next-stub'}));b.onLoad({filter:/.*/,namespace:'next-stub'},()=>({contents:"import React from 'react';export default function Link(props){return React.createElement('a',props)}",resolveDir:process.cwd()}));b.onResolve({filter:/(?:catalog|green-corner)-load-more-action$/},()=>({path:'action',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const loadMoreCatalog=async()=>({page:4,total:447,ids:[],cards:null});export const loadMoreGreenCorner=loadMoreCatalog;'}));}}]});
fs.appendFileSync(`${out}/app.css`,fs.readFileSync('apps/web/app/public-polish.css','utf8'));
const server=http.createServer((req,res)=>{const file=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':null;res.setHeader('Content-Type',file?.endsWith('js')?'text/javascript':file?'text/css':'text/html');res.end(file?fs.readFileSync(`${out}/${file}`):'<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;--ac-text:#111}footer{margin-top:56px}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
const results=[];const browserErrors=[];
try {
 for(const width of [320,390,767,1280]) {
  const page=await browser.newPage({viewport:{width,height:800},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
  await page.addInitScript(() => {
   window.__footerTouchListeners = new Map();
   window.__footerScrollSamples=[];
   window.addEventListener('scroll',()=>window.__footerScrollSamples.push(scrollY),{passive:true});
   const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
   EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (this === document && type === 'touchmove') window.__footerTouchListeners.set(listener, options?.passive === true);
    return add.call(this, type, listener, options);
   };
   EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (this === document && type === 'touchmove') window.__footerTouchListeners.delete(listener);
    return remove.call(this, type, listener, options);
   };
  });
  page.on('pageerror' ,e=>{browserErrors.push(e.message);console.error(e.message);});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for(const pageNumber of [3,10,18]) {
   await page.goto(`http://127.0.0.1:${server.address().port}/?page=${pageNumber}`);
   const nav=page.getByRole('navigation',{name:'Страницы каталога'});await nav.waitFor();
   const boxes=await nav.locator(':scope > *').evaluateAll(items=>items.filter(el=>getComputedStyle(el).display!=='none').map(el=>{const r=el.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right};}));
   assert.ok(Math.max(...boxes.map(x=>x.top))-Math.min(...boxes.map(x=>x.top))<2,`pagination wraps ${width}/${pageNumber}`);
   assert.ok(boxes.every(x=>x.left>=0&&x.right<=width),`pagination overflow ${width}/${pageNumber}`);
  }
  const marker=page.locator('.ac-catalog-footer-boundary');await marker.waitFor({state:'attached'});
  assert.equal(await page.evaluate(()=>[...window.__footerTouchListeners.values()].some(passive=>!passive)),false,'ordinary catalog scroll must have no blocking document touchmove');
  if(width>=768){assert.equal(await marker.isVisible(),false);assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollSnapType),'none');results.push({width,desktopUnaffected:true});await page.close();continue;}
  const arrow=page.getByRole('button',{name:'Перейти к информации внизу страницы',includeHidden:true});
  assert.equal(await arrow.isVisible(),false,'arrow hidden until stop');
  const client=await page.context().newCDPSession(page);
  const boundary=()=>page.evaluate(()=>document.querySelector('.ac-catalog-footer-boundary').getBoundingClientRect().bottom+scrollY-innerHeight);
  const swipe=async()=>{
   await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:650}]});
   for(const y of [560,450,330,180]){await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:190,y}]});await page.waitForTimeout(16);}
   await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForTimeout(1300);
  };
  const stop=await boundary();
  await page.evaluate(()=>scrollTo(0,0));
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:650}]});
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(()=>scrollY)<3,'touching the page must not jump to pagination');
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:190,y:610}]});
  await page.waitForTimeout(200);
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(()=>scrollY)<stop-400,'ordinary swipe must not jump to pagination');
  await page.evaluate(y=>scrollTo(0,y),stop-300);
  await page.evaluate(()=>window.__footerScrollSamples=[]);
  await swipe();
  const samples=await page.evaluate(()=>window.__footerScrollSamples);
  const directions=samples.slice(1).map((y,i)=>y-samples[i]).filter(d=>Math.abs(d)>2).map(Math.sign);
  const reversals=directions.slice(1).filter((d,i)=>d!==directions[i]).length;
  assert.ok(reversals<=1,`a single fling must not oscillate at pagination: ${JSON.stringify(samples)}`);
  const first=await page.evaluate(()=>scrollY);
  assert.ok(Math.abs(first-stop)<=3,`first fling must stop at pagination: ${width} ${first} / ${stop}`);
  assert.equal(await arrow.isVisible(),true,'arrow appears at stop');
  await page.screenshot({path:`${out}/stop-${width}.png`});
  await swipe();
  assert.ok(await page.evaluate(()=>scrollY)>stop+100,'second gesture must reach footer');
  assert.equal(await arrow.isVisible(),false,'arrow hidden after passing');
  // Returning to the list rearms the stop on the next gesture.
  await page.evaluate(y=>scrollTo(0,y),stop-300);await swipe();
  assert.ok(Math.abs(await page.evaluate(()=>scrollY)-stop)<=3,'stop rearms after returning');
  await page.getByRole('button',{name:'Перейти к информации внизу страницы'}).tap();
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>scrollY)>stop+100,`arrow opens footer: ${JSON.stringify(await page.evaluate(()=>({y:scrollY,visible:getComputedStyle(document.querySelector('.ac-catalog-footer-boundary button')).visibility,body:document.body.scrollHeight,footer:document.querySelector('#footer-content').getBoundingClientRect().top})))}, stop=${stop}`);
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('ac-catalog-footer-stop')),false);
  assert.equal(await arrow.isVisible(),false,'arrow hidden after click');
  results.push({width,firstFlingStops:true,secondContinues:true,arrowWorks:true,rearms:true});await page.close();
 }
 assert.deepEqual(browserErrors,[]);
 fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
} finally {await browser.close();await new Promise(r=>server.close(r));}
