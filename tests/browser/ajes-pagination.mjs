import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/ajes-pagination';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/ajes-pagination-fixture.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:`${out}/app.js`,plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'nav'}));
 b.onLoad({filter:/.*/,namespace:'nav'},()=>({contents:"export const usePathname=()=>'/cars';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({});"}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'stub'}));
 b.onLoad({filter:/link/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(props){return React.createElement('a',props)}",resolveDir:process.cwd()}));
 b.onResolve({filter:/(?:catalog|green-corner)-load-more-action$/},()=>({path:'action',namespace:'stub'}));
 b.onLoad({filter:/action/,namespace:'stub'},()=>({contents:`export async function loadMoreCatalog(query,page,after){window.calls=(window.calls||[]).concat([{query,page,after}]);return {page,total:null,ids:Array(24).fill('car'),cards:'Следующие 24 автомобиля',hasMore:page<3,nextCursor:query.market==='china'?(page===2?'12.16':null):undefined}};export const loadMoreGreenCorner=loadMoreCatalog;`}));
}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?fs.readFileSync(`${out}/app.js`):'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const href=await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href');
  assert.equal(new URL(href,'http://local').searchParams.get('after'),'6.20');
  await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
  await page.getByText('Показано 48',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls[0].after),'6.20');
  assert.equal(new URL(await page.getByRole('link',{name:'Страница 3',exact:true}).getAttribute('href'),'http://local').searchParams.get('after'),'12.16');
  assert.equal(new URL(await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href'),'http://local').searchParams.get('after'),'6.20');
  await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
  await page.getByText('Вы посмотрели все доступные предложения').waitFor();
  assert.equal(await page.getByRole('button',{name:'Показать ещё',exact:true}).count(),0);
  assert.equal(await page.locator('[data-catalog-batch]').count(),3);
  assert.deepEqual(errors,[]);
  await page.goto(`http://127.0.0.1:${server.address().port}/?market=europe`);
  assert.ok(await page.getByRole('link',{name:'Страница 15',exact:true}).isVisible());
  assert.ok(!(await page.getByRole('link',{name:'Страница 2',exact:true}).getAttribute('href')).includes('after='));
  for(const market of ['korea','japan']){
   await page.goto(`http://127.0.0.1:${server.address().port}/?market=${market}&late=1`);
   const total=market==='korea'?89027:615568,last=Math.ceil(total/24);
   assert.equal(await page.getByRole('link',{name:'Страница '+last,exact:true}).count(),0);
   await page.getByRole('button',{name:'Получить количество',exact:true}).click();
   await page.getByRole('link',{name:'Страница '+last,exact:true}).waitFor();
   for(const n of [1,2,3,4,5,last])assert.equal(await page.getByRole('link',{name:'Страница '+n,exact:true}).count(),1);
   const href=new URL(await page.getByRole('link',{name:'Страница 3',exact:true}).getAttribute('href'),'http://local');
   assert.equal(href.searchParams.get('city'),'Новокузнецк');assert.equal(href.searchParams.get('after'),null);
   await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
   await page.getByText('Показано 48',{exact:false}).waitFor();
   assert.equal(await page.getByRole('link',{name:'Страница '+last,exact:true}).count(),1,'unknown append total must preserve the independently resolved aggregate');
   assert.equal(await page.getByText('Количество уточняется',{exact:true}).count(),0);
   await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
   await page.getByText('Показано 72',{exact:false}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.calls.map(x=>x.page)),[2,3]);
   await page.getByRole('button',{name:'Другой фильтр',exact:true}).click();
   await page.getByText('Количество уточняется',{exact:true}).waitFor();
   assert.equal(await page.getByRole('link',{name:'Страница '+last,exact:true}).count(),0,'old-query count must never apply to new filters');
  }
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('Cursor links, append, termination and standard numbered pages passed at 390/1440px');
}finally{await browser.close();await new Promise(r=>server.close(r));}
