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
const out=`artifacts/catalog-multi-photo`;
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
  const context=await browser.newContext({viewport:{width,height:1000}}), page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/catalog/**',route=>{const u=new URL(route.request().url());const models=[{make:'Toyota',model:'Yaris L'},{make:'Kia',model:'KX1'}];return route.fulfill({json:u.pathname.endsWith('brand-counts')?{counts:{Toyota:10,Kia:8},modelCounts:{Toyota:1,Kia:1}}:{facets:{makes:['Toyota','Kia']},items:models.filter(x=>!u.searchParams.get('q')||x.model.toLowerCase().includes(u.searchParams.get('q').toLowerCase()))}});});
  await page.goto(`${origin}/cars?theme=${theme}${width===1440?'&slowRouter=1':''}`);
  if(width===1440)await page.evaluate(()=>{const original=history.replaceState.bind(history);history.replaceState=(...args)=>{clearTimeout(window.__routeTimer);return original(...args);};});
  let scope=page.locator('.ac-catalog-filter-panel');
  if(width<1024){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();scope=page.locator('.ac-mobile-filter-sheet');}
  const market=scope.locator('input[name=market]').locator('..');
  await market.getByRole('button',{name:'Все рынки',exact:true}).click();await market.getByRole('button',{name:'Китай',exact:true}).click();assert.equal(await scope.locator('input[name=market]').inputValue(),'china');
  await scope.getByRole('button',{name:'Выбрать марки автомобилей',exact:true}).click();
  await scope.getByPlaceholder('Найти марку').fill('Toyota');assert.equal(await scope.getByPlaceholder('Найти марку').evaluate(el=>el===document.activeElement),true);await scope.locator('[data-facet-value="Toyota"]').click();await scope.getByRole('button',{name:'Выбрать марки автомобилей'}).click();await scope.locator('[data-facet-value="Kia"]').click();
  assert.equal(await scope.locator('input[name="make"]').inputValue(),'Toyota,Kia');
  await scope.getByRole('searchbox',{name:'Модель автомобиля'}).fill('Yaris');
  await scope.getByRole('button',{name:/Yaris L/}).click();
  if(width===1440)await page.waitForTimeout(250); // The first model request has been submitted.
  await scope.getByRole('searchbox',{name:'Модель автомобиля'}).fill('KX1');await scope.getByRole('button',{name:/KX1/}).click();
  if(width===1440){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fixture-server',{detail:'/cars?make=Toyota,Kia&model=Yaris%20L'})));await page.waitForTimeout(30);}
  assert.equal(await scope.locator('input[name="model"]').inputValue(),'Yaris L|KX1');assert.equal(await scope.locator('input[name="make"]').inputValue(),'Toyota,Kia');
  const city=width<1024?scope:page;
  await city.getByRole('button',{name:/Выбрать город. Сейчас/}).click();await page.getByRole('button',{name:'Новосибирск',exact:true}).click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('avtocena_city')),'Новосибирск');
  await page.screenshot({path:`${out}/${width}-${theme}.png`});
  if(width<1024)await scope.locator('button[aria-label="Закрыть"],button[data-ac-mobile-close="1"]').click();
  await page.waitForFunction(()=>new URLSearchParams(location.search).get('model')==='Yaris L|KX1');
  assert.equal(new URL(page.url()).searchParams.get('city'),'Новосибирск');assert.equal(new URL(page.url()).searchParams.get('market'),'china');
  let calls=0;const sent=[];
  await page.route('**/api/crm/dealers/*/media',route=>{calls++;sent.push(route.request().postDataBuffer()?.length||0);return route.fulfill(calls===2?{status:413,body:'too large'}:{json:{id:`photo-${calls}`,url:`/photo-${calls}`,caption:''}});});
  const sharp=(await import('sharp')).default;const bytes=await sharp({create:{width:30,height:20,channels:3,background:'#55aa33'}}).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles([{name:'one.png',mimeType:'image/png',buffer:bytes},{name:'two.png',mimeType:'image/png',buffer:bytes},{name:'three.png',mimeType:'image/png',buffer:bytes}]);
  await page.getByRole('button',{name:/Повторить неудачные загрузки/}).waitFor();assert.equal(await page.locator('[data-photos]').textContent(),'2');assert.match(await page.getByRole('alert').textContent(),/two.png.*413/);
  await page.getByRole('button',{name:/Повторить неудачные загрузки/}).click();await page.waitForFunction(()=>document.querySelector('[data-photos]').textContent==='3');assert.equal(calls,4);
  if(width===390 && theme==='dark') {
   const noise=Buffer.alloc(1100*1100*3);(await import('node:crypto')).randomFillSync(noise);
   const large=await sharp(noise,{raw:{width:1100,height:1100,channels:3}}).png().toBuffer();assert.ok(large.length>1500000);
   await page.locator('input[type="file"]').setInputFiles({name:'large.png',mimeType:'image/png',buffer:large});
   await page.waitForFunction(()=>document.querySelector('[data-photos]').textContent==='4');assert.ok(sent.at(-1)<1510000,'large photo must be reduced before multipart upload');
   await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    window.__photoEncoders=[];
    HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){window.__photoEncoders.push(type);return original.call(this,callback,type==='image/webp'?'image/png':type,quality);};
   });
   await page.locator('input[type="file"]').setInputFiles({name:'fallback.png',mimeType:'image/png',buffer:large});
   await page.waitForFunction(()=>document.querySelector('[data-photos]').textContent==='5');
   assert.ok(sent.at(-1)<1510000,'PNG fallback must still be reduced');
   assert.ok((await page.evaluate(()=>window.__photoEncoders)).includes('image/jpeg'));
   await page.evaluate(()=>{window.__photoEncoders=[];});
   await page.locator('input[type="file"]').setInputFiles({name:'small.png',mimeType:'image/png',buffer:bytes});
   await page.waitForFunction(()=>document.querySelector('[data-photos]').textContent==='6');
   assert.deepEqual(await page.evaluate(()=>window.__photoEncoders),[],'small photo must bypass canvas conversion');

  }
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log({width,theme,passed:true});await context.close();
 }
}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
