import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'japan-catalog-city-'));
const next={name:'fixture-next-transport',setup(builder){
 builder.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));
 builder.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'js',resolveDir:process.cwd(),contents:args.path.endsWith('navigation')
  ?`const router={push(href){window.__japanCityFixture.navigate(href)},replace(href){history.replaceState(null,'',href)}};export const useRouter=()=>router;export const usePathname=()=>typeof location==='undefined'?null:location.pathname;export const useSearchParams=()=>new URLSearchParams(typeof location==='undefined'?'':location.search);`
  :`import React from 'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children)}` }));
}};
const common={bundle:true,jsx:'automatic',tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':JSON.stringify(process.env.JAPAN_CITY_REACT_MODE||'production')},plugins:[next]};
await build({...common,entryPoints:['tests/browser/japan-catalog-city-fixture.tsx'],platform:'browser',format:'iife',outfile:path.join(temporary,'fixture.js')});
await build({...common,stdin:{contents:`import React from 'react';import {renderToString} from 'react-dom/server';import {JapanCityFixture} from './tests/browser/japan-catalog-city-fixture';export const render=initial=>renderToString(React.createElement(JapanCityFixture,{initial}));`,resolveDir:process.cwd(),loader:'tsx'},platform:'node',format:'cjs',outfile:path.join(temporary,'server.cjs')});
const {render}=require(path.join(temporary,'server.cjs'));
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(temporary,'fixture.js')));return;}
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({counts:{},modelCounts:{},items:[],models:[]}));return;}
 const initial=Object.fromEntries(url.searchParams);
 if(url.pathname==='/cars/japan')initial.market='japan';
 // esbuild omits Next's styled-jsx transform. Preserve raw CSS in HTML's style
 // text nodes so that this transport adapter does not create a hydration error.
 const markup=render(initial).replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g,(_all,open,css,close)=>open+css.replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&amp;/g,'&')+close);
 res.setHeader('Content-Type','text/html; charset=utf-8');
 // Only layout geometry is synthetic; SSR, hydration, store and controls are actual components.
 res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>.ac-catalog-filter-panel{display:block}.ac-filter-more-button{display:none}.ac-mobile-filter-backdrop{position:fixed;inset:0;background:#fff;overflow:auto}.ac-mobile-filter-sheet{padding:16px}.ac-mobile-filter-sheet input[type=checkbox]{width:24px;height:24px}.ac-mobile-filter-section{margin-top:16px}button{min-height:36px}[data-city-picker]{position:fixed;background:#fff;z-index:100} @media(max-width:1023px){.ac-catalog-filter-panel{display:none}.ac-filter-more-button{display:block}}</style></head><body><div id="root">${markup}</div><script>window.__japanCityInitial=${JSON.stringify(initial).replace(/</g,'\\u003c')}</script><script defer src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const report={passed:false,scope:'Actual CatalogFilters SSR/hydration and interactions; local fixture transport; no supplier calls or public acceptance',cases:[]};
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 for(const width of [390,1280])for(const route of ['/cars/japan?fuel=petrol&city=Новокузнецк','/cars?market=japan&fuel=petrol&city=Новокузнецк']){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ru-RU',serviceWorkers:'block'});
  await context.addCookies([{name:'avtocena_city',value:encodeURIComponent('Москва'),url:origin}]);
  await context.addInitScript(()=>localStorage.setItem('avtocena_city','Москва'));
  const page=await context.newPage(),errors=[],consoleErrors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  let releaseScript;
  const scriptReady=new Promise(resolve=>{releaseScript=resolve;});
  await page.route('**/fixture.js',r=>{releaseScript(r);});
  try{
   await page.goto(origin+route,{waitUntil:'commit'});
   const serverCity=page.locator('.ac-catalog-filter-panel .ac-catalog-city-filter button');
   await serverCity.waitFor({state:'attached'});
   assert.equal(await serverCity.getAttribute('aria-label'),'Выбрать город. Сейчас: Новокузнецк','server HTML retains its explicit city before hydration');
   await (await scriptReady).continue();
   await page.waitForFunction(()=>window.__japanCityFixture?.ready&&!document.querySelector('button[aria-label="Открыть фильтры"]').disabled);
   assert.equal(await serverCity.getAttribute('aria-label'),'Выбрать город. Сейчас: Новокузнецк','old cookie cannot replace URL city during hydration');
   assert.equal(await page.evaluate(()=>localStorage.getItem('avtocena_city')),'Новокузнецк');
   assert.match((await context.cookies()).find(cookie=>cookie.name==='avtocena_city').value,/%D0%9D%D0%BE%D0%B2%D0%BE%D0%BA/);
   let panel=page.locator('.ac-catalog-filter-panel');
   if(width<1024){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();panel=page.getByRole('dialog',{name:'Фильтры каталога'});}
   await panel.locator('input[name="powerTo"]').check();
   await page.waitForFunction(()=>window.__japanCityFixture.calls.length===1&&document.querySelector('.ac-catalog-filter-panel').getAttribute('aria-busy')==='false');
   let query=new URL(page.url()).searchParams;
   assert.equal(query.get('city'),'Новокузнецк');assert.equal(query.get('fuel'),'petrol');assert.equal(query.get('powerTo'),'160');
   await panel.getByRole('button',{name:'Выбрать город. Сейчас: Новокузнецк',exact:true}).click();
   await page.getByRole('dialog',{name:'Выбор города',exact:true}).getByRole('button',{name:'Казань',exact:true}).click();
   await page.waitForFunction(()=>window.__japanCityFixture.calls.length===2&&document.querySelector('.ac-catalog-filter-panel').getAttribute('aria-busy')==='false');
   query=new URL(page.url()).searchParams;
   assert.equal(query.get('city'),'Казань');assert.equal(query.get('fuel'),'petrol');assert.equal(query.get('powerTo'),'160');
   assert.equal(await panel.locator('.ac-catalog-city-filter button').getAttribute('aria-label'),'Выбрать город. Сейчас: Казань');
   await panel.locator('input[name="powerTo"]').uncheck();
   await page.waitForFunction(()=>window.__japanCityFixture.calls.length===3&&document.querySelector('.ac-catalog-filter-panel').getAttribute('aria-busy')==='false');
   query=new URL(page.url()).searchParams;assert.equal(query.get('city'),'Казань');assert.equal(query.has('powerTo'),false);
   const cityStore=await page.evaluate(()=>({local:localStorage.getItem('avtocena_city'),cookie:decodeURIComponent(document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('avtocena_city=')).slice('avtocena_city='.length)),hydrationErrors:window.__japanCityFixture.errors}));
   assert.equal(cityStore.local,'Казань');assert.equal(cityStore.cookie,'Казань');assert.deepEqual(cityStore.hydrationErrors,[]);assert.deepEqual(errors,[]);
   report.cases.push({width,route,ssrCity:'Новокузнецк',hydratedCity:'Новокузнецк',filterCity:'Новокузнецк',manualCity:'Казань',navigationCount:3,passed:true});
  }catch(error){report.failure={width,route,consoleErrors,errors};throw error;}
  finally{await context.close();}
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{
 await browser?.close();await new Promise(resolve=>server.close(resolve));
 fs.writeFileSync(process.env.JAPAN_CITY_REPORT||path.join(os.tmpdir(),'japan-catalog-city-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));fs.rmSync(temporary,{recursive:true,force:true});
}
