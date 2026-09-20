import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out='artifacts/catalog-load-more';fs.mkdirSync(out,{recursive:true});
const buildOptions={entryPoints:['tests/browser/catalog-load-more-fixture.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/app.js',plugins:[{name:'action-fixture',setup(b){b.onResolve({filter:/catalog-load-more-action$/},()=>({path:'action',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'tsx',resolveDir:process.cwd(),contents:`import React from 'react';let attempts=0; export async function loadMoreCatalog(q,page){await new Promise(r=>setTimeout(r,150));if(page===3 && attempts++===0)throw Error('offline');const n=page===3?12:24;return {page,total:60,ids:Array.from({length:n},(_,i)=>String((page-1)*24+i)),cards:Array.from({length:n},(_,i)=><article key={(page-1)*24+i} style={{height:220,background:'#ddd',padding:12}}><a href={'/cars/offer/'+((page-1)*24+i)}>Автомобиль {(page-1)*24+i+1}</a></article>)};}` }));}}]};
await build(buildOptions);
await build({...buildOptions,platform:'node',format:'esm',packages:'external',outfile:out+'/server.mjs'});
const {App}=await import(pathToFileURL(path.resolve(out+'/server.mjs')).href);

const css=await postcss([tailwind({content:['apps/web/components/catalog/CatalogLoadMore.tsx']})]).process('@tailwind utilities;'+fs.readFileSync('apps/web/app/public-polish.css','utf8'),{from:undefined});fs.writeFileSync(out+'/app.css',css.css);
const server=http.createServer((req,res)=>{const file=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':null;res.setHeader('Content-Type',file?.endsWith('js')?'text/javascript':file?'text/css':'text/html');res.end(file?fs.readFileSync(out+'/'+file):'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root">'+renderToString(React.createElement(App,{initialPage:Number(new URL(req.url,'http://fixture').searchParams.get('page'))||1}))+'</div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByText('Показано 24 из 60').waitFor();
  const pages=page.getByRole('navigation',{name:'Страницы каталога'});
  assert.equal(await pages.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href'),'/cars?market=japan&page=2');
  assert.equal(await pages.locator('[aria-current=page]').innerText(),'1');
  await page.getByRole('button',{name:'Показать ещё'}).click();
  await page.getByText('Показано 48 из 60').waitFor();assert.equal(await page.locator('article').count(),48);assert.equal(await pages.locator('[aria-current=page]').innerText(),'2');
  await page.getByRole('button',{name:'Показать ещё'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('article').count(),48);
  await page.getByRole('button',{name:'Показать ещё'}).click();await page.getByText('Показано 60 из 60').waitFor();assert.equal(await page.locator('article').count(),60);
  await page.getByText('Автомобиль 48',{exact:true}).scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);
  await page.getByText('Автомобиль 48',{exact:true}).click();await page.getByRole('button',{name:'Назад'}).click();
  await page.getByText('Показано 60 из 60').waitFor();await page.waitForFunction(y=>Math.abs(scrollY-y)<5,before);
  assert.equal(await page.locator('article').count(),60);assert.equal(await page.getByRole('button',{name:'Показать ещё'}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[], 'SSR hydration and interaction must not produce browser errors');
  await page.screenshot({path:out+'/'+width+'.png'});
  await pages.getByRole('link',{name:'Страница 2',exact:true}).click();
  await page.getByText('Показано 24 из 60').waitFor();
  assert.equal(await page.locator('article').count(),24);assert.equal(await page.locator('article').first().innerText(),'Автомобиль 25');
  assert.match(page.url(),/page=2/);
  await page.getByRole('button',{name:'Показать ещё'}).click();await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Показать ещё'}).click();await page.getByText('Показано 36 из 60').waitFor();
  assert.equal(await page.locator('article').count(),36);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Desktop/mobile append, retry, final batch and back/scroll restoration passed');
}finally{await browser.close();server.close();}
