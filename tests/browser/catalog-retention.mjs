import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const baseRef=process.env.RETENTION_BASE_REF;
const modes=baseRef?['before','after']:['after'],out='artifacts/catalog-retention';fs.mkdirSync(out,{recursive:true});
const replaced=['CatalogFilters.tsx','VehicleModelSearch.tsx','CatalogLoadMore.tsx','RoutePreloader.tsx','DealerBrowsingContext.tsx','filter-scroll.ts','model-suggestion-search.ts','brand-navigation.ts'];
for(const mode of modes)await build({entryPoints:['tests/browser/catalog-retention-fixture.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:`${out}/${mode}.js`,define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[
 {name:'next-fixture',setup(b){
  b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'next'}));
  b.onLoad({filter:/.*/,namespace:'next'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path==='next/link'?`import React from 'react';export default function Link({prefetch,scroll,children,onClick,...props}){return <a {...props} onClick={e=>{onClick?.(e);if(e.defaultPrevented||e.ctrlKey||e.metaKey)return;e.preventDefault();window.__navigate(props.href);}}>{children}</a>}`:`const navigate=(url)=>{(window.__pushes||=[]).push(url);const commit=()=>{history.pushState({},'',url);window.dispatchEvent(new Event('fixture:navigate'));if(location.hash)requestAnimationFrame(()=>document.getElementById(location.hash.slice(1))?.scrollIntoView());};if(window.__delay)setTimeout(commit,window.__delay);else commit();};window.__navigate=navigate;const router={push:navigate,replace:navigate,prefetch(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`}));
  b.onResolve({filter:/(?:catalog|green-corner)-load-more-action$/},()=>({path:'action',namespace:'action'}));
  b.onLoad({filter:/.*/,namespace:'action'},()=>({loader:'tsx',resolveDir:process.cwd(),contents:`import React from 'react';export const loadMoreGreenCorner=loadMoreCatalog;export async function loadMoreCatalog(q,page){return {page,total:48,hasMore:false,ids:Array.from({length:24},(_,i)=>String(24+i)),cards:Array.from({length:24},(_,i)=><article key={i} style={{minHeight:160}}>Автомобиль {24+i}</article>)}}`}));
 }},
 ...(mode==='before'?[{name:'before',setup(b){b.onLoad({filter:/\.(?:ts|tsx)$/},a=>replaced.includes(path.basename(a.path))?{contents:execFileSync('git',['show',`${baseRef}:${path.relative(process.cwd(),a.path)}`],{encoding:'utf8'}),loader:a.path.endsWith('tsx')?'tsx':'ts',resolveDir:path.dirname(a.path)}:undefined);}}]:[])
]});
const css=await postcss([tailwindcss({content:['apps/web/components/**/*.{ts,tsx}']})]).process(['globals.css','catalog-ui.css','select-controls.css','public-polish.css','flat-ui.css','public-regression-fixes.css','catalog-filter-compact.css'].map(f=>fs.readFileSync('apps/web/app/'+f,'utf8')).join('\n')+'\n@tailwind base;@tailwind components;@tailwind utilities;', {from:undefined});
const models=[['BMW','X3',[],1],['BMW','X5',[],1],['Toyota','Corolla',[],1],['Toyota','Camry',[],1]];
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://fixture');
 if(u.pathname==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}
 if(/^\/(before|after)\.(js|css)$/.test(u.pathname)){res.setHeader('Content-Type',u.pathname.endsWith('js')?'text/javascript':'text/css');res.end(fs.readFileSync(out+u.pathname));return;}
 if(u.pathname.startsWith('/api/')||u.pathname.endsWith('.json')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.pathname.includes('brand-counts')?{counts:{BMW:12,Toyota:12},modelCounts:{BMW:2,Toyota:2}}:u.pathname.includes('models')||u.pathname.endsWith('.json')?{version:1,brands:[],models}:{items:[]}));return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<meta name='viewport' content='width=device-width,initial-scale=1'><link rel='stylesheet' href='/app.css'><link rel='stylesheet' href='/${u.searchParams.get('fixture')||'after'}.css'><div id='root'></div><script src='/${u.searchParams.get('fixture')||'after'}.js'></script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});const results=[];
