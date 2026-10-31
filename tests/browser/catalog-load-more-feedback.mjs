import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/catalog-load-more-feedback';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/catalog-load-more-feedback-fixture.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:`${out}/app.js`,tsconfig:'apps/web/tsconfig.json',plugins:[{name:'server-stubs',setup(b){
 b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.endsWith('navigation')?`const router={push(url){history.pushState(null,'',url)},replace(url){history.replaceState(null,'',url)},prefetch(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`:`import React from 'react';export default function Link({children,...props}){delete props.prefetch;return React.createElement('a',props,children)}`,resolveDir:process.cwd()}));
 b.onResolve({filter:/(?:catalog|green-corner)-load-more-action$/},()=>({path:'action',namespace:'action'}));
 b.onLoad({filter:/.*/,namespace:'action'},()=>({contents:'export const loadMoreCatalog=async()=>({});export const loadMoreGreenCorner=loadMoreCatalog;'}));
}}]});
const layouts=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
const imports=layouts.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
const inline=layouts.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
const css=await postcss([tailwindcss({content:['apps/web/components/**/*.{ts,tsx}','tests/browser/catalog-load-more-feedback-fixture.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
fs.writeFileSync(`${out}/global.css`,css.css);
const server=http.createServer((req,res)=>{const file=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':req.url==='/global.css'?'global.css':null;res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');res.end(file?fs.readFileSync(`${out}/${file}`):'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[];
try{
 for(const width of [320,390,768,1024,1440])for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],searches=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/catalog/search'))searches.push(r.url())});
  await page.route('**/api/**',r=>r.fulfill({json:{items:[],counts:{},modelCounts:{}}}));
  await page.goto(`http://127.0.0.1:${server.address().port}/cars`);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.locator('.ac-pagination').waitFor();
  const geometry=await page.locator('.ac-pagination').evaluate(el=>{const children=[...el.children].filter(c=>c.getClientRects().length);return {tops:children.map(c=>Math.round(c.getBoundingClientRect().top)),overflow:el.scrollWidth-el.clientWidth,viewport:document.documentElement.scrollWidth-innerWidth}});
  assert.equal(new Set(geometry.tops).size,1,`${width}/${theme}: pagination wraps`);assert.ok(geometry.overflow<=1,JSON.stringify(geometry));assert.ok(geometry.viewport<=1,JSON.stringify(geometry));
  if(width<1024)await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();
  const scope=page.locator(width<1024?'.ac-mobile-filter-sheet':'.ac-catalog-filter-panel');
  await scope.getByRole('button',{name:'Топливо',exact:true}).click();
  const checkbox=scope.getByRole('checkbox',{name:'Электро',exact:true});await checkbox.check();
  assert.equal(await checkbox.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 210, 31)');
  const loading=page.locator('[data-catalog-filter-pending="true"]');await loading.waitFor({state:'attached'});
  assert.equal(await page.locator('.ac-route-loader[aria-hidden="false"]').count(),0);
  // Real request remains unacknowledged; advancing time must not hide the loader.
  if(width===390&&theme==='dark'){await page.clock.install();await page.clock.runFor(16000);assert.equal(await loading.count(),1);}
  await page.waitForURL(/fuel=electric/);
  if(width<1024)await scope.locator('button[data-ac-mobile-close="1"]').click();
  await page.locator('#ack').click();await loading.waitFor({state:'detached'});
  assert.deepEqual(searches,[],'electric toggle must not send a duplicate catalog search');assert.deepEqual(errors,[]);
  await page.screenshot({path:`${out}/${width}-${theme}.png`});results.push({width,theme,geometry,passed:true});await page.close();
 }
 console.log(JSON.stringify(results));
}finally{fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));}
