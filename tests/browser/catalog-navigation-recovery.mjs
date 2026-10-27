import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/catalog-navigation-recovery';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/catalog-navigation-recovery-fixture.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:`${out}/app.js`,plugins:[{name:'next-fixture',setup(b){
 b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'next'}));
 b.onLoad({filter:/.*/,namespace:'next'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path==='next/link'?`import React from 'react';export default function Link({prefetch,scroll,children,...props}){return <a {...props}>{children}</a>}`:`const router={push(url){window.__fixtureNavigate(url)},prefetch(){}};export const useRouter=()=>router;export const usePathname=()=>'/cars/offer/rexton';export const useSearchParams=()=>new URLSearchParams();`}));
 b.onResolve({filter:/(?:catalog|green-corner)-load-more-action$/},()=>({path:'action',namespace:'action'}));
 b.onLoad({filter:/.*/,namespace:'action'},()=>({loader:'tsx',resolveDir:process.cwd(),contents:`import React from 'react';let attempt=0;export const loadMoreGreenCorner=loadMoreCatalog;export async function loadMoreCatalog(q,page,after){(window.__reads||=[]).push({q,page,after});await new Promise(r=>setTimeout(r,500));if(page===1&&attempt++===0)throw Error('temporary');return {page,total:null,incomplete:false,hasMore:page===1,nextCursor:page===1?'2.0':null,ids:Array.from({length:24},(_,i)=>String((page-1)*24+i)),cards:Array.from({length:24},(_,i)=><article key={i}>Автомобиль {(page-1)*24+i}</article>)}}`}));
}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?fs.readFileSync(`${out}/app.js`):'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#1b222c;color:white;font:16px sans-serif}a,button{display:inline-block;background:#444;color:white;padding:10px}article{padding:4px}.sr-only{position:absolute;clip:rect(0,0,0,0)}.ac-catalog-more{position:relative}.ac-catalog-more__candy{position:absolute;inset:0;background:repeating-linear-gradient(120deg,#f33 0 24px,#fff 24px 32px)}.ac-catalog-more__label{position:relative;background:#333}</style><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByText('Показаны сохранённые автомобили.',{exact:false}).waitFor();
 assert.equal(await page.getByText('Вы посмотрели все доступные предложения').count(),0);
 assert.equal(await page.locator('article').count(),24);
 await page.getByRole('button',{name:'Повторить',exact:true}).click();
 await page.getByRole('button',{name:'Обновляем список'}).waitFor();
 assert.equal(await page.locator('.ac-route-loader[aria-hidden="false"]').count(),0);
 await page.getByRole('alert').waitFor();assert.equal(await page.locator('article').count(),24);
 await page.getByRole('button',{name:'Повторить',exact:true}).click();await page.getByText('Автомобиль 0',{exact:true}).waitFor();
 assert.equal(await page.locator('article').count(),24,'retry replaces the partial page without duplicate rows');
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();await page.getByRole('button',{name:'Загружаем варианты'}).waitFor();
 assert.equal(await page.locator('.ac-route-loader[aria-hidden="false"]').count(),0);
 await page.getByText('Показано 48',{exact:true}).waitFor();assert.equal(await page.locator('article').count(),48);
 const reads=await page.evaluate(()=>window.__reads);assert.deepEqual(reads.map(x=>[x.page,x.after]),[[1,undefined],[1,undefined],[2,'2.0']]);assert.ok(reads.every(x=>x.q.drive==='awd'&&x.q.city==='Новокузнецк'));
 const link=page.getByRole('link',{name:'Все из Кореи',exact:true});await link.click();
 await page.getByText('Открываем…',{exact:true}).waitFor();assert.equal(await page.locator('.ac-route-loader[aria-hidden="false"]').count(),0);
 assert.equal(await page.locator('article').count(),48,'navigation retains the source page while the target is pending');
 await page.getByRole('link',{name:/Все из Кореи/}).click();assert.equal((await page.evaluate(()=>window.__pushes)).length,1,'second click does not duplicate navigation');
 assert.match((await page.evaluate(()=>window.__pushes))[0],/market=korea/);
 await page.screenshot({path:`${out}/${width}-pending.png`});await page.locator('#resolve').click();await page.getByRole('heading',{name:'Корея Rexton'}).waitFor();
 assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}: partial retry/replace, AWD cursor append, local category pending and single navigation`);
}}finally{await browser.close();server.close();}
