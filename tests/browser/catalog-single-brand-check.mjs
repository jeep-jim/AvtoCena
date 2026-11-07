import assert from 'node:assert/strict';
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
