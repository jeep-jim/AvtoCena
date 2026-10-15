import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = "artifacts/dealer-selection";
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/browser/dealer-selection-fixture.tsx"],
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outdir: out,
  entryNames: "fixture",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [
    {
      name: "next",
      setup(b) {
        b.onResolve({ filter: /^next\/(link|navigation|dynamic)$/ }, (args) => ({
          path: args.path,
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents:
            args.path === "next/dynamic" ? `export default function dynamic(){return ()=>null;}` : args.path === "next/link"
              ? `import React from 'react';export default function Link(props){return React.createElement('a',props)}`
              : `const navigate=(url)=>{const u=new URL(url,location.origin);if(new URLSearchParams(location.search).has("visitor"))u.searchParams.set("visitor","1");history.pushState({},"",u);window.dispatchEvent(new Event("fixture:navigate"));};const router={push:navigate,replace:navigate,prefetch:()=>{},back:()=>{}};export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>router;`,
          loader: "jsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const css=await postcss([tailwindcss({content:['apps/web/components/**/*.tsx']})]).process(['globals.css','catalog-ui.css','select-controls.css','public-polish.css','flat-ui.css','public-regression-fixes.css'].map(f=>fs.readFileSync('apps/web/app/'+f,'utf8')).join('\n')+'\n@tailwind base;@tailwind components;@tailwind utilities;', {from:undefined});
let shares=[];let delay=0;
const server=http.createServer(async(req,res)=>{
 if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}
 if(req.url.startsWith('/fixture')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(out,req.url.slice(1))));return;}
 if(req.url==='/api/share'){let body='';for await(const c of req)body+=c;shares.push(JSON.parse(body));await new Promise(r=>setTimeout(r,delay));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:'/s/'+String(shares.length).padStart(16,'0')}));return;}
 if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({count:0,rating:null,items:[]}));return;}
 res.setHeader('Content-Type','text/html');res.end('<html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.stack)});page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text())});
 try{
 await page.addInitScript(()=>{window.calls=[];document.cookie='avtocena_city='+encodeURIComponent('Москва')+';path=/';Object.defineProperty(navigator,'share',{value:async v=>window.calls.push(v)});Object.defineProperty(navigator,'clipboard',{value:{writeText:async v=>window.calls.push(v)}});});
 await page.goto(origin+'/test/dealer?make=Audi&budget=2500000&city=Новокузнецк&selection=1#catalog');
 const send=page.getByRole('button',{name:'Поделиться подборкой',exact:true});await send.waitFor();await page.locator('[data-city]').filter({hasText:'Новокузнецк'}).waitFor();
 await page.waitForFunction(()=>Math.abs(document.getElementById('catalog').getBoundingClientRect().top-90)<10);
 await send.click();await page.waitForFunction(()=>window.calls.length===1);const calls=await page.evaluate(()=>window.calls);const msg=typeof calls[0]==='string'?calls[0]:calls[0].text;assert.match(msg,/^Подборка вариантов по вашему запросу\nhttp:\/\/127\.0\.0\.1:\d+\/s\/[\w-]{16}$/);if(typeof calls[0]!=='string')assert.equal(calls[0].url,undefined);
 const target=new URL(shares.at(-1).path,origin);assert.equal(target.hash,'#catalog');assert.equal(target.searchParams.get('city'),'Новокузнецк');assert.equal(target.searchParams.get('budget'),'2500000');
 await page.evaluate(()=>window.scrollTo(0,900));await page.getByRole('button',{name:'Изменить фильтры подборки'}).click();
 const filterForm=width===390?page.getByRole('dialog',{name:'Фильтры каталога'}):page.locator('.ac-catalog-filter-panel');
 await filterForm.waitFor({state:'visible'});if(width===390)assert.equal(await send.isVisible(),false);
 const budget=filterForm.getByRole('textbox',{name:'Цена: до',exact:true});await budget.fill('3000000');await budget.press('Tab');
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('budget')==='3000000');assert.equal(new URL(page.url()).pathname,'/test/dealer');
 if(width===390){await page.keyboard.press('Escape');await send.waitFor({state:'visible'});assert.ok(await page.evaluate(()=>window.scrollY)>500);}
 await send.click();await page.waitForFunction(()=>window.calls.length===2);assert.equal(new URL(shares.at(-1).path,origin).searchParams.get('budget'),'3000000');await page.evaluate(()=>window.calls.pop());
 await page.screenshot({path:`${out}/${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Скрыть панель подборки'}).click();assert.equal(await send.count(),0);if(width===390)assert.equal(await page.locator('.dealer-dock').isVisible(),true);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection',{detail:{dealerId:'external',query:'make=Honda&city=Казань',pending:false,filtersOpen:false}})));await send.waitFor();await send.click();await page.waitForFunction(()=>window.calls.length===2);assert.match(shares.at(-1).path,/make=Honda/);assert.equal(new URL(shares.at(-1).path,origin).searchParams.get('city'),'Казань');
 // Changing the selection during preparation must never send the old selection.
 delay=400;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection',{detail:{dealerId:'external',query:'make=Honda&yearFrom=2024',pending:false,filtersOpen:false}})));await send.click();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection',{detail:{dealerId:'external',query:'make=Audi&yearFrom=2025',pending:false,filtersOpen:false}})));await page.getByText('Параметры изменились — поделитесь новой подборкой').waitFor();assert.equal(await page.evaluate(()=>window.calls.length),2);delay=0;
 await page.goto(origin+'/test/dealer?visitor=1&make=Audi&city=Новокузнецк&selection=1#catalog');await page.locator('#catalog').waitFor();assert.equal(await send.count(),0);assert.equal(await page.locator('[data-city]').textContent(),'Новокузнецк');assert.ok((await page.evaluate(()=>document.cookie)).includes(encodeURIComponent('Москва')));assert.deepEqual(errors,[]);console.log(`${width}: share, filters, city, anchor, dismissal, stale request and visitor visibility OK`);
 }catch(error){await page.screenshot({path:`${out}/failure-${width}.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(-3000));throw error;}finally{await page.close();}
}}finally{await browser.close();server.close();}
