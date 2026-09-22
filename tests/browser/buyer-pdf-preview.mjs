import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { offerPdfData, renderOfferPdf } from '../../apps/web/lib/catalog/offer-pdf.ts';
const {chromium,webkit} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out='artifacts/buyer-pdf-preview';fs.mkdirSync(out,{recursive:true});
const pdf = await renderOfferPdf(offerPdfData({id:'qa-preview',market:'korea',make:'Hyundai',model:'Avante',sourcePrice:20000000,sourceCurrency:'KRW',sellerPriceRub:1200000},{year:'2020',engineCc:'1499',fuel:'petrol',powerHp:'150',deliveryCity:'Новокузнецк'},null));
await build({entryPoints:['tests/browser/buyer-pdf-fixture.tsx'],bundle:true,splitting:true,format:'esm',platform:'browser',jsx:'automatic',outdir:out,entryNames:'fixture',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'next-dynamic',setup(b){b.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`import React,{lazy,Suspense} from 'react';export default function dynamic(loader){const Component=lazy(loader);return props=>React.createElement(Suspense,{fallback:null},React.createElement(Component,props));}`,loader:'jsx',resolveDir:process.cwd()}));}}]});
const css=await postcss([tailwindcss({content:['tests/browser/buyer-pdf-fixture.tsx','apps/web/components/catalog/OfferPdf{Button,Preview}.tsx','apps/web/components/home/BuyerGallery.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;html{--ac-surface:#fff;--ac-surface-2:#e7eaf0;--ac-text:#171c24;--ac-border:#ccd0d8;background:var(--ac-surface);color:var(--ac-text)}html[data-theme=dark]{--ac-surface:#1b222c;--ac-surface-2:#303b4c;--ac-text:#fff;--ac-border:#465368}',{from:undefined});fs.writeFileSync(`${out}/app.css`,css.css);
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}const base=url.pathname.startsWith('/buyers/')||url.pathname.startsWith('/pdfjs/')?path.resolve('apps/web/public'):path.resolve(out);const file=path.resolve(base,'.'+url.pathname);if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=process.env.BROWSER==='webkit'?await webkit.launch():await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[];
try{
 for(const width of [320,390,1440])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:2,isMobile:width<500,hasTouch:width<500,acceptDownloads:true});const page=await context.newPage();const errors=[],requests=[],downloads=[];
  page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log(m.type(),m.text());});page.on('pageerror',e=>errors.push(String(e)));page.on('download',d=>downloads.push(d));page.on('request',r=>requests.push(r.url()));
  const drafts=[];let fail=false;
  await page.route('**/api/catalog/offer/qa-preview/pdf',async route=>{drafts.push(route.request().postDataJSON().draft);await new Promise(r=>setTimeout(r,350));await route.fulfill(fail?{status:500,json:{error:'Проверочная ошибка'}}:{status:200,headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="qa.pdf"'},body:pdf});});
  await page.goto(origin);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.locator('.ac-buyers-rail img').first().waitFor();await page.waitForFunction(()=>document.querySelector('.ac-buyers-rail img')?.naturalWidth>0);
  assert.ok(!requests.some(url=>/\/buyers\/\d+\.jpg/.test(url)),'homepage must not request original JPEGs');
  assert.ok(!requests.some(url=>url.includes('/pdfjs/')),'PDF worker must not load before preview');
  // The rail moves continuously; use a real pointer tap instead of waiting for a stationary element.
  const point=await page.locator('.ac-buyers-rail').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+Math.min(90,r.width/2),y:r.top+Math.min(50,r.height/2)};});
  if(width<500)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);const gallery=page.getByRole('dialog',{name:'Фотографии клиентов TopAvto'});await gallery.waitFor();await page.waitForFunction(()=>document.querySelector('[role=dialog] img')?.naturalWidth>0);
  assert.match(await gallery.locator('img').first().getAttribute('src'),/-1280.webp$/);if(width===390&&theme==='light')await page.screenshot({path:`${out}/buyer-photo.png`});await gallery.getByRole('button',{name:'Закрыть',exact:true}).click();
  const trigger=page.getByRole('button',{name:'PDF текущей карточки'}).filter({visible:true});
  await trigger.click();await page.getByRole('button',{name:'Просмотреть',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'Предпросмотр PDF',exact:true});await preview.waitFor();await preview.locator('canvas[data-rendered=true]').waitFor({timeout:60000});
  const initialCanvas=await preview.locator('canvas').evaluate(c=>c.toDataURL());if(width===390&&theme==='light')await page.screenshot({path:`${out}/before-zoom.png`});assert.equal(downloads.length,0,'preview must not download');assert.equal(context.pages().length,1,'preview stays on site without popup/native PDF navigation');
  assert.ok(await preview.locator('canvas').evaluate(c=>{const ctx=c.getContext('2d');const d=ctx.getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<d.length;i+=16)if(d[i]<150&&d[i+1]<150&&d[i+2]<150)dark++;return dark>200;}),'real PDF pixels rendered');
  await preview.locator('[data-pdf-page] a').first().waitFor({state:'visible'});assert.ok(await preview.locator('[data-pdf-page] a').count()>0,'document links retained');
  await preview.getByRole('button',{name:'Увеличить PDF',exact:true}).click();await preview.locator('canvas[data-rendered=true]').waitFor();
  await preview.getByRole('button',{name:'Уменьшить PDF',exact:true}).click();await preview.locator('canvas[data-rendered=true]').waitFor();
  await preview.locator('summary').click();const checks=preview.getByRole('checkbox');assert.equal(await checks.count(),3);for(let i=0;i<3;i++)assert.equal(await checks.nth(i).isChecked(),true);
  await checks.first().uncheck();await preview.locator('canvas[data-rendered=true][data-revision="1"]').waitFor();await checks.first().check();await preview.locator('canvas[data-rendered=true][data-revision="2"]').waitFor();await preview.locator('summary').click();
  assert.ok((await preview.locator('canvas').evaluate(c=>c.toDataURL()))===initialCanvas,'zoom and layer toggles must restore every pixel, including photos and logos');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow');
  await page.screenshot({path:`${out}/${process.env.BROWSER||'chromium'}-${width}-${theme}.png`});
  const pending=page.waitForEvent('download');await preview.getByRole('link',{name:'Скачать',exact:true}).click();const download=await pending;const saved=`${out}/download-${width}-${theme}.pdf`;await download.saveAs(saved);assert.deepEqual(fs.readFileSync(saved),pdf,'explicit download is the same PDF');
  await preview.getByRole('button',{name:'Закрыть предпросмотр'}).click();
  await page.getByRole('textbox',{name:'Год автомобиля'}).fill('2021');await trigger.click();await page.getByRole('button',{name:'Просмотреть',exact:true}).click();await preview.locator('canvas[data-rendered=true]').waitFor({timeout:60000});assert.equal(drafts.at(-1).year,'2021','preview uses current unsaved draft');assert.equal(downloads.length,1,'second preview does not download');await preview.getByRole('button',{name:'Закрыть предпросмотр'}).click();
  fail=true;await trigger.click();await page.getByRole('button',{name:'Просмотреть',exact:true}).click();await page.getByRole('alert').filter({hasText:'Проверочная ошибка'}).waitFor();assert.equal(context.pages().length,1);assert.equal(downloads.length,1);assert.deepEqual(errors,[]);
  results.push({width,theme,previewWithoutDownload:true,currentDraft:true,layers:3,imageRequests:requests.filter(url=>url.includes('/buyers/')).length});await context.close();
 }
}finally{fs.writeFileSync(`${out}/${process.env.BROWSER||'chromium'}-results.json`,JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify(results));
