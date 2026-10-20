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
const out=`artifacts/model-controls`;
fs.mkdirSync(out,{recursive:true});
let server,origin=live;
if(!live){
 const next={name:'isolated-next-navigation',setup(b){
  b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));
  b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'js',contents:args.path.endsWith('navigation')?`window.addEventListener('popstate',()=>{clearTimeout(window.__routeTimer);window.__lastFilterUrl=location.href;window.dispatchEvent(new CustomEvent('fixture-server',{detail:location.href}));});const router={push(url){if(window.__slowRoute??=new URLSearchParams(location.search).has('slowRouter')){clearTimeout(window.__routeTimer);window.__routeTimer=setTimeout(()=>{history.pushState(null,'',url);window.__lastFilterUrl=url;},2000);}else{history.pushState(null,'',url);window.__lastFilterUrl=url;}},replace(url){history.replaceState(null,'',url);window.__lastFilterUrl=url;}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`:`import React from 'react';export default function Link({children,...props}){delete props.prefetch;return React.createElement('a',props,children);}`,resolveDir:process.cwd()}));
 }};
 for(const mode of ['fixture','baseline'])await build({entryPoints:['tests/browser/catalog-multi-photo-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/${mode}.js`,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},plugins:[next,...(mode==='baseline'?[{name:'without-new-style',setup(b){b.onLoad({filter:/MobileCatalogDropdowns\.css$/},()=>({contents:'',loader:'css'}));}}]:[])]});
 const sources=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx'].map(file=>({file,text:fs.readFileSync(file,'utf8')}));
 const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
 const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
 const css=await postcss([tailwindcss({content:['apps/web/components/home/**/*.tsx','apps/web/components/dealers/**/*.tsx','apps/web/components/ui/**/*.tsx','apps/web/components/catalog/**/*.{ts,tsx}','tests/browser/catalog-multi-photo-fixture.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
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
 for(const width of [390,1440])for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:844}}), page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const models={version:1,brands:[['Toyota',['Тойота']]],models:[['Toyota','Corolla',[],1],['Toyota','Camry',[],1]]};
  await page.route('**/api/catalog/**',route=>route.fulfill({json:route.request().url().includes('scope=inventory')?models:{counts:{Toyota:12},items:[],facets:{makes:['Toyota']}}}));
  const asset=JSON.parse(fs.readFileSync('apps/web/lib/catalog/model-search-asset.json','utf8')).asset;
  await page.route('**'+asset,route=>route.fulfill({json:models}));
  await page.goto(`${origin}/cars?theme=${theme}`);
  let scope=page.locator('.ac-catalog-filter-panel');
  if(width<1024){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();scope=page.locator('.ac-mobile-filter-sheet');}
  const trigger=scope.getByRole('searchbox',{name:'Модель автомобиля'});
  async function enter(text){if(width<1024){await trigger.click();const dialog=page.getByRole('dialog',{name:'Выбор моделей'});await dialog.getByRole('searchbox',{name:'Поиск модели'}).fill(text);return dialog;}await trigger.fill(text);return scope;}
  let modelScope=await enter('Королла');
  await modelScope.getByRole('button',{name:/Corolla/}).waitFor();
  if(width<1024){
    await page.evaluate(()=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,get:()=>410});Object.defineProperty(window.visualViewport,'offsetTop',{configurable:true,get:()=>30});window.visualViewport.dispatchEvent(new Event('resize'));});
    await page.waitForTimeout(50);
    const box=await modelScope.boundingBox(),apply=await modelScope.getByRole('button',{name:'Применить',exact:true}).boundingBox();
    assert.ok(box.y>=30&&box.y+box.height<=440,'model dialog above simulated keyboard');assert.ok(apply.y+apply.height<=440,'apply visible above keyboard');
  }
  await modelScope.getByRole('button',{name:'Применить',exact:true}).click();
  assert.equal(await scope.locator('input[name=model]').inputValue(),'Corolla');
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  modelScope=await enter('Camry');await modelScope.getByRole('button',{name:'Закрыть список моделей',exact:true}).click();
  assert.equal(await scope.locator('input[name=model]').inputValue(),width<1024?'Corolla|Camry':'Camry');
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  if(width<1024){
    modelScope=await enter('');await modelScope.getByRole('button',{name:'Убрать модель Corolla',exact:true}).click();
    await modelScope.getByRole('button',{name:'Закрыть список моделей',exact:true}).click();
    const button=scope.getByRole('button',{name:'Показать автомобили',exact:true});await button.click();await scope.waitFor({state:'detached'});
  }
  await page.screenshot({path:`${out}/${width}-${theme}.png`});
  await page.waitForFunction(()=>new URLSearchParams(location.search).get('model')==='Camry');
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log(JSON.stringify({width,theme,passed:true}));await context.close();
 }
}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
