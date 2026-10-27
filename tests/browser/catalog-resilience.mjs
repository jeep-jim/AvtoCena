import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/catalog-resilience';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/catalog-resilience-fixture.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/app.js',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/next\/navigation|DealerBrowsingContext$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path.includes('navigation')?'export const useRouter=()=>({refresh:()=>window.retry()});':`import React from 'react';export const useDealerBrowsing=()=>null;export const DealerLink=({prefetch,...props})=><a {...props}/>;`}));
}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?fs.readFileSync(out+'/app.js'):'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByText('Машина 1',{exact:false}).waitFor();await page.getByRole('button',{name:'Выбрать',exact:true}).click();
 await page.getByLabel('Марка').selectOption('Hyundai');await page.getByRole('button',{name:'Повторить'}).waitFor();
 assert.equal(await page.getByLabel('Марка').inputValue(),'Hyundai');assert.equal(await page.locator('article').count(),1);
 await page.getByText('Выбрано',{exact:true}).waitFor();assert.ok((await page.getByRole('status').innerText()).includes('не соответствует новым условиям'));
 assert.equal(await page.locator('.ac-pagination').isVisible(),false);assert.equal(await page.locator('.ac-catalog-more').isVisible(),false);
 assert.equal(await page.getByRole('link',{name:'Другой раздел'}).getAttribute('href'),'/other');
 assert.equal(await page.getByRole('link',{name:'Оставить заявку'}).getAttribute('href'),'/request');
 await page.screenshot({path:`${out}/${width}-retained.png`});
 await page.getByRole('button',{name:'Повторить'}).click();await page.getByText('Машина 2',{exact:false}).waitFor();assert.equal(await page.locator('[data-catalog-unavailable]').count(),0);
 await page.getByLabel('Марка').selectOption('Все');await page.getByRole('button',{name:'Повторить'}).waitFor();await page.clock.fastForward(120001);
 assert.equal(await page.locator('article').count(),0);await page.getByRole('heading',{name:'Каталог временно недоступен'}).waitFor();
 await page.getByRole('button',{name:'Повторить'}).click();await page.getByText('Машина 2',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Другой каталог'}).click();assert.equal(await page.locator('article').count(),0,'never show another catalog or dealer snapshot');
 await page.getByRole('button',{name:'Пустой успешный поиск'}).click();await page.getByText('Совпадений нет',{exact:false}).waitFor();assert.equal(await page.locator('[data-catalog-unavailable]').count(),0);
 assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/${width}-empty.png`});await page.close();
}console.log('Catalog failure/retry, selected filters, retained state, expiry, scope isolation and real empty results PASS desktop/mobile');}finally{await browser.close();server.close();}
