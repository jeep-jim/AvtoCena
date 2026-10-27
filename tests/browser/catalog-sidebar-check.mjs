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
 const sources=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx','apps/web/components/layout/RoutePreloader.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
 const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
 const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes|publicLayoutFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
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
async function verifyBrandSelection(page,scope){
 await scope.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();
 const options=scope.locator('.ac-brand-options [data-facet-value]');
 assert.equal(await options.first().getAttribute('aria-pressed'),'true','selected brand is first');
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const colors=await options.first().evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,check:getComputedStyle(el.lastElementChild).color}));
  assert.notEqual(colors.background,'rgb(255, 53, 61)');assert.equal(colors.check,'rgb(255, 53, 61)');assert.notEqual(colors.color,colors.check);
 }
 await scope.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();
}
async function verifyControls(page,scope){
 const sort=scope.locator('.ac-sort-select');
 assert.equal(await sort.locator('input[name="sort"]').inputValue(),'');
 await sort.locator(':scope > button').click();
 for(const [value,label] of [['totalRub','Сначала дешевле'],['totalRubDesc','Сначала дороже'],['year','Сначала новые'],['yearAsc','Сначала старые'],['mileage','Меньше пробег'],['mileageDesc','Больше пробег']]){
  await sort.getByRole('button',{name:'Без сортировки',exact:true}).click();
  await sort.getByRole('button',{name:label,exact:true}).click();
  assert.equal(await sort.locator('input[name="sort"]').inputValue(),value);
 }
 await sort.getByRole('button',{name:'Без сортировки',exact:true}).click();
 await sort.getByRole('button',{name:'Сначала дешевле',exact:true}).click();
 await sort.getByRole('button',{name:'Меньше пробег',exact:true}).click();
 assert.equal(await sort.locator('input[name="sort"]').inputValue(),'totalRub,mileage');
 await sort.getByRole('button',{name:'Сначала дороже',exact:true}).click();
 assert.equal(await sort.locator('input[name="sort"]').inputValue(),'totalRubDesc,mileage');
 await sort.getByRole('button',{name:'Без сортировки',exact:true}).click();
 await page.keyboard.press('Escape');assert.equal(await sort.locator('.ac-filter-dropdown').count(),0);
 const color=scope.locator('.ac-color-select');
 await color.locator(':scope > button').click();
 await color.getByRole('button',{name:'Белый',exact:true}).click();
 assert.equal(await color.locator('input[name="color"]').inputValue(),'Белый');
 assert.equal(await color.locator(':scope > button span[aria-hidden]').count(),1);
 await color.locator(':scope > button').click();await color.getByRole('button',{name:'Любой цвет',exact:true}).click();
 assert.equal(await color.locator('input[name="color"]').inputValue(),'');
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const fields=await scope.locator('.ac-power-limit,.ac-electric-filter,.ac-sort-select > button').evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return {radius:s.borderRadius,background:s.backgroundColor,border:s.borderTopWidth==='0px'?'none':s.borderTopColor,borderWidth:s.borderTopWidth,height:el.getBoundingClientRect().height};}));
  assert.deepEqual(fields[0],fields[1],theme+' quick fields match');
  assert.deepEqual(fields[0],fields[2],theme+' quick fields match dropdown');
  const checks=await scope.locator('.ac-power-limit input[type=checkbox],.ac-electric-filter input[type=checkbox]').evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return {width:s.width,height:s.height,border:s.border,background:s.backgroundColor,radius:s.borderRadius};}));
  const copy=await scope.locator('.ac-power-copy').evaluate(el=>{const r=el.getBoundingClientRect(),label=el.closest('label').getBoundingClientRect();return {width:r.width,bottom:r.bottom,labelBottom:label.bottom,color:getComputedStyle(el).color};});
  assert.ok(copy.width>80,'power label must not inherit the old fake checkbox width');assert.ok(copy.bottom<=copy.labelBottom+1,'power text stays within its field');assert.notEqual(copy.color,'rgba(0, 0, 0, 0)');
  assert.equal(checks.length,2);assert.deepEqual(checks[0],checks[1],theme+' checkboxes match');
  const power=scope.locator('.ac-power-limit input[type=checkbox]');await power.check();
  assert.equal(await scope.locator('.ac-power-copy').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)',theme+' checked power must not paint its text as a checkbox');
  await power.uncheck();
 }
}
try{
 if(!live)for(const width of [390,1280]){
  const context=await contextFor(width),page=await context.newPage();
  await page.goto(origin+'/cars?marketPreview=1');
  const count=page.locator('.ac-market-result-count').first();await count.waitFor();
  assert.equal(await count.locator('span.hidden').isVisible(),width>=768);
  assert.equal(await count.evaluate(el=>getComputedStyle(el).fontWeight),'400');
  const visible=await page.locator('.ac-catalog-market-rail > div').evaluateAll(els=>els.filter(el=>getComputedStyle(el).display!=='none').length);
  assert.equal(visible,width<768?6:5);
  assert.equal(await page.locator('.ac-catalog-card:visible').count(),width<768?6:5);
  // Count actual published cards, not only their grid wrappers.
  const cards=await page.locator('.ac-catalog-card:visible').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().top));
  assert.ok(cards.every(top=>Math.abs(top-cards[0])<2),'preview cards occupy one row');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width>=768){const title=await count.boundingBox(),tabs=await page.getByRole('navigation',{name:'Автомобили из Японии'}).boundingBox();assert.ok(tabs.x>title.x+title.width);}
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:out+'/market-preview-'+width+'-'+theme+'.png'});}
  await context.close();
 }
 if(!live)for(const width of [390,1024,1280,1440,1600]){
  const context=await contextFor(width),page=await context.newPage();
  await page.goto(origin+'/cars?marketPreview=1&sidebar=1');
  await page.locator('[data-test-overall-count]').waitFor();
  assert.equal(await page.locator('[data-test-overall-count]').getByText('Найдено:',{exact:true}).isVisible(),true);
  assert.equal(await page.locator('.ac-catalog-card:visible').count(),6);
  const tops=await page.locator('.ac-catalog-card:visible').evaluateAll(els=>els.map(el=>Math.round(el.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size,width>=1024?2:1);
  if(width>=1024){assert.equal(tops.filter(t=>t===tops[0]).length,3);assert.equal(tops.filter(t=>t===tops[3]).length,3);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:out+'/sidebar-preview-'+width+'-'+theme+'.png'});}
  await context.close();
 }
 if(!live)for(const width of [390,1280]){
  const context=await contextFor(width),page=await context.newPage();
  await page.goto(origin+'/cars?market=japan');
  const scope=width<1024?await openSheet(page):page.locator('.ac-catalog-sidebar');
  const power=scope.locator('.ac-power-limit input[type=checkbox]');
  await power.check();await page.waitForTimeout(350);
  if(width<1024)await page.getByRole('button',{name:/Показать/}).last().click();
  await page.waitForTimeout(400);
  assert.equal(new URL(page.url()).searchParams.get('powerTo'),'160');
  assert.equal(await page.locator('.ac-route-loader[aria-hidden="false"]').count(),0,'real CatalogFilters must not activate the header loader');
  assert.equal(await page.locator('.ac-catalog-card').count(),6,'previous cards remain while the selected filter is pending');
  assert.equal(new URL(page.url()).searchParams.get('market'),'japan');
  await page.screenshot({path:out+'/japan-power-'+width+'.png'});
  await context.close();
 }
 for(const width of [390,1280,1600]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
 await page.route('**/api/catalog/colors**',route=>route.fulfill({json:{ok:true,colors:['Белый','Чёрный','Особый'],partial:false}}));
 await page.route('**/api/catalog/brand-counts**',route=>route.fulfill({json:{counts:{Toyota:10,BMW:8}}}));
 const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.error('PAGE_ERROR',String(e));});await page.goto(origin+'/cars');await page.waitForTimeout(500);assert.equal(await page.locator('.ac-brand-rail a').count(),1,'unselected rail remains visible');await page.goto(origin+'/cars?make=Toyota');await page.waitForTimeout(1000);assert.deepEqual(errors,[]);
 const sidebar=page.locator('.ac-catalog-sidebar');
 assert.equal(await page.locator('.ac-brand-rail a').count(),0,'selected makes hide the duplicate brand rail');
 if(width>=1024){
 const b=await sidebar.boundingBox(),r=await page.locator('.ac-catalog-results').boundingBox(),h=await page.locator('.ac-catalog-heading').boundingBox();assert.ok(b.x+b.width<=r.x,'filters remain left of results');assert.ok(b.y<=h.y+1,'sidebar starts with the heading');
 assert.equal(await sidebar.evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
 await sidebar.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();
 await page.waitForTimeout(150);
 const brandMenu=sidebar.locator('.ac-filter-dropdown');
 const menuBounds=await brandMenu.boundingBox();
 assert.ok(menuBounds.x>=b.x&&menuBounds.x+menuBounds.width<=b.x+b.width,'make menu stays inside sidebar');
 assert.equal(await brandMenu.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'make menu has no horizontal clipping');
 const brandSearch=await brandMenu.locator('input').boundingBox();
 assert.ok(brandSearch.x>=menuBounds.x&&brandSearch.x+brandSearch.width<=menuBounds.x+menuBounds.width,'whole search field is visible');
 await page.keyboard.press('Escape');
 await verifyBrandSelection(page,sidebar);

 assert.equal(await sidebar.getByRole('button',{name:/Выбрать город. Сейчас/}).count(),1);
 assert.equal(await sidebar.locator('.ac-catalog-filter-panel .ac-filter-control').first().getAttribute('aria-haspopup'),'dialog');
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
 if(width<1024){
   await page.evaluate(()=>localStorage.setItem('ac-catalog-view','list'));
   await page.reload();await page.locator('.ac-catalog-card').first().waitFor();
   assert.equal(await page.locator('.ac-catalog-toolbar').isVisible(),false);
   assert.equal(await page.locator('.ac-catalog-list-row').count(),0);
   assert.equal(await page.locator('.ac-catalog-card').count(),6);
   assert.equal(await page.locator('[data-catalog-view]').getAttribute('data-catalog-view'),'grid');
   await page.screenshot({path:out+'/sidebar-'+width+'.png'});
   const sheet=await openSheet(page);await verifyBrandSelection(page,sheet);await verifyControls(page,sheet);await page.screenshot({path:out+'/controls-mobile.png'});
   await page.keyboard.press('Escape');await page.evaluate(()=>scrollTo(0,900));const sticky=page.getByRole('button',{name:'Открыть фильтры каталога',exact:true});await sticky.waitFor();await sticky.click();await page.getByRole('dialog',{name:'Фильтры каталога'}).waitFor();await page.keyboard.press('Escape');console.log('MOBILE_GRID_ONLY_OK',width);await context.close();continue;
 }
 await page.getByRole('button',{name:'Список',exact:true}).click();
 await page.locator('.ac-catalog-list-row').first().waitFor();assert.equal(await page.locator('.ac-catalog-list-row').count(),6);
 assert.equal(await page.getByText('Лот 12345',{exact:true}).count(),6);
 assert.equal(await page.locator('.ac-list-price').count(),6);
 for(const theme of ['light','dark']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const surface=await page.locator('.ac-catalog-market-rail').first().evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,border:s.borderTopWidth,page:s.getPropertyValue('--ac-page-bg').trim()};});
   assert.notEqual(surface.background,'rgba(0, 0, 0, 0)',theme+' list container must be visible');
   assert.equal(surface.border,'1px',theme+' list container has an outline');
   await page.screenshot({path:out+'/list-'+theme+'-'+width+'.png'});
 }

 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.getByRole('button',{name:'Скопировать код кузова DBA-L175S',exact:true}).first().click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'DBA-L175S');
 assert.equal(await page.locator('.ac-catalog-list-row').first().evaluate(el=>getComputedStyle(el).borderRadius),'0px');
 assert.equal(await page.locator('.ac-catalog-list-row').first().evaluate(el=>getComputedStyle(el).isolation),'isolate');
 const rows=await page.locator('.ac-catalog-list-row').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})));
 assert.ok(Math.abs(rows[1].top-rows[0].bottom)<2,'list rows touch with a divider');
 if(width>=1024){
   await verifyControls(page,sidebar);
   // Return the sticky containing block to the viewport after the shorter list view.
   await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);
   const range=sidebar.getByRole('button',{name:'Выбрать значение: Объём двигателя: от',exact:true});
   await range.evaluate(el=>{const side=el.closest('.ac-catalog-sidebar');side.scrollTop+=el.getBoundingClientRect().bottom-side.getBoundingClientRect().bottom+8;});
   await range.click();
   const menu=sidebar.locator('.ac-range-value-menu.is-open');
   await menu.waitFor();
   const geometry=await menu.evaluate(el=>{const r=el.getBoundingClientRect(),s=el.closest('.ac-catalog-sidebar').getBoundingClientRect();return {top:r.top,bottom:r.bottom,sideTop:s.top,sideBottom:s.bottom,up:el.classList.contains('is-up')};});
   assert.ok(geometry.up,JSON.stringify(geometry));
   assert.ok(geometry.top>=geometry.sideTop-1&&geometry.bottom<=geometry.sideBottom+1,JSON.stringify(geometry));
   await range.click();

 }

 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'list stays inside viewport');
 await page.screenshot({path:out+'/list-'+width+'.png'});
 await page.reload();await page.waitForTimeout(500);
 assert.equal(await page.getByRole('button',{name:'Список',exact:true}).getAttribute('aria-pressed'),'true');
 await page.setViewportSize({width:390,height:900});
 await page.locator('.ac-catalog-card').first().waitFor();
 assert.equal(await page.locator('.ac-catalog-toolbar').isVisible(),false);
 assert.equal(await page.locator('.ac-catalog-list-row').count(),0);
 assert.equal(await page.evaluate(()=>localStorage.getItem('ac-catalog-view')),'list');
 await page.setViewportSize({width,height:900});
 await page.locator('.ac-catalog-list-row').first().waitFor();
 await page.getByRole('button',{name:'Плитка',exact:true}).click();
 await page.locator('.ac-catalog-card').first().waitFor();assert.equal(await page.locator('.ac-catalog-card').count(),6);
 await page.screenshot({path:out+'/sidebar-'+width+'.png'});
 if(width>=1024){await page.locator('.ac-catalog-selection').getByRole('button',{name:'Очистить',exact:true}).click();await page.waitForTimeout(200);assert.equal(await page.locator('.ac-catalog-selection .ac-filter-chip').count(),0);}console.log('SIDEBAR_OK',width);await context.close();
 }
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  const directory={version:1,brands:[],models:Array.from({length:180},(_,i)=>['Toyota','Version '+String(i).padStart(3,'0'),[],1])};
  await page.route('**/model-directory.*.json',route=>route.fulfill({json:directory}));
  await page.route('**/api/catalog/**',route=>route.fulfill({json:route.request().url().includes('models?')?{version:1,brands:[],models:[]}:route.request().url().includes('brand-counts')?{counts:{Toyota:180},modelCounts:{Toyota:180}}:{ok:true,colors:[]}}));
  await page.goto(origin+'/cars');
  const scope=width<1024?await openSheet(page):page.locator('.ac-catalog-sidebar');
  const city=scope.getByRole('button',{name:/Выбрать город. Сейчас/});
  const cityBox=await city.boundingBox(),brandBox=await scope.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).boundingBox();
  assert.ok(cityBox.y<brandBox.y,'City comes before brand/model');
  assert.equal(await city.locator('svg').first().evaluate(el=>getComputedStyle(el).color),'rgb(255, 53, 61)');
  await city.click();await page.getByRole('dialog',{name:'Выбор города',exact:true}).getByRole('button',{name:'Москва',exact:true}).click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('avtocena_city')),'Москва');
  assert.equal(new URL(page.url()).searchParams.get('city'),'Москва');
  assert.equal(new URL(page.url()).searchParams.get('bodyType'),'suv','City retains current filters');
  assert.ok(await city.textContent().then(text=>text.includes('Москва')));
  await scope.getByRole('searchbox',{name:'Модель автомобиля',exact:true}).click();
  const picker=width<1024?page.getByRole('dialog',{name:'Выбор моделей'}):scope;
  await picker.getByRole('button',{name:/Показать ещё/}).click();
  await picker.getByRole('button',{name:/Показать ещё/}).click();
  await picker.getByRole('button',{name:'Version 179 Toyota',exact:true}).click();
  assert.equal(await scope.locator('input[name=model]').inputValue(),'Version 179');
  console.log('ALL_MODELS_SELECTABLE',width,180);
  await context.close();
 }
}finally{await browser.close();server?.close();}
