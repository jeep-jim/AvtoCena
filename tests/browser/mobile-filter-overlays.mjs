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
  b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'js',contents:args.path.endsWith('navigation')?`const router={push(url){history.pushState(null,'',url);window.__lastFilterUrl=url;},replace(url){history.replaceState(null,'',url);window.__lastFilterUrl=url;}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`:`import React from 'react';export default function Link({children,...props}){delete props.prefetch;return React.createElement('a',props,children);}`,resolveDir:process.cwd()}));
 }};
 for(const mode of ['fixture','baseline'])await build({entryPoints:['tests/browser/mobile-filter-overlay-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/${mode}.js`,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},plugins:[next,...(mode==='baseline'?[{name:'without-new-style',setup(b){b.onLoad({filter:/MobileCatalogDropdowns\.css$/},()=>({contents:'',loader:'css'}));}}]:[])]});
 const sources=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
 const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
 const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
 const css=await postcss([tailwindcss({content:['apps/web/components/catalog/**/*.{ts,tsx}','tests/browser/mobile-filter-overlay-fixture.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
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
async function openSheet(page){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();const sheet=page.locator('.ac-mobile-filter-sheet');await sheet.waitFor();await page.waitForTimeout(350);if(!page.url().includes('baseline=1'))assert.equal(await page.locator('.ac-notice-stack').isVisible(),false,'notices must not cover the modal filter controls');return sheet;}
async function positions(scope){return scope.locator('.ac-filter-control,.ac-sort-control,.ac-range-card').evaluateAll(els=>els.map(el=>{const s=el.closest('.ac-mobile-filter-sheet')?.querySelector(':scope > .ac-hide-scrollbar');const r=el.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y+(s?.scrollTop||0)),Math.round(r.width),Math.round(r.height)];}));}
async function menuGeometry(page,root,menu,expectedWidth){const r=await root.boundingBox(),m=await menu.boundingBox();assert.ok(r&&m);assert.equal(await menu.evaluate(el=>getComputedStyle(el).position),'absolute');assert.ok(Math.abs(m.width-expectedWidth)<3,`width ${JSON.stringify({r,m,expectedWidth})}`);assert.ok(m.x>=-1&&m.x+m.width<=page.viewportSize().width+1);assert.ok(m.y>=r.y+r.height&&m.y-r.y-r.height<=13);return {width:m.width,height:m.height,gap:m.y-r.y-r.height};}
try{
 for(const theme of ['dark','light'])for(const width of [320,360,390,414,768,1023,1280]){
  current={theme,width};const c=await contextFor(width),page=await c.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  try{
   await page.goto(`${origin}/cars${live?'':`?theme=${theme}`}`,{waitUntil:'domcontentloaded',timeout:90000});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Открыть фильтры"]');return b&&!b.disabled;});
   const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
   if(width>=1024){
    const desktop=page.locator('.ac-catalog-filter-panel');await desktop.waitFor({state:'visible'});
    const toggle=desktop.getByRole('button',{name:'Расширенные фильтры',exact:true});if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
    // The enhancer decorates newly mounted ranges on the next animation frame.
    // Measure the ready controls, not the pre-enhancement intermediate layout.
    await page.waitForFunction(()=>{const boxes=[...document.querySelectorAll('.ac-catalog-filter-panel .ac-range-input-box')];return boxes.length>0&&boxes.every(box=>box.querySelector('.ac-range-value-toggle'));});
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const before=await positions(desktop);const root=desktop.locator('input[name="bodyType"]').locator('..');await root.locator(':scope > button').click();const menu=root.locator(':scope > .ac-filter-dropdown');await menu.waitFor();
    assert.equal(await menu.evaluate(el=>getComputedStyle(el).position),'absolute');assert.deepEqual(await positions(desktop),before);assert.ok(Math.abs((await menu.boundingBox()).width-(await root.boundingBox()).width)<2,'desktop remains single-control width');
    await root.locator(':scope > button').click();
    if(!live){
      const engine=desktop.getByRole('textbox',{name:'Объём двигателя: до',exact:true});
      for(const [typed,expected] of [['1,5','1500'],['1.5','1500'],['1498','1498']]){
        await engine.fill(typed);await engine.press('Tab');
        await page.waitForFunction(expected=>new URLSearchParams(location.search).get('engineTo')===expected,expected);
        assert.equal(await engine.inputValue(),expected);
      }
      const budget=desktop.getByRole('textbox',{name:'Цена: до',exact:true});await budget.fill('2000000');await budget.press('Tab');
      await page.waitForFunction(()=>new URLSearchParams(location.search).get('budget')==='2000000');
      const market=desktop.locator('input[name="market"]').locator('..');await market.locator(':scope > button').click();
      await market.getByRole('button',{name:'Корея',exact:true}).click();
      await page.waitForFunction(()=>new URLSearchParams(location.search).get('market')==='korea');
      assert.equal(new URL(page.url()).searchParams.get('budget'),'2000000');
      assert.equal(new URL(page.url()).searchParams.get('engineTo'),'1498');
    }
    results.push({...current,desktopUnchanged:true,engineUnits:true,budgetPreserved:true});save();continue;
   }
   const sheet=await openSheet(page),row=sheet.locator('.ac-advanced-select-row');const before=await positions(sheet);const checks=[];
   if(!live){
    const bc=await contextFor(width),bp=await bc.newPage();await bp.goto(`${origin}/cars?baseline=1&theme=${theme}`);const bs=await openSheet(bp);assert.deepEqual(await positions(bs),before,'closed layout must equal the original');await bc.close();
   }
   for(const name of ['bodyType','transmission','fuel','drive']){
    current={theme,width,name};const root=row.locator(`input[name="${name}"]`).locator('..');if(!await root.count()){assert.ok(live,'all fixture categories required');continue;}
    await root.locator(':scope > button').click();const menu=root.locator(':scope > .ac-filter-dropdown');await menu.waitFor();const metric=await menuGeometry(page,root,menu,(await row.boundingBox()).width);
    assert.deepEqual(await positions(sheet),before,'dropdown cannot push any closed filter or range row');
    assert.equal(await sheet.locator('.ac-filter-dropdown').count(),1);
    assert.equal(await menu.locator(':scope > .ac-hide-scrollbar').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    const gap=await row.evaluate(el=>parseFloat(getComputedStyle(el).columnGap));assert.ok(Math.abs(metric.gap-gap)<2,'gap must match the tile gap');
    if(width===390&&(name==='bodyType'||name==='fuel'))await page.screenshot({path:`${out}/${theme}-${width}-${name}.png`});
    await root.locator(':scope > button').click();assert.equal(await root.locator('.ac-filter-dropdown').count(),0);checks.push({name,...metric});
   }
   const brand=sheet.locator('input[name="make"]').locator('..');await brand.locator(':scope > button').click();await brand.locator('.ac-filter-dropdown').waitFor();await menuGeometry(page,brand,brand.locator('.ac-filter-dropdown'),(await brand.boundingBox()).width);assert.deepEqual(await positions(sheet),before);await brand.locator(':scope > button').click();
   const model=sheet.locator('input[name="model"]').locator('..');await model.locator(':scope > input').focus();await model.locator('.ac-filter-dropdown').waitFor();assert.deepEqual(await positions(sheet),before);await sheet.getByRole('heading',{name:'Фильтры',exact:true}).click();
   for(const card of await sheet.locator('.ac-range-card').all())for(const box of await card.locator('.ac-range-input-box--menu').all()){
    current={theme,width,name:'range'};const toggle=box.locator('.ac-range-value-toggle');await toggle.click();const menu=box.locator('.ac-range-value-menu.is-open');await menu.waitFor();assert.equal(await menu.evaluate(el=>getComputedStyle(el).position),'absolute');assert.deepEqual(await positions(sheet),before,'range menu cannot grow a row');const b=await menu.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1);await toggle.click();
   }
   // Selection stays a draft until the sheet closes; no data-changing requests.
   const body=row.locator('input[name="bodyType"]').locator('..');await body.locator(':scope > button').click();const options=body.locator('.ac-filter-option:not(.ac-facet-incompatible)');const option=options.filter({hasText:'Кроссовер'});if(await option.count()){
    const previousUrl=page.url();await option.click();assert.equal(await body.locator('input[name="bodyType"]').inputValue(),'suv');assert.equal(page.url(),previousUrl);assert.equal(await body.locator('.ac-filter-dropdown').count(),0);
    await sheet.locator(':scope > div:first-child button[aria-label="Закрыть"],:scope > div:first-child button[data-ac-mobile-close="1"]').click();await page.waitForURL(/bodyType=suv/,{timeout:30000});if(!live)assert.equal(await page.locator('.ac-notice-stack').isVisible(),true,'city notice returns after closing the filter sheet');
   }
   if(!live)assert.deepEqual(errors,[]);results.push({theme,width,menus:checks,noLayoutShift:true,rangeOverlays:true,selection:true,pageErrors:errors});save();
  }catch(e){fs.writeFileSync(`${out}/failure.json`,JSON.stringify({...current,error:String(e),pageErrors:errors},null,2));await page.screenshot({path:`${out}/failure.png`,fullPage:true});throw e;}finally{await c.close();}
 }
 console.log(JSON.stringify({passed:true,mode:live?'live':'fixture',browser:browserName,cases:results.length}));
}finally{save();await browser.close();if(server)await new Promise(r=>server.close(r));}
