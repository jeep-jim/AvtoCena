import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out='artifacts/autocalc';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/autocalc-fixture.tsx'],bundle:true,splitting:true,format:'esm',platform:'browser',jsx:'automatic',outdir:out,entryNames:'fixture',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'next',setup(b){b.onResolve({filter:/PublicHeader$/},args=>({path:args.path,namespace:'header'}));b.onLoad({filter:/.*/,namespace:'header'},()=>({contents:`export function PublicHeader(){return null}`,loader:'jsx'}));b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='next/link'?`import React from 'react';export default function Link(props){return React.createElement('a',props)}`:`export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>({push:()=>{},replace:()=>{}});`,loader:'jsx',resolveDir:process.cwd()}));}}]});
const css=await postcss([tailwindcss({content:['tests/browser/autocalc-fixture.tsx','apps/web/components/{catalog,sharing,layout,home,autocalc}/**/*.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;html{--ac-surface:#fff;--ac-surface-2:#e7eaf0;--ac-text:#171c24;--ac-muted:#68758a;--ac-border:#ccd0d8;background:var(--ac-surface);color:var(--ac-text)}html[data-theme=dark]{--ac-surface:#1b222c;--ac-surface-2:#303b4c;--ac-text:#fff;--ac-muted:#b8c0cd;--ac-border:#465368}',{from:undefined});fs.writeFileSync(`${out}/app.css`,css.css);
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(['/','/autocalc'].includes(u.pathname)){res.setHeader('Content-Type','text/html');res.end(html);return;}const base=/^\/(buyers|pdf-flags|brands)\//.test(u.pathname)?path.resolve('apps/web/public'):path.resolve(out);const file=path.resolve(base,'.'+u.pathname);if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const results=[];
try{
 for(const width of [390,1440])for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('avtocena_city','Новокузнецк'));
  await page.route('**/api/autocalc',async route=>{const b=route.request().postDataJSON();await route.fulfill({json:b.action==='extract'?{title:'Toyota Corolla',market:'georgia',price:'12000',currency:'USD',images:[],draft:{year:'2022',fuel:'petrol',engineCc:'1800',powerHp:'140'},message:'Проверьте данные'}:{totalRub:1900000,breakdown:[{id:'car',title:'Цена автомобиля',amountRub:1200000},{id:'other',title:'Расходы',amountRub:700000}],rateDate:'2026-09-27',warnings:[]}});});
  await page.goto(origin+'/autocalc');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  assert.ok(await page.locator('#autocalc-url').evaluate(e=>e.getBoundingClientRect().height>=44),'URL input keeps a touch-sized height');
  await page.locator('#autocalc-url').fill('https://myauto.ge/car/123');await page.getByRole('button',{name:'Получить данные',exact:true}).click();await page.getByRole('heading',{name:'Toyota Corolla',exact:true}).waitFor();
  await page.getByRole('button',{name:'Рассчитать под ключ',exact:true}).click();await page.getByText('1 900 000 ₽',{exact:true}).waitFor();
  await page.screenshot({path:`${out}/card-${width}-${theme}.png`,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No horizontal overflow');
  await page.getByLabel('Цена автомобиля в объявлении *').fill('13000');assert.equal(await page.getByText('1 900 000 ₽',{exact:true}).count(),0,'price edit invalidates previous result');
  await page.getByRole('button',{name:'АвтоРасчёт',exact:true}).click();const modal=page.getByRole('dialog');await modal.waitFor();await page.screenshot({path:`${out}/dialog-${width}-${theme}.png`});await page.keyboard.press('Escape');assert.equal(await modal.count(),0);assert.deepEqual(errors,[]);
  results.push({width,theme,calculation:true,invalidation:true,dialog:true});await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));}
console.log(JSON.stringify(results));