try{for(const mode of modes)for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const report={mode,width,checks:{}};
 await page.goto(origin+`/cars?fixture=${mode}&market=china&make=BMW&model=X3&budget=2500000&powerTo=160&city=Новокузнецк&selection=1`);
 await page.locator('.ac-catalog-filter-panel').waitFor({state:'attached'});
 let scope=page.locator('.ac-catalog-filter-panel');if(width===390){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();scope=page.getByRole('dialog',{name:'Фильтры каталога'});}
 await scope.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();await scope.locator('[data-facet-value="Toyota"]').click();
 report.checks.brandRetainsModel=await scope.locator('input[name=model]').inputValue()==='X3';
 const trigger=scope.getByRole('searchbox',{name:'Модель автомобиля'});await trigger.click();
 const picker=width===390?page.getByRole('dialog',{name:'Выбор моделей'}):scope,input=width===390?picker.getByRole('searchbox',{name:'Поиск модели'}):trigger;
 await input.fill('Corolla');await picker.getByRole('button',{name:'Применить',exact:true}).click();
 report.checks.typedAddsModel=await scope.locator('input[name=model]').inputValue()==='X3|Corolla';
 await page.evaluate(()=>window.__delay=500);
 const budget=scope.getByRole('textbox',{name:'Цена: до',exact:true});await budget.fill('1500000');await budget.press('Tab');
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('budget')==='1500000');
 const current=new URL(page.url()).searchParams;
 report.checks.filtersRetained=['BMW,Toyota'].includes(current.get('make'))&&current.get('model')==='X3|Corolla'&&current.get('powerTo')==='160'&&current.get('city')==='Новокузнецк'&&current.get('selection')==='1';
 // Explicitly removing one model must keep the other selected model.
 if(mode==='after'){await scope.getByRole('button',{name:'Убрать X3',exact:true}).click();assert.equal(await scope.locator('input[name=model]').inputValue(),'Corolla');report.checks.explicitRemoveOnlyOne=true;}
 if(width===390)await scope.locator('button[data-ac-mobile-close="1"]').click();
 await page.goto(origin+`/cars?fixture=${mode}&market=china`);
 await page.getByRole('link',{name:'Автомобиль 10',exact:true}).waitFor();
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await page.getByText('Показано 48 из 48',{exact:true}).waitFor();
 await page.getByRole('link',{name:'Автомобиль 10',exact:true}).scrollIntoViewIfNeeded();const y=await page.evaluate(()=>scrollY);
 await page.getByRole('link',{name:'Автомобиль 10',exact:true}).click();await page.getByRole('heading',{name:'Карточка автомобиля',exact:true}).waitFor();await page.waitForTimeout(80);
 report.checks.newDetailAtTop=await page.evaluate(()=>scrollY<3);
 await page.goBack();await page.getByRole('link',{name:'Автомобиль 10',exact:true}).waitFor();await page.waitForTimeout(80);
 report.checks.backRestoresPositionAndRows=await page.evaluate(y=>Math.abs(scrollY-y)<4&&document.querySelectorAll('article').length===48,y);
 await page.getByRole('link',{name:'Новая статья',exact:true}).click();await page.getByRole('heading',{name:'Статья',exact:true}).waitFor();await page.waitForTimeout(80);
 report.checks.newArticleAtTop=await page.evaluate(()=>scrollY<3);
 await page.getByRole('link',{name:'Новый каталог внизу',exact:true}).click();await page.getByRole('heading',{name:'Каталог',exact:true}).waitFor();await page.waitForTimeout(80);
 report.checks.forwardCatalogAtTop=await page.evaluate(()=>scrollY<3);
 await page.getByRole('link',{name:'Категория Toyota',exact:true}).click();await page.waitForFunction(()=>new URLSearchParams(location.search).get('make')==='Toyota');await page.waitForTimeout(80);
 report.checks.newCategoryAtTop=await page.evaluate(()=>scrollY<3);
 await page.getByRole('link',{name:'Статья с якорем',exact:true}).click();await page.getByRole('heading',{name:'Раздел по якорю',exact:true}).waitFor();await page.waitForTimeout(80);
 report.checks.anchorRespected=await page.evaluate(()=>scrollY>1000);
 report.pageErrors=errors;results.push(report);fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
 if(mode==='after'){assert.deepEqual(errors,[]);for(const [name,passed] of Object.entries(report.checks))assert.equal(passed,true,`${width}: ${name}`);}
 console.log(JSON.stringify(report));await page.close();
}}finally{await browser.close();server.close();}
