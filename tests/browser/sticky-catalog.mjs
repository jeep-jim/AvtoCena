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
const out=`artifacts/sticky-catalog-${live?'live':'local'}-${browserName}`;
fs.mkdirSync(out,{recursive:true});
let server,origin=live;
if(!live){
 const next={name:'isolated-next-navigation',setup(b){
  b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));
  b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'js',contents:args.path.endsWith('navigation')?`const router={push(url){history.pushState(null,'',url);window.__lastFilterUrl=url;},replace(url){history.replaceState(null,'',url);window.__lastFilterUrl=url;}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`:`import React from 'react';export default function Link({children,...props}){delete props.prefetch;return React.createElement('a',props,children);}`,resolveDir:process.cwd()}));
 }};
 for(const mode of ['fixture','baseline'])await build({entryPoints:['tests/browser/sticky-catalog-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/${mode}.js`,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},plugins:[next,...(mode==='baseline'?[{name:'without-new-style',setup(b){b.onLoad({filter:/MobileCatalogDropdowns\.css$/},()=>({contents:'',loader:'css'}));}}]:[])]});
 const sources=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx','apps/web/components/layout/PublicHeader.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
 const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
 const inline=sources.flatMap(({text})=>[...text.matchAll(/(?:const (?:publicUiCorrections|publicPageFixes) = |<style jsx global>\{)`([\s\S]*?)`/g)].map(m=>m[1])).join('\n');
 const css=await postcss([tailwindcss({content:['apps/web/components/home/**/*.tsx','apps/web/components/dealers/**/*.tsx','apps/web/components/ui/**/*.tsx','apps/web/components/catalog/**/*.{ts,tsx}','tests/browser/sticky-catalog-fixture.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
 fs.writeFileSync(`${out}/app.css`,css.css);
 server=http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture');if(u.pathname==='/cars'||u.pathname==='/'){
  const mode=u.searchParams.has('baseline')?'baseline':'fixture';res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark'</script><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/${mode}.css"></head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`);return;}
  let file=path.join(out,path.basename(u.pathname));if(!fs.existsSync(file)){const root=path.resolve('apps/web/public');file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}}
  if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(fs.readFileSync(file));}else{res.statusCode=404;res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
}
const browser=browserName==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const facets={makes:['Toyota','BMW','Mazda'],models:[{make:'Toyota',model:'Corolla'}],bodyTypes:['suv','offroad','sedan','hatchback','wagon','minivan','coupe','convertible','pickup','van'],transmissions:['automatic','manual','cvt','dct'],fuels:['petrol','diesel','hybrid','electric','lpg'],drives:['fwd','rwd','awd']};
try{
 for(const theme of ['dark','light'])for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<1024}),page=await context.newPage();
  await context.route('**/api/catalog/**',r=>r.fulfill({json:{counts:{Toyota:10},modelCounts:{Toyota:4},facets,items:[]}}));
  await page.goto(`${origin}/cars?theme=${theme}&dealer=1`);
  await page.locator('button[aria-label="Открыть фильтры"]').waitFor({state:'attached'});
  if(width<1024)await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
  const scope=page.locator(width<1024?'.ac-mobile-filter-sheet':'.ac-catalog-filter-panel');
  if(width<1024){
   const heading=scope.locator('.ac-mobile-filter-header');
   assert.ok((await heading.boundingBox()).height<=66,'compact mobile header');
   assert.match(await heading.innerText(),/Найдено: 37\s?718/);
   assert.equal(await heading.getByRole('button',{name:'Применить фильтры',exact:true}).innerText(),'ОК');
   await page.screenshot({path:`${out}/sheet-${width}-${theme}.png`});
  }
  const market=scope.locator('input[name="market"]').locator('..');await market.locator(':scope > button').click();await market.getByRole('button',{name:'Зелёный угол',exact:true}).click();
  await page.waitForFunction(()=>location.pathname==='/cars/green');
  const query=new URL(page.url()).searchParams;assert.equal(query.get('market'),'japan');assert.equal(query.get('stock'),'green');assert.equal(query.get('model'),'Corolla Cross');assert.equal(query.get('yearFrom'),'2024');assert.equal(query.get('mileageTo'),'9000');
  if(width<1024)await scope.getByRole('button',{name:'Применить фильтры',exact:true}).click();
  await page.evaluate(()=>scrollTo(0,1100));const bar=page.getByRole('navigation',{name:'Выбранные фильтры и сортировка',exact:true});await bar.waitFor();
  assert.equal(await bar.getByRole('button',{name:'Очистить',exact:true}).count(),0);assert.ok(await bar.getByRole('button',{name:'Убрать Corolla Cross',exact:true}).isVisible());
  const styles=await page.evaluate(()=>{
   const pick=(el,props)=>Object.fromEntries(props.map(p=>[p,getComputedStyle(el)[p]]));
   const surface=['backgroundColor','backdropFilter','borderBottomColor','boxShadow'];
   const chip=['backgroundColor','color','borderRadius','fontSize','fontWeight','paddingLeft','paddingRight','minHeight'];
   return {header:pick(document.querySelector('.ac-public-header'),surface),bar:pick(document.querySelector('.ac-catalog-sticky'),surface),original:pick(document.querySelector('.ac-catalog-filter-panel .ac-filter-chip'),chip),sticky:pick(document.querySelector('.ac-catalog-sticky .ac-filter-chip'),chip)};
  });
  const bounds=await page.evaluate(()=>({content:document.querySelector('.ac-catalog-sticky-sentinel').getBoundingClientRect().left,chips:document.querySelector('.ac-catalog-sticky-chips').getBoundingClientRect().left}));
  assert.ok(bounds.chips>=bounds.content,'Chips stay inside the catalog left edge');
  assert.deepEqual(styles.bar,styles.header,'Pinned surface must match the header');
  assert.deepEqual(styles.sticky,styles.original,'Pinned chips must match existing selected chips');
  const rect=await bar.boundingBox(),header=await page.locator('.ac-public-header').boundingBox();assert.ok(Math.abs(rect.y-(header.y+header.height))<2);assert.ok(rect.width<=width);
  await bar.getByRole('button',{name:'Сортировка автомобилей',exact:true}).click();await bar.getByRole('button',{name:'Сначала дороже',exact:true}).click();await page.waitForFunction(()=>new URLSearchParams(location.search).get('sort')==='totalRubDesc');
  assert.equal(new URL(page.url()).searchParams.get('stock'),'green');
  await page.screenshot({path:`${out}/${width}-${theme}.png`});
  await bar.getByRole('button',{name:'Убрать Corolla Cross',exact:true}).click();await page.waitForFunction(()=>!new URLSearchParams(location.search).has('model'));
  await bar.getByRole('button',{name:'Наверх к фильтрам',exact:true}).click();await page.waitForFunction(()=>scrollY<2);await bar.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width<1024){
   await page.goto(`${origin}/cars?theme=${theme}&empty=1`);
   await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
   const emptySheet=page.locator('.ac-mobile-filter-sheet');
   assert.equal(await emptySheet.getByRole('button',{name:'Закрыть',exact:true}).innerText(),'×');
   await emptySheet.getByRole('button',{name:'Цена',exact:true}).click();
   await emptySheet.getByRole('button',{name:'Применить фильтры',exact:true}).click();
   await page.waitForFunction(()=>new URLSearchParams(location.search).get('sort')==='totalRub');
   assert.equal(await page.locator('.ac-mobile-filter-sheet').count(),0);
  }
  console.log(JSON.stringify({width,theme,greenPreservesFilters:true,stickyChips:true,sortPreservesFilters:true,backToTop:true}));await context.close();
 }
}finally{await browser.close();server?.close();}
