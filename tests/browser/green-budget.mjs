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
const out=`artifacts/green-budget-${live?'live':'local'}-${browserName}`;
fs.mkdirSync(out,{recursive:true});
let server,origin=live;
if(!live){
 const next={name:'isolated-next-navigation',setup(b){
  b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));
  b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'js',contents:args.path.endsWith('navigation')?`const router={push(url){history.pushState(null,'',url);window.__lastFilterUrl=url;},replace(url){history.replaceState(null,'',url);window.__lastFilterUrl=url;}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`:`import React from 'react';export default function Link({children,...props}){delete props.prefetch;return React.createElement('a',props,children);}`,resolveDir:process.cwd()}));
 }};
 for(const mode of ['fixture','baseline'])await build({entryPoints:['tests/browser/green-budget-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/${mode}.js`,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},plugins:[next,...(mode==='baseline'?[{name:'without-new-style',setup(b){b.onLoad({filter:/MobileCatalogDropdowns\.css$/},()=>({contents:'',loader:'css'}));}}]:[])]});
 const sources=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
 const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
 const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
 const css=await postcss([tailwindcss({content:['apps/web/components/catalog/**/*.{ts,tsx}','tests/browser/green-budget-fixture.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
 fs.writeFileSync(`${out}/app.css`,css.css);
 server=http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture');if(u.pathname==='/cars'||u.pathname==='/'){
  const mode=u.searchParams.has('baseline')?'baseline':'fixture';res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark'</script><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/${mode}.css"></head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`);return;}
  let file=path.join(out,path.basename(u.pathname));if(!fs.existsSync(file)){const root=path.resolve('apps/web/public');file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}}
  if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(fs.readFileSync(file));}else{res.statusCode=404;res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
}
const browser=browserName==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const facets={makes:['Toyota','BMW','Mazda'],models:[{make:'Toyota',model:'Corolla'}],bodyTypes:['suv','offroad','sedan','hatchback','wagon','minivan','coupe','convertible','pickup','van'],transmissions:['automatic','manual','cvt','dct'],fuels:['petrol','diesel','hybrid','electric','lpg'],drives:['fwd','rwd','awd']};

try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  if(!live)await context.route('**/api/**',r=>r.fulfill({json:{counts:{},modelCounts:{},items:[]}}));
  const page=await context.newPage();
  await page.goto(origin+(live?'/cars/green?advanced=1':'/cars'),{waitUntil:'domcontentloaded',timeout:90000});
  let scope=page.locator('.ac-catalog-filter-panel');
  if(width<1024){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();scope=page.locator('.ac-mobile-filter-sheet');}
  const price=scope.locator('.ac-range-card').filter({has:page.locator('input[name="budgetFrom"]')});
  const volume=scope.locator('.ac-range-card').filter({has:page.locator('input[name="engineFrom"]')});
  await price.locator('.ac-range-value-toggle').first().click();
  await price.getByRole('button',{name:'1 млн',exact:true}).waitFor();
  assert.doesNotMatch(await price.innerText(),/FOB|1,0 л|1,5 л/);
  await price.getByRole('button',{name:'1 млн',exact:true}).click();
  await price.getByRole('textbox',{name:'Цена: от',exact:true}).fill('1100000');
  await price.getByRole('textbox',{name:'Цена: от',exact:true}).blur();
  await price.getByRole('textbox',{name:'Цена: до',exact:true}).fill('1200000');
  await price.getByRole('textbox',{name:'Цена: до',exact:true}).blur();
  await volume.locator('.ac-range-value-toggle').first().click();
  await volume.getByRole('button',{name:'1,5 л',exact:true}).waitFor();
  await volume.getByRole('button',{name:'Не важно',exact:true}).click();
  if(width<1024)await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.waitForFunction(()=>{const q=new URLSearchParams(location.search);return q.get('budgetFrom')==='1100000'&&q.get('budget')==='1200000';});
  const url=new URL(page.url());assert.equal(url.pathname,'/cars/green');assert.equal(url.searchParams.has('fobFrom'),false);assert.equal(url.searchParams.has('fobTo'),false);
  await page.screenshot({path:`${out}/green-${width}.png`,fullPage:true});
  console.log(JSON.stringify({width,url:page.url(),pricePresets:'rubles',enginePresets:'litres',passed:true}));
  await context.close();
 }
} finally {await browser.close();if(server)await new Promise(r=>server.close(r));}
