from pathlib import Path

def replace(path,before,after):
    p=Path(path); text=p.read_text(); assert text.count(before)==1,(path,text.count(before),before[:100]);p.write_text(text.replace(before,after))

sidebar='apps/web/components/catalog/CatalogSidebar.tsx'
old=Path(sidebar).read_text()
Path('tests/browser/catalog-sidebar-baseline.generated.tsx').write_text(old.replace("'./", "'../../apps/web/components/catalog/").replace('export function CatalogSidebar(', 'export function CatalogSidebarBaseline('))
Path(sidebar).write_text('''import {RetainedCatalogResults} from './RetainedCatalogResults';
import type {ReactNode} from 'react';
import {CatalogSelectionProvider,CatalogSelectionOutlet} from './CatalogSelectionContext';
import './catalog-sidebar.css';
type Props={header?:ReactNode;filters:ReactNode;children:ReactNode;resultScope?:string;resultError?:string;dealerLayout?:boolean;brandRail?:ReactNode;headerAfterBrands?:ReactNode};
/** The public catalog keeps one rail in the DOM; CSS alone positions the slots. */
export function CatalogSidebar({header,filters,children,resultScope,resultError,dealerLayout=false,brandRail,headerAfterBrands}:Props){
 const singleRail=!dealerLayout&&brandRail!==undefined;
 return <CatalogSelectionProvider dealerLayout={dealerLayout}>
  <div className={`ac-catalog-layout${dealerLayout?' ac-dealer-catalog-layout':''}${singleRail?' ac-catalog-layout--single-brand-rail':''}`}>
   {header&&<div key="heading" className="ac-catalog-heading">{header}</div>}
   {singleRail&&<div key="brands" className="ac-catalog-brand-slot">{brandRail}</div>}
   {singleRail&&headerAfterBrands&&<div key="count" className="ac-catalog-count-slot">{headerAfterBrands}</div>}
   {dealerLayout&&<CatalogSelectionOutlet key="dealer-toolbar" dealerLayout/>}
   <aside key="filters" className="ac-catalog-sidebar" aria-label="Фильтры каталога"><div className="ac-catalog-sidebar-inner">{filters}</div></aside>
   {singleRail&&<div key="toolbar" className="ac-catalog-toolbar-slot"><CatalogSelectionOutlet/></div>}
   <div key="results" className="ac-catalog-results">
    {!dealerLayout&&!singleRail&&<CatalogSelectionOutlet/>}
    {resultScope?<RetainedCatalogResults scope={resultScope} error={resultError}>{children}</RetainedCatalogResults>:children}
   </div>
  </div>
 </CatalogSelectionProvider>;
}
''')
path='apps/web/components/catalog/CatalogContent.tsx'
replace(path,'<CatalogSidebar dealerLayout={embedded} resultScope={catalogResultScope(params,dealer)} filters=', '<CatalogSidebar dealerLayout={embedded} resultScope={catalogResultScope(params,dealer)} brandRail={embedded?undefined:<BrandLogoRail initial={initial} brands={brandNames} resultCount={countIncomplete?undefined:total}/>} headerAfterBrands={!embedded&&!selectedMarket?countLabel:undefined} filters=')
replace(path,'<div className={embedded?"md:hidden":"lg:hidden"}><BrandLogoRail initial={initial} brands={brandNames} resultCount={countIncomplete?undefined:total} /></div>', '{embedded&&<div className="md:hidden"><BrandLogoRail initial={initial} brands={brandNames} resultCount={countIncomplete?undefined:total} /></div>}')
replace(path,'      {!embedded&&!selectedMarket&&countLabel}\n','')
replace(path,'<div className={embedded?"hidden md:block":"hidden lg:block"}><BrandLogoRail initial={initial} brands={brandNames} resultCount={countIncomplete?undefined:total} /></div>', '{embedded&&<div className="hidden md:block"><BrandLogoRail initial={initial} brands={brandNames} resultCount={countIncomplete?undefined:total} /></div>}')
css=Path('apps/web/components/catalog/catalog-sidebar.css')
css.write_text(css.read_text()+'''
/* A single public brand rail: same responsive order without rendering two copies.
 * The toolbar remains a grid item in the full-height layout so sticky is retained. */
.ac-catalog-brand-slot,.ac-catalog-count-slot{min-width:0}
.ac-catalog-toolbar-slot{display:none}
@media(max-width:1023px){.ac-catalog-brand-slot{max-width:56rem}}
@media(min-width:1024px){
 .ac-catalog-layout.ac-catalog-layout--single-brand-rail{row-gap:0;--ac-catalog-heading-gap:28px}
 .ac-catalog-layout--single-brand-rail>.ac-catalog-heading{grid-column:2;grid-row:1}
 .ac-catalog-layout--single-brand-rail>.ac-catalog-count-slot{grid-column:2;grid-row:2}
 .ac-catalog-layout--single-brand-rail>.ac-catalog-sidebar{grid-column:1;grid-row:1 / span 5}
 .ac-catalog-layout--single-brand-rail>.ac-catalog-toolbar-slot{display:contents}
 .ac-catalog-layout--single-brand-rail>.ac-catalog-toolbar-slot>.ac-catalog-toolbar{grid-column:2;grid-row:3;margin-top:var(--ac-catalog-heading-gap);margin-bottom:0}
 .ac-catalog-layout--single-brand-rail>.ac-catalog-brand-slot{grid-column:2;grid-row:4}
 .ac-catalog-layout--single-brand-rail>.ac-catalog-results{grid-column:2;grid-row:5}
 .ac-catalog-brand-slot section.ac-brand-rail{border-top:1px solid var(--ac-border);border-bottom:1px solid var(--ac-border);border-radius:0}
 html body .ac-page-copy.ac-catalog-page .ac-catalog-brand-slot section.ac-brand-rail[aria-label="Марки автомобилей"]{border-top:1px solid var(--ac-border)!important;border-bottom:1px solid var(--ac-border)!important;padding-top:16px!important;padding-bottom:16px!important}
}
@media(min-width:1440px){.ac-catalog-layout.ac-catalog-layout--single-brand-rail{--ac-catalog-heading-gap:32px}}
''')
Path('tests/browser/catalog-single-brand-fixture.tsx').write_text('''import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogSidebar} from '../../apps/web/components/catalog/CatalogSidebar';
import {CatalogSidebarBaseline} from './catalog-sidebar-baseline.generated';
import {BrandLogoRail} from '../../apps/web/components/catalog/BrandLogoRail';
import {CATALOG_BRANDS} from '../../apps/web/lib/catalog/brands';
const params=new URLSearchParams(location.search),baseline=params.get('baseline')==='1';
const brands=CATALOG_BRANDS.map(v=>v.name);
const initial={market:'china',city:'Новокузнецк',powerTo:'160'};
function Fixture(){
 const [error,setError]=useState(false);
 (window as any).__setCatalogError=setError;
 const rail=<BrandLogoRail initial={initial} brands={brands}/>;
 const count=<p data-test-count className="ac-catalog-result-count mt-3 flex items-center gap-2 text-base font-bold">Автомобилей: 100</p>;
 const top=<div className="max-w-4xl"><nav className="mb-4 text-xs">Главная / Каталог</nav><h1 data-test-heading className="text-[30px] font-black leading-none md:text-6xl">Каталог автомобилей</h1>{baseline&&!error&&<div className="lg:hidden">{rail}</div>}</div>;
 const header=<>{top}{baseline&&!error&&count}</>;
 const filters=<div className="ac-catalog-filter-panel" data-test-filter-panel style={{height:620}}><button type="button">Фильтры</button></div>;
 const body=<div data-test-cards className="mt-8 grid gap-10 md:mt-9" style={{minHeight:2400}}><article data-test-card style={{height:180}}>Сохранённая карточка</article></div>;
 const Component=baseline?CatalogSidebarBaseline:CatalogSidebar;
 const extra=baseline||error?{}:{brandRail:rail,headerAfterBrands:count};
 return <main className="ac-page-copy ac-catalog-page"><section className="ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10"><Component {...extra} header={header} filters={filters} resultScope="fixture-public-china" resultError={error?'Проверка сохранения карточек':undefined}>{error?null:<>{baseline&&<div className="hidden lg:block">{rail}</div>}{body}</>}</Component></section></main>;
}
(window as any).__brandCount=brands.length;
createRoot(document.getElementById('root')!).render(<Fixture/>);
''')
Path('tests/browser/catalog-single-brand-check.mjs').write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/catalog-single-brand';fs.mkdirSync(out,{recursive:true});
const next={name:'navigation-fixture',setup(b){b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'fixture-next'}));b.onLoad({filter:/.*/,namespace:'fixture-next'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path==='next/link'?`import React from 'react';export default function Link({children,...p}){delete p.prefetch;return <a {...p}>{children}</a>}`:`const router={prefetch(){},refresh(){},push(u){history.pushState(null,'',u);window.__lastHref=u;},replace(u){history.replaceState(null,'',u);window.__lastHref=u;}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`}));}};
await build({entryPoints:['tests/browser/catalog-single-brand-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:out+'/fixture.js',tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[next]});
const sources=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx','apps/web/components/layout/RoutePreloader.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
const imports=[...new Set(sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1]))))];
const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes|publicLayoutFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
const css=await postcss([tailwindcss({content:['apps/web/components/{catalog,dealers,layout,ui}/**/*.{ts,tsx}','tests/browser/catalog-single-brand-fixture.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});fs.writeFileSync(out+'/app.css',css.css);
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture');if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{"counts":{}}');return;}if(u.pathname==='/cars'||u.pathname==='/cars/china'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark'</script><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);return;}if(u.pathname.startsWith('/brand-logos/')){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="76" height="40"><rect width="76" height="40" fill="gray"/></svg>');return;}const f=path.join(out,path.basename(u.pathname));if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(f));}else{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});const results=[];
async function geometry(page){return page.evaluate(()=>{const rect=s=>{const el=[...document.querySelectorAll(s)].find(e=>e.getClientRects().length);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {heading:rect('[data-test-heading]'),count:rect('[data-test-count]'),rail:rect('section.ac-brand-rail'),toolbar:rect('.ac-catalog-toolbar'),sidebar:rect('.ac-catalog-sidebar'),cards:rect('[data-test-cards]'),overflow:document.documentElement.scrollWidth>innerWidth+1,rails:document.querySelectorAll('section.ac-brand-rail').length,logos:document.querySelectorAll('section.ac-brand-rail img').length,brandCount:window.__brandCount,bytes:new TextEncoder().encode(document.getElementById('root').outerHTML).length};});}
try{for(const width of [390,768,1023,1280,1600])for(const theme of ['light','dark']){
 const pair={width,theme};
 for(const baseline of [true,false]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/cars?theme='+theme+(baseline?'&baseline=1':''));await page.locator('[data-test-card]').waitFor();await page.waitForTimeout(150);
  const value=await geometry(page);assert.equal(value.overflow,false);assert.equal(value.rails,baseline?2:1);assert.equal(value.logos,value.brandCount*(baseline?2:1));
  pair[baseline?'before':'after']=value;
  await page.evaluate(()=>window.scrollTo(0,650));await page.waitForTimeout(80);if(width>=1024){const toolbar=await page.locator('.ac-catalog-toolbar').boundingBox();assert.ok(toolbar.y>=63&&toolbar.y<=65,'toolbar remains sticky at public header boundary');}
  await page.evaluate(()=>window.scrollTo(0,0));
  if(!baseline){
   await page.getByRole('button',{name:'Показать все марки',exact:true}).click();await page.getByText('Все марки',{exact:true}).waitFor();assert.equal(await page.locator('.ac-brand-rail a[title^="Автомобили"]').count(),value.brandCount*2,'full directory retains every brand');await page.keyboard.press('Escape');
   if(width>=1024){await page.getByRole('button',{name:'Список',exact:true}).click();assert.equal(await page.locator('.ac-catalog-view').getAttribute('data-catalog-view'),'list');}
   await page.screenshot({path:out+'/'+width+'-'+theme+'.png'});
   await page.evaluate(()=>window.__setCatalogError(true));await page.locator('[data-catalog-retained="true"]').waitFor();assert.equal(await page.locator('[data-test-card]').count(),1,'layout slots must not discard previously rendered cards on failure');
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 for(const key of ['heading','count','rail','toolbar','sidebar','cards']){
  const a=pair.before[key],b=pair.after[key];assert.equal(Boolean(a),Boolean(b),key+' visibility');if(a&&b)for(const dim of ['x','y','width','height'])assert.ok(Math.abs(a[dim]-b[dim])<=2,`${width}/${theme} ${key}.${dim}: ${a[dim]} -> ${b[dim]}`);
 }
 assert.ok(pair.after.bytes<pair.before.bytes*.8,'remove material duplicate HTML, not just hide a duplicate');results.push(pair);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
}}finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));}
console.log('SINGLE_BRAND_RAIL_BROWSER_PASS',results.length);
''')
print('Applied candidate presentation-only patch; baseline fixture is diagnostic, never a runtime dependency.')
