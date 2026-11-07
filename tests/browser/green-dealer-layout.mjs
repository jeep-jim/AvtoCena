import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const require=createRequire(import.meta.url);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/green-dealer-layout';fs.mkdirSync(out,{recursive:true});
// Real server component, dealer profile, browsing provider, sidebar and CSS.
// Inventory, filters and vehicle cards are isolated fixtures: no supplier calls,
// price calculation, authorization writes or claim of production acceptance.
const mocks={
 'resolve-browsing-context':`export const resolveDealerBrowsingContext=async id=>id?globalThis.__greenBrowserDealer:null;`,
 'green-corner':`const items=Array.from({length:6},(_,i)=>({id:'green-fixture-'+i,make:'Nissan',model:'Note',year:2020,powerHp:98}));export const readGreenCorner=async()=>({items});export const publicGreenOffer=x=>x;export const readGreenCornerPage=async(rows,p)=>({items:rows,total:21,page:Number(p.page||1),facets:{makes:['Nissan']}});`,
 'PublicHeader':`export function PublicHeader(){return <header className="ac-public-header" style={{height:64}}>Каталог</header>;}`,
 'CatalogFilters':`export function CatalogFilters({initial}){return <div className="ac-catalog-filter-panel" data-green-initial={JSON.stringify(initial)} style={{minHeight:650}}><div className="ac-filter-control">Выбрать город: {initial.city}</div><div className="ac-filter-control">{initial.make}</div><div className="ac-filter-control">Япония · В наличии</div><div className="ac-filter-control">До {initial.powerTo||160} л.с.</div></div>;}`,
 'CatalogCard':`export function CatalogCard({offer}){return <article className="ac-catalog-card" style={{height:250,minWidth:0,padding:16,background:'var(--ac-surface-2)',borderRadius:18}}><h3>{offer.make} {offer.model}</h3><p>Тестовый автомобиль</p></article>;}`,
 'CatalogLoadMore':`export function CatalogLoadMore({initialCards,greenQuery,initialPage}){return <div data-green-query={JSON.stringify(greenQuery)} data-page={initialPage}><div data-catalog-batch="1" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:12}}>{initialCards}</div></div>;}`,
};
const entry=`
 import React from 'react';
 import {renderToPipeableStream,renderToStaticMarkup} from 'react-dom/server';
 import {PassThrough} from 'node:stream';
 async function renderMarkup(tree){
  const legacy=renderToStaticMarkup(tree);
  console.log('SSR_STYLE_SERIALIZATION',JSON.stringify({legacyEscapesDirectChild:legacy.includes('&gt;.dealer-profile-home-banner')}));
  return await new Promise((resolve,reject)=>{
   const chunks=[],output=new PassThrough();
   output.on('data',chunk=>chunks.push(chunk));output.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));output.on('error',reject);
   const controller=renderToPipeableStream(tree,{onAllReady(){controller.pipe(output);},onShellError:reject,onError:reject});
  });
 }
 import {GreenCornerCatalog} from './apps/web/components/catalog/GreenCornerCatalog';
 import {DealerProfileContent} from './apps/web/components/dealers/DealerProfileContent';
 import {DealerBrowsingProvider} from './apps/web/components/dealers/DealerBrowsingContext';
 import {CatalogSidebar} from './apps/web/components/catalog/CatalogSidebar';
 import {JapanSectionTabs} from './apps/web/components/catalog/JapanSectionTabs';
 const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><rect width="1200" height="400" fill="#87bcec"/></svg>');
 export async function render(url){
  globalThis.__greenBrowserUrl=url;
  const q=Object.fromEntries(url.searchParams),embedded=url.pathname.startsWith('/dealers/');
  const dealer={id:'fixture',name:'Тестовый дилер',href:'/dealers/fixture',markets:['japan'],logoLight:image,logoDark:image,preview:false};globalThis.__greenBrowserDealer=dealer;
  const profile={dealerId:'fixture',name:dealer.name,description:'Изолированный стенд каталога',banner:image,bannerMobile:image,extraBanners:[],logoLight:image,logoDark:image,headerIcon:'',profileEnabled:true,buyersEnabled:false,buyerPhotos:[],catalogMarkets:['japan'],specialHeading:'Предложения',offices:[],requisites:{legalName:'Тестовая компания',inn:'0000000000',ogrn:'',kpp:'',legalAddress:'Тестовый адрес'}};
  const initial={...q,...(embedded?{dealer:'fixture'}:{})};
  let catalog=q.stock==='green'||!embedded?await GreenCornerCatalog({params:initial,embedded}):<div className="dealer-shared-catalog ac-catalog-page ac-page-copy"><div className="ac-catalog-shell"><CatalogSidebar dealerLayout filters={<div style={{minHeight:650}}>Фильтры аукционов</div>} header={<h1>Авто под заказ</h1>}><JapanSectionTabs active="auction" params={initial}/><div style={{height:600}}>Аукционная подборка</div></CatalogSidebar></div></div>;
  // Recreate only the two original wrapper defects as a negative control.
  if(q.fixtureBroken==='1'&&embedded)catalog=<DealerBrowsingProvider dealer={dealer}>{React.cloneElement(catalog,{className:'ac-catalog-page ac-page-copy min-h-screen'})}</DealerBrowsingProvider>;
  return renderMarkup(embedded?<DealerBrowsingProvider dealer={dealer} profile><main className="ac-dealer-public-page ac-page-copy" style={{'--dealer-header-height':'64px'}}><header className="ac-public-header" style={{height:64}}>Тестовый дилер</header><DealerProfileContent s={profile} catalog={catalog}/></main></DealerBrowsingProvider>:catalog);
 }
`;
const compiled=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',outfile:`${out}/fixture.cjs`,write:false,jsx:'automatic',packages:'external',tsconfig:'apps/web/tsconfig.json',loader:{'.css':'empty'},plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/.*/},a=>{const n=a.path.split('/').at(-1);if(mocks[n])return {path:n,namespace:'fixture'};if(/^next\/(navigation|link|dynamic|headers|image)$/.test(a.path)||a.path==='server-only')return {path:a.path,namespace:'next-fixture'};});
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'jsx',resolveDir:process.cwd()}));
 b.onLoad({filter:/.*/,namespace:'next-fixture'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path==='next/link'?`import React from 'react';export default function Link({children,prefetch,scroll,...props}){return <a {...props}>{children}</a>;}`:a.path==='next/navigation'?`export const usePathname=()=>globalThis.__greenBrowserUrl.pathname;export const useSearchParams=()=>globalThis.__greenBrowserUrl.searchParams;export const useRouter=()=>({push(){},replace(){},refresh(){}});export const redirect=url=>{throw Error('redirect:'+url);};`:a.path==='next/headers'?`export const cookies=async()=>({get:()=>({value:'Новокузнецк'})});`:a.path==='next/dynamic'?`export default function dynamic(){return ()=>null;}`:a.path==='next/image'?`export default function Image(props){return <img {...props}/>;}`:''}));
}}]});
const module={exports:{}};new Function('require','module','exports',compiled.outputFiles.find(f=>f.path.endsWith('.cjs')).text)(require,module,module.exports);
const layouts=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
const styles=layouts.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>fs.readFileSync(path.resolve(path.dirname(file),m[1]),'utf8')));
const inline=layouts.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
const moduleCss=compiled.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const css=await postcss([tailwindcss({content:['apps/web/components/**/*.{ts,tsx}','tests/browser/green-dealer-layout.mjs']})]).process(styles.join('\n')+'\n'+inline+'\n'+moduleCss+'\n'+fs.readFileSync('apps/web/components/catalog/catalog-sidebar.css','utf8'),{from:'apps/web/app/globals.css'});
fs.writeFileSync(out+'/app.css',css.css);
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}
 if(!url.pathname.startsWith('/dealers/')&&url.pathname!=='/cars/green'){res.writeHead(404);res.end();return;}
 try{const html=await module.exports.render(url);fs.writeFileSync(out+'/last.html',html);res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="ru" data-theme="${url.searchParams.get('theme')==='light'?'light':'dark'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body>${html}</body></html>`);}catch(e){console.error(e);res.writeHead(500);res.end('fixture failed');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[];
const geometry=()=>{
 const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
 return {banner:rect('.dealer-profile-home-banner'),heading:rect('#catalog .ac-catalog-heading'),results:rect('#catalog .ac-catalog-results'),sidebar:rect('#catalog .ac-catalog-sidebar'),footer:rect('.dealer-profile-footer'),overflow:document.documentElement.scrollWidth>innerWidth+1,contexts:document.querySelectorAll('[data-dealer-context]').length,root:!!document.querySelector('#catalog>.dealer-shared-catalog'),dock:document.querySelectorAll('.dealer-context-dock').length};
};
try{
 for(const width of [390,768,1024,1280,1600])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   const url=origin+`/dealers/fixture?make=Nissan&market=japan&stock=all&city=${encodeURIComponent('Новокузнецк')}&powerTo=160&page=2&theme=${theme}`;
   assert.equal((await page.goto(url,{waitUntil:'load'})).status(),200);
   await page.getByRole('link',{name:'В наличии',exact:true}).click();await page.locator('#catalog .ac-green-heading').waitFor();
   const current=new URL(page.url());assert.equal(current.pathname,'/dealers/fixture');for(const [k,v] of Object.entries({make:'Nissan',market:'japan',stock:'green',city:'Новокузнецк',powerTo:'160'}))assert.equal(current.searchParams.get(k),v);assert.equal(current.searchParams.has('page'),false);
   const g=await page.evaluate(geometry);console.log('GREEN_GEOMETRY',JSON.stringify({width,theme,...g}));assert.equal(g.root,true);assert.equal(g.contexts,1);assert.equal(g.dock,0);assert.equal(g.overflow,false);
   assert.ok(g.results.width>width*.45,JSON.stringify(g));assert.ok(g.footer.y>=g.results.bottom-2,'footer must follow the full results area');
   if(width>=1024){assert.ok(Math.abs(g.heading.x-g.banner.x)<=2,JSON.stringify(g));assert.ok(Math.abs(g.results.x-g.banner.x)<=2);assert.ok(Math.abs(g.results.width-g.banner.width)<=2);assert.ok(g.sidebar.x<g.banner.x);assert.ok(g.sidebar.y<=g.banner.y+2);}
   const initial=JSON.parse(await page.locator('[data-green-initial]').getAttribute('data-green-initial'));const query=JSON.parse(await page.locator('[data-green-query]').getAttribute('data-green-query'));assert.deepEqual(query,initial);assert.equal(query.make,'Nissan');assert.equal(query.city,'Новокузнецк');assert.equal(query.powerTo,'160');assert.equal(await page.locator('.ac-catalog-card').count(),6);
   if([390,1600].includes(width))await page.screenshot({path:`${out}/green-${width}-${theme}.png`,fullPage:true});
   await page.getByRole('link',{name:'Аукционы Японии',exact:true}).click();assert.equal(new URL(page.url()).pathname,'/dealers/fixture');assert.equal(new URL(page.url()).searchParams.get('make'),'Nissan');assert.equal(new URL(page.url()).searchParams.get('stock'),null);
   await page.goBack();await page.locator('#catalog .ac-green-heading').waitFor();assert.equal((await page.evaluate(geometry)).root,true);await page.reload();assert.equal((await page.evaluate(geometry)).root,true);
   assert.deepEqual(errors,[]);results.push({width,theme,...g,roundTrip:true});
  }catch(e){await page.screenshot({path:`${out}/failure-${width}-${theme}.png`,fullPage:true}).catch(()=>{});throw e;}finally{await page.close();}
 }
 const negative=await browser.newPage({viewport:{width:1600,height:1000}});
 await negative.goto(origin+'/dealers/fixture?make=Nissan&market=japan&stock=green&fixtureBroken=1',{waitUntil:'load'});
 const broken=await negative.evaluate(geometry);assert.equal(broken.root,false);assert.equal(broken.contexts,2);assert.ok(broken.results.width<broken.banner.width*.6,'negative control must reproduce the narrow green catalog');await negative.screenshot({path:`${out}/negative-original-wrappers.png`,fullPage:true});await negative.close();
 const standalone=await browser.newPage({viewport:{width:1440,height:1000}});assert.equal((await standalone.goto(origin+'/cars/green?make=Nissan&city='+encodeURIComponent('Москва'),{waitUntil:'load'})).status(),200);assert.equal(await standalone.locator('main.ac-catalog-page').count(),1);assert.equal(await standalone.locator('.ac-public-header').count(),1);assert.equal(await standalone.locator('.dealer-context-dock').count(),0);assert.equal(await standalone.locator('.ac-catalog-card').count(),6);await standalone.close();
 fs.writeFileSync(`${out}/report.json`,JSON.stringify({scope:'Isolated SSR layout and real link navigation. Data/cards/filter controls mocked; not production or hydrated SPA acceptance.',results,negativeControl:broken,standalone:true},null,2));console.log('GREEN_DEALER_LAYOUT_PASS',JSON.stringify({cases:results.length,negativeControl:true,standalone:true}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
