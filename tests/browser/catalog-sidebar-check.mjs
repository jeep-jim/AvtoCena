import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const live=process.env.LIVE_ORIGIN||'';
const browserName=process.env.FILTER_BROWSER||'chromium';
const out=`artifacts/mobile-filter-${live?'live':'local'}-${browserName}`;
fs.mkdirSync(out,{recursive:true});
let server,origin=live;
if(!live){
 const next={name:'isolated-next-navigation',setup(b){
  b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));
  b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'js',contents:args.path.endsWith('navigation')?`const router={prefetch(){},push(url){history.pushState(null,'',url);window.__lastFilterUrl=url;},replace(url){history.replaceState(null,'',url);window.__lastFilterUrl=url;}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`:`import React from 'react';export default function Link({children,...props}){delete props.prefetch;return React.createElement('a',props,children);}`,resolveDir:process.cwd()}));
 }};
 for(const mode of ['fixture','baseline'])await build({entryPoints:['tests/browser/catalog-sidebar-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/${mode}.js`,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[next,...(mode==='baseline'?[{name:'without-new-style',setup(b){b.onLoad({filter:/MobileCatalogDropdowns\.css$/},()=>({contents:'',loader:'css'}));}}]:[])]});
 const sources=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
 const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
 const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
 const css=await postcss([tailwindcss({content:['apps/web/components/home/**/*.tsx','apps/web/components/dealers/**/*.tsx','apps/web/components/ui/**/*.tsx','apps/web/components/catalog/**/*.{ts,tsx}','tests/browser/catalog-sidebar-fixture.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
 fs.writeFileSync(`${out}/app.css`,css.css);
 server=http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture');if(u.pathname==='/cars'||u.pathname==='/'){
  const mode=u.searchParams.has('baseline')?'baseline':'fixture';res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark'</script><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/${mode}.css"></head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`);return;}
  let file=path.join(out,path.basename(u.pathname));if(!fs.existsSync(file)){const root=path.resolve('apps/web/public');file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}}
  if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(fs.readFileSync(file));}else{res.statusCode=404;res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
}
const browser=browserName==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const facets={makes:['Toyota','BMW','Mazda'],models:[{make:'Toyota',model:'Corolla'}],bodyTypes:['suv','offroad','sedan','hatchback','wagon','minivan','coupe','convertible','pickup','van'],transmissions:['automatic','manual','cvt','dct'],fuels:['petrol','diesel','hybrid','electric','lpg'],drives:['fwd','rwd','awd']};
const results=[];let current={};
const save=()=>fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
async function contextFor(width){const c=await browser.newContext({viewport:{width,height:900},hasTouch:width<1024,serviceWorkers:'block'});
 if(!live)await c.route('**/api/catalog/**',r=>r.fulfill({json:r.request().url().includes('brand-counts')?{counts:{Toyota:10,BMW:8,Mazda:5},modelCounts:{Toyota:4,BMW:3,Mazda:2}}:{facets,items:[{id:'corolla',make:'Toyota',model:'Corolla',label:'Toyota Corolla'}]}}));return c;}
async function openSheet(page){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();const sheet=page.locator('.ac-mobile-filter-sheet');await sheet.waitFor();if(!live){assert.equal(await sheet.evaluate(el=>el.parentElement.parentElement===document.body),true,'filter must escape dealer stacking contexts');assert.equal(await page.evaluate(()=>[20,innerHeight-20].every(y=>document.elementFromPoint(innerWidth/2,y)?.closest('.ac-mobile-filter-backdrop'))),true,'filter overlay must cover header and bottom dock');}await page.waitForTimeout(350);const headingColor=await sheet.locator('.ac-mobile-filter-header [role="status"]').evaluate(el=>getComputedStyle(el).color);if(await page.evaluate(()=>document.documentElement.dataset.theme==='light'))assert.notEqual(headingColor,'rgb(255, 255, 255)','light filter heading must remain readable outside page wrapper');if(!page.url().includes('baseline=1'))assert.equal(await page.locator('.ac-notice-stack').isVisible(),false,'notices must not cover the modal filter controls');return sheet;}
async function positions(scope){return scope.locator('.ac-filter-control,.ac-sort-control,.ac-range-card').evaluateAll(els=>els.filter(el=>el.getClientRects().length>0).map(el=>{const s=el.closest('.ac-mobile-filter-sheet')?.querySelector(':scope > .ac-hide-scrollbar');const r=el.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y+(s?.scrollTop||0)),Math.round(r.width),Math.round(r.height)];}));}
async function menuGeometry(page,root,menu,expectedWidth){const r=await root.boundingBox(),m=await menu.boundingBox();assert.ok(r&&m);assert.equal(await menu.evaluate(el=>getComputedStyle(el).position),'absolute');assert.ok(Math.abs(m.width-expectedWidth)<3,`width ${JSON.stringify({r,m,expectedWidth})}`);assert.ok(m.x>=-1&&m.x+m.width<=page.viewportSize().width+1);assert.ok(m.y>=r.y+r.height&&m.y-r.y-r.height<=13);return {width:m.width,height:m.height,gap:m.y-r.y-r.height};}
try{
 for(const width of [390,1280,1600]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
 await page.route('**/api/catalog/brand-counts**',route=>route.fulfill({json:{counts:{Toyota:10,BMW:8}}}));
 const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.error('PAGE_ERROR',String(e));});await page.goto(origin+'/cars');await page.waitForTimeout(1000);assert.deepEqual(errors,[]);
 const sidebar=page.locator('.ac-catalog-sidebar');
 assert.deepEqual(await page.locator('.ac-brand-rail a').allTextContents(),['Toyota']);
 if(width>=1024){
 const b=await sidebar.boundingBox(),r=await page.locator('.ac-catalog-results').boundingBox(),h=await page.locator('.ac-catalog-heading').boundingBox();assert.ok(b.x>r.x+r.width-2);assert.ok(b.y<=h.y+1,'sidebar starts with the heading');
 assert.equal(await sidebar.evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
 assert.equal(await page.getByRole('button',{name:/Выбрать город. Сейчас/}).count(),0);
 assert.equal(await sidebar.getByRole('button',{name:'Убрать Кроссовер',exact:true}).count(),0);
 assert.equal(await page.locator('.ac-catalog-selection').getByRole('button',{name:'Убрать Кроссовер',exact:true}).isVisible(),true);
 await page.evaluate(()=>scrollTo(0,500));await page.waitForTimeout(100);const a=await sidebar.boundingBox();assert.ok(Math.abs(a.y-88)<2,JSON.stringify(a));
 assert.equal(await page.locator('.ac-catalog-filter-panel').isVisible(),true);
 const toolbar=page.locator('.ac-catalog-toolbar');assert.ok(Math.abs((await toolbar.boundingBox()).y-64)<2,'toolbar joins header without a gap');
 assert.notEqual(await toolbar.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
 const toggle=await page.locator('.ac-catalog-view-toggle').boundingBox(),selection=await page.locator('.ac-catalog-selection').boundingBox();assert.ok(toggle.x<selection.x,'view controls are on the left');
 const controls=await sidebar.locator('.ac-catalog-filter-panel .ac-filter-control').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect().height));assert.ok(controls.every(height=>height<=39),JSON.stringify(controls));
 }else assert.equal(await page.locator('.ac-filter-more-button').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(()=>scrollTo(0,0));
 await page.getByRole('button',{name:'Список',exact:true}).click();
 await page.locator('.ac-catalog-list-row').first().waitFor();assert.equal(await page.locator('.ac-catalog-list-row').count(),6);
 assert.equal(await page.getByText('Лот 12345',{exact:true}).count(),6);
 assert.equal(await page.locator('.ac-list-price').count(),6);
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.getByRole('button',{name:'Скопировать код кузова DBA-L175S',exact:true}).first().click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'DBA-L175S');
 assert.equal(await page.locator('.ac-catalog-list-row').first().evaluate(el=>getComputedStyle(el).borderRadius),'0px');
 assert.equal(await page.locator('.ac-catalog-list-row').first().evaluate(el=>getComputedStyle(el).isolation),'isolate');
 const rows=await page.locator('.ac-catalog-list-row').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})));
 assert.ok(Math.abs(rows[1].top-rows[0].bottom)<2,'list rows touch with a divider');
 if(width>=1024){
   assert.equal(await sidebar.getByRole('button',{name:'Дешевле',exact:true}).count(),1);
   assert.equal(await page.locator('.ac-catalog-selection .ac-sort-control').count(),0);
 }

 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'list stays inside viewport');
 await page.screenshot({path:out+'/list-'+width+'.png'});
 await page.reload();await page.waitForTimeout(500);
 assert.equal(await page.getByRole('button',{name:'Список',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Плитка',exact:true}).click();
 await page.locator('.ac-catalog-card').first().waitFor();assert.equal(await page.locator('.ac-catalog-card').count(),6);
 await page.screenshot({path:out+'/sidebar-'+width+'.png'});
 if(width>=1024){await page.locator('.ac-catalog-selection').getByRole('button',{name:'Очистить',exact:true}).click();await page.waitForTimeout(200);assert.equal(await page.locator('.ac-catalog-selection .ac-filter-chip').count(),0);}console.log('SIDEBAR_OK',width);await context.close();
 }
}finally{await browser.close();server?.close();}
