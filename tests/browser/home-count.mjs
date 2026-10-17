import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out='artifacts/home-count';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/home-count-fixture.tsx'],bundle:true,splitting:true,format:'esm',platform:'browser',jsx:'automatic',outdir:out,entryNames:'fixture',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'next',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='next/link'?`import React from 'react';export default function Link(props){return React.createElement('a',props)}`:`export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>({push:()=>{},replace:()=>{},prefetch:()=>{},back:()=>{}});`,loader:'jsx',resolveDir:process.cwd()}));}}]});
const publicCss=['select-controls.css','globals.css','catalog-ui.css','public-polish.css','flat-ui.css','public-regression-fixes.css'].map(f=>fs.readFileSync('apps/web/app/'+f,'utf8')).join('\n')+'\n'+fs.readFileSync('apps/web/app/(crm)/crm-responsive.css','utf8');
const css=await postcss([tailwindcss({content:['tests/browser/home-count-fixture.tsx','apps/web/components/{catalog,sharing,layout,home,autocalc}/**/*.tsx']})]).process(publicCss+'\n@tailwind base;@tailwind components;@tailwind utilities;html{--ac-surface:#fff;--ac-surface-2:#e7eaf0;--ac-text:#171c24;--ac-muted:#68758a;--ac-border:#ccd0d8;background:var(--ac-surface);color:var(--ac-text)}html[data-theme=dark]{--ac-surface:#1b222c;--ac-surface-2:#303b4c;--ac-text:#fff;--ac-muted:#b8c0cd;--ac-border:#465368}',{from:undefined});fs.writeFileSync(`${out}/app.css`,css.css);
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(['/','/autocalc'].includes(u.pathname)){res.setHeader('Content-Type','text/html');res.end(html);return;}const base=/^\/(buyers|pdf-flags|brands|avatars|logo)\//.test(u.pathname)?path.resolve('apps/web/public'):path.resolve(out);const file=path.resolve(base,'.'+u.pathname);if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});const results=[];
try {
 for(const width of [390,1440])for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:950}}), page=await context.newPage();
  const calls=[], errors=[]; let mode='normal';
  page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER',e.message);});
  await page.addInitScript(()=>{localStorage.setItem('avtocena_cookie_notice_acknowledged_v1','1');});
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/catalog/search'&&url.searchParams.get('countOnly')==='1') {
    calls.push(url.searchParams.toString());
    if(mode==='error')return route.fulfill({status:503,json:{error:'unavailable'}});
    if(mode==='invalid')return route.fulfill({json:{ok:true}});
    const budget=Number(url.searchParams.get('budgetTo'));
    if(budget===1500000)await new Promise(r=>setTimeout(r,900));
    return route.fulfill({json:{ok:true,total:mode==='zero'?0:budget===1500000?150:200}});
   }
   return route.fulfill({json:{ok:true,items:[],total:100000,marketCounts:{},rates:[],user:null}});
  });
  await page.goto(origin);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.locator('#form').waitFor().catch(async error=>{console.error(await page.locator('body').innerText());await page.screenshot({path:`${out}/failure.png`});throw error;});
  const badge=page.locator('#form').getByText(/Нашли|Считаем варианты|Количество уточняется/);
  await badge.getByText(/Нашли/).count();
  assert.match(await badge.textContent(),/100/);
  const city=page.locator('h1').getByRole('button',{name:/Выбрать город/});
  await city.click();let dialog=page.getByRole('dialog',{name:'Выбор города',exact:true});
  await dialog.getByRole('textbox',{name:'Поиск города'}).pressSequentially('Новокуз',{delay:220});
  await dialog.getByRole('button',{name:/Новокузнецк/}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(await city.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  await page.waitForTimeout(300);assert.equal(calls.length,0,'city typing/selection without budget must not search');
  async function chooseBudget(label) {
   const trigger=page.locator('#form button.ac-filter-control:visible').first();
   await trigger.click();await page.locator('#form').getByRole('button',{name:label,exact:true}).last().click();
  }
  await chooseBudget('до 1 500 000 ₽');
  await page.waitForTimeout(250);assert.equal(calls.length,1);
  await chooseBudget('до 2 000 000 ₽');await page.waitForFunction(()=>document.querySelector('#form').textContent.includes('Нашли 200 вариантов'));
  await page.waitForTimeout(1000);assert.match(await badge.textContent(),/Нашли 200 вариантов/,'late response cannot overwrite latest budget');assert.equal(calls.length,2);
  await city.click();await page.getByRole('button',{name:'Не выбирать город',exact:true}).click();
  await page.waitForTimeout(350);assert.equal(calls.length,3);assert.ok(!new URLSearchParams(calls.at(-1)).has('city'));
  mode='error';await chooseBudget('до 3 000 000 ₽');await page.getByText('Количество уточняется',{exact:true}).waitFor();assert.ok(!/Нашли 0/.test(await badge.textContent()));
  mode='invalid';await chooseBudget('до 4 000 000 ₽');await page.getByText('Количество уточняется',{exact:true}).waitFor();
  mode='zero';await chooseBudget('до 5 000 000 ₽');await page.getByText('Нашли 0 вариантов',{exact:true}).waitFor();
  await chooseBudget('Любой бюджет');assert.match(await badge.textContent(),/100/);
  const footer=page.locator('footer.ac-public-legal-footer');
  assert.equal(await footer.getByRole('link',{name:'Автокаталог',exact:true}).getAttribute('href'),'/cars/autocatalog');
  const login=footer.locator('a[href="/login"]');assert.equal(await login.count(),1);assert.equal(await login.textContent(),'Дилер');
  assert.equal(await login.evaluate(e=>getComputedStyle(e).textDecorationLine),'none');
  await city.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert.ok(await city.evaluate(e=>document.activeElement===e));assert.equal(await city.evaluate(e=>getComputedStyle(e).outlineWidth),'2px');
  await page.screenshot({path:`${out}/${width}-${theme}.png`,fullPage:true});assert.deepEqual(errors,[]);
  results.push({width,theme,calls:calls.length,staleResponse:true,errorNotZero:true,footer:true});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));}
