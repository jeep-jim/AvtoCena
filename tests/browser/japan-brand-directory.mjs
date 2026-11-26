import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'japan-brand-directory-'));
const makes=['Toyota','Nissan','Honda','Mazda','Subaru','Suzuki','Daihatsu','Lexus','Mitsubishi','BMW','Mercedes-Benz','Audi','Volkswagen','Volvo','Porsche','Peugeot','Renault','Aston Martin'];
const normalized=values=>values.map(value=>value.trim().toLocaleLowerCase('en-US')).sort();
const payload={makes,directoryComplete:true,generationId:'2026-11-26T11:00:00Z',stale:false,counts:Object.fromEntries(makes.map(make=>[make,12000])),modelCounts:{}};
const next={name:'fixture-next-transport',setup(builder){
 builder.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));
 builder.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'js',resolveDir:process.cwd(),contents:args.path.endsWith('navigation')
  ?`const router={push(href){window.__japanBrandFixture.navigate(href)},replace(href){window.__japanBrandFixture.navigate(href,true)},prefetch(){},refresh(){}};export const useRouter=()=>router;export const usePathname=()=>typeof location==='undefined'?null:location.pathname;export const useSearchParams=()=>new URLSearchParams(typeof location==='undefined'?'':location.search);`
  :`import React from 'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children)}` }));
}};
const common={bundle:true,jsx:'automatic',tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[next]};
await build({...common,entryPoints:['tests/browser/japan-brand-directory-fixture.tsx'],platform:'browser',format:'iife',outfile:path.join(temporary,'fixture.js')});
await build({...common,stdin:{contents:`import React from 'react';import {renderToString} from 'react-dom/server';import {JapanBrandDirectoryFixture} from './tests/browser/japan-brand-directory-fixture';export const render=initial=>renderToString(React.createElement(JapanBrandDirectoryFixture,{initial}));`,resolveDir:process.cwd(),loader:'tsx'},platform:'node',format:'cjs',outfile:path.join(temporary,'server.cjs')});
const {render}=require(path.join(temporary,'server.cjs'));
const sources=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx','apps/web/components/layout/RoutePreloader.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
const imports=[...new Set(sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(match=>path.resolve(path.dirname(file),match[1]))))];
const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes|publicLayoutFixes) = `([\s\S]*?)`;/g)].map(match=>match[1])).join('\n');
const css=await postcss([tailwindcss({content:['apps/web/components/{catalog,dealers,layout,ui}/**/*.{ts,tsx}','tests/browser/japan-brand-directory-fixture.tsx']}),autoprefixer]).process(imports.map(file=>fs.readFileSync(file,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
fs.writeFileSync(path.join(temporary,'app.css'),css.css);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(['/fixture.js','/fixture.css','/app.css'].includes(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(path.join(temporary,path.basename(url.pathname))));return;}
 if(url.pathname.startsWith('/brand-logos/')||url.pathname.startsWith('/api/catalog/brand-logo/')){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="76" height="40"><rect width="76" height="40" fill="gray"/></svg>');return;}
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({counts:{},modelCounts:{},items:[],models:[]}));return;}
 const initial={...Object.fromEntries(url.searchParams),market:'japan'};
 const markup=render(initial).replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g,(_all,open,text,close)=>open+text.replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&amp;/g,'&')+close);
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end(`<!doctype html><html lang="ru" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root">${markup}</div><script>window.__japanBrandInitial=${JSON.stringify(initial).replace(/</g,'\\u003c')}</script><script defer src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const report={passed:false,scope:'Actual CatalogSidebar, CatalogFilters and BrandLogoRail SSR/hydration with full-directory success and explicit retry; local fixture transport; no supplier calls or public acceptance',cases:[]};
let browser;
async function openFilter(page,width){
 let panel=page.locator('.ac-catalog-filter-panel');
 if(width<1024){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();panel=page.getByRole('dialog',{name:'Фильтры каталога'});}
 await panel.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();
 return {panel,choices:panel.locator('[data-japan-brand-directory="filter"]')};
}
function assertContext(href){const url=new URL(href,origin),params=url.searchParams,segments=url.pathname.split('/');assert.equal(segments[2]||params.get('market'),'japan');assert.equal(params.get('city'),'Новокузнецк');assert.equal(params.get('fuel'),'petrol');assert.equal(params.get('powerTo'),'160');return segments[3]?decodeURIComponent(segments[3]):params.get('make');}
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
 for(const width of [390,1280])for(const failure of [false,true]){
  const route=(width===390?'/cars/japan?':'/cars?market=japan&')+'fuel=petrol&powerTo=160&city=Новокузнецк';
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ru-RU',serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  let pending,started;
  const requested=new Promise(resolve=>started=resolve);
  await page.route('**/api/catalog/brand-counts?**',r=>{
   const url=new URL(r.request().url());requests.push(url.pathname+url.search);
   assert.equal(url.search,'?market=japan&directory=1','the full directory must not inherit current list filters or pages');
   if(requests.length===1){pending=r;started();return;}
   return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
  });
  try{
   await page.goto(origin+route,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__japanBrandFixture?.ready&&!document.querySelector('button[aria-label="Открыть фильтры"]').disabled);
   await requested;
   const rail=page.locator('[data-japan-brand-directory="rail"]');
   assert.equal(await rail.count(),1);assert.equal(await rail.getAttribute('data-status'),'loading');
   assert.equal(await rail.locator('a[title^="Автомобили "]').count(),7);
   assert.equal(await page.locator('[data-fixture-card]').count(),1,'ready cars do not wait for make metadata');
   const {panel,choices}=await openFilter(page,width);
   await choices.getByPlaceholder('Найти марку',{exact:true}).fill('Aston');
   assert.equal(await choices.getAttribute('data-status'),'loading');assert.equal(await choices.getByText('Марка не найдена',{exact:true}).count(),0);assert.equal(requests.length,1,'rail and filter share one pending request');
   await pending.fulfill({status:failure?503:200,contentType:'application/json',body:JSON.stringify(failure?{error:'japan_counts_unavailable'}:payload)});
   if(failure){
    await choices.locator('[role="status"]').filter({hasText:'Не удалось'}).waitFor();
    assert.equal(await choices.getAttribute('data-status'),'error');assert.equal(await rail.getAttribute('data-status'),'error');
    assert.equal(await page.getByText('Марка не найдена',{exact:true}).count(),0);assert.equal(requests.length,1,'failure does not automatically repeat source requests');
    await choices.getByRole('button',{name:'Повторить',exact:true}).click();
   }
   await rail.locator('a[title="Автомобили Aston Martin под заказ"]').waitFor({state:'attached'});
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-japan-brand-directory="rail"],[data-japan-brand-directory="filter"]')].every(element=>element.getAttribute('data-status')==='ready'));
   assert.equal(await rail.getAttribute('data-directory-complete'),'true');assert.equal(await choices.getAttribute('data-directory-complete'),'true');
   await choices.getByPlaceholder('Найти марку',{exact:true}).fill('');
   assert.deepEqual(normalized(await rail.locator('a[title^="Автомобили "] span').allTextContents()),normalized(makes));
   assert.deepEqual(normalized(await choices.locator('[data-facet-value]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-facet-value')))),normalized(makes));
   assert.equal(await choices.getByText(/12\s?000/).count(),0,'whole-market counts are not claimed for active power filters');
   await panel.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();
   if(width<1024)await panel.getByRole('button',{name:'Свернуть фильтры',exact:true}).click();
   const geometry=await page.evaluate(()=>{const rail=document.querySelector('[data-japan-brand-directory="rail"]'),card=document.querySelector('[data-fixture-card]'),links=[...rail.querySelectorAll('a[title^="Автомобили "]')];return {upper:rail.closest('.ac-catalog-brand-slot')!==null&&rail.getBoundingClientRect().bottom<=card.getBoundingClientRect().top,oneRow:new Set(links.map(link=>Math.round(link.getBoundingClientRect().top))).size===1,overflow:document.documentElement.scrollWidth>innerWidth+1};});
   assert.equal(geometry.upper,true);assert.equal(geometry.oneRow,true);assert.equal(geometry.overflow,false);
   await page.getByRole('button',{name:'Показать все марки',exact:true}).click();
   const all=page.getByRole('dialog',{name:'Все марки автомобилей'});
   assert.equal(await all.locator('a[title^="Автомобили "]').count(),makes.length);
   await all.getByPlaceholder('Найти марку',{exact:true}).fill('Aston');
   const link=all.locator('a[title="Автомобили Aston Martin под заказ"]');assert.equal(await link.count(),1);assert.equal(assertContext(await link.getAttribute('href')),'Aston Martin');
   await page.keyboard.press('Escape');
   const next=await openFilter(page,width);await next.choices.getByPlaceholder('Найти марку',{exact:true}).fill('Aston');
   await next.choices.locator('[data-facet-value="Aston Martin"]').click();
   await page.waitForFunction(()=>decodeURIComponent(location.pathname)==='/cars/japan/Aston Martin'||new URLSearchParams(location.search).get('make')==='Aston Martin');
   assert.equal(assertContext(page.url()),'Aston Martin');assert.equal(requests.length,failure?2:1);
   assert.deepEqual(await page.evaluate(()=>window.__japanBrandFixture.errors),[]);assert.deepEqual(errors,[]);
   report.cases.push({width,route,scenario:failure?'failed request and explicit retry':'delayed complete directory',initialMakes:7,completeMakes:makes.length,directoryRequests:requests.length,oneUpperRow:geometry.upper&&geometry.oneRow,preserved:{market:'japan',fuel:'petrol',powerTo:'160',city:'Новокузнецк',make:'Aston Martin'},passed:true});
  }catch(error){report.failure={width,route,scenario:failure?'retry':'success',requests,errors};throw error;}
  finally{await context.close();}
 }
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{
 await browser?.close();await new Promise(resolve=>server.close(resolve));
 fs.writeFileSync(process.env.JAPAN_BRAND_REPORT||path.join(os.tmpdir(),'japan-brand-directory-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));fs.rmSync(temporary,{recursive:true,force:true});
}
