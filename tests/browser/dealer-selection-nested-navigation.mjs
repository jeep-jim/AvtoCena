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
const out = "artifacts/dealer-selection-nested";
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
              : `const navigate=(url)=>{const u=new URL(url,location.origin);if(new URLSearchParams(location.search).has("visitor"))u.searchParams.set("visitor","1");const commit=()=>{history.pushState({},"",u);window.dispatchEvent(new Event("fixture:navigate"));if(window.fixtureDelay)window.scrollTo({top:0,behavior:"instant"});};if(window.fixtureDelay)setTimeout(commit,window.fixtureDelay);else commit();};const router={push:navigate,replace:navigate,prefetch:()=>{},back:()=>{}};export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>router;`,
          loader: "jsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const css=await postcss([tailwindcss({content:['apps/web/components/**/*.tsx']})]).process(['globals.css','catalog-ui.css','select-controls.css','public-polish.css','flat-ui.css','public-regression-fixes.css','public-price-sheet-fix.css','catalog-filter-compact.css'].map(f=>fs.readFileSync('apps/web/app/'+f,'utf8')).join('\n')+'\n@tailwind base;@tailwind components;@tailwind utilities;', {from:undefined});
let shares=[];let delay=0;
const server=http.createServer(async(req,res)=>{
 if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css.css);return;}
 if(/^\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(req.url)&&fs.existsSync(path.join(out,req.url.slice(1)))){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(out,req.url.slice(1))));return;}
 if(req.url==='/api/share'){let body='';for await(const c of req)body+=c;shares.push(JSON.parse(body));await new Promise(r=>setTimeout(r,delay));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:'/s/'+String(shares.length).padStart(16,'0')}));return;}
 if(req.url.startsWith('/api/catalog/colors')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,colors:['Белый','Чёрный']}));return;}
 if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({count:0,rating:null,items:[]}));return;}
 res.setHeader('Content-Type','text/html');res.end('<html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
async function openFilters(page,width){if(width===390)await page.evaluate(()=>window.dispatchEvent(new CustomEvent('avtocena:dealer-selection-filters',{detail:{dealerId:'external'}})));}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true});
 await page.addInitScript(()=>{window.rewinds=[];const go=history.go.bind(history);history.go=(delta)=>{window.rewinds.push(delta);go(delta);};});
 await page.goto(origin+'/test/dealer?make=Audi&budget=2500000&city=Новокузнецк&selection=1#catalog');
 await page.getByRole('button',{name:'Поделиться подборкой',exact:true}).waitFor();
 await openFilters(page,390);
 const sheet=page.getByRole('dialog',{name:'Фильтры каталога'});
 await sheet.getByRole('searchbox',{name:'Модель автомобиля',exact:true}).click();
 const models=page.getByRole('dialog',{name:'Выбор моделей'});await models.waitFor();
 await page.evaluate(()=>{window.rewinds=[];window.dispatchEvent(new CustomEvent('avtocena:catalog-navigation',{detail:{href:'/test/dealer?make=Audi&model=Q5&selection=1'}}));});
 await models.getByRole('button',{name:'Закрыть список моделей',exact:true}).click();
 await page.waitForTimeout(100);
 assert.deepEqual(await page.evaluate(()=>window.rewinds),[], 'closing a nested model picker must not rewind/cancel pending catalog navigation');
 assert.equal(await sheet.isVisible(),true);
 await page.evaluate(()=>history.back());
 await sheet.waitFor({state:'hidden'});
 assert.equal(new URL(page.url()).pathname,'/test/dealer');
 assert.equal(new URL(page.url()).searchParams.get('budget'),'2500000');
 assert.equal(new URL(page.url()).searchParams.get('selection'),'1');
 await page.evaluate(()=>{window.layerScans=0;const query=document.querySelectorAll.bind(document);document.querySelectorAll=(selector)=>{if(selector.includes('[data-back-layer]'))window.layerScans++;return query(selector);};});
 for(let i=0;i<10;i++){await page.evaluate(()=>{const card=document.createElement('div');card.className='photo-loaded';document.body.append(card);card.style.opacity='0.9';card.remove();});}
 assert.equal(await page.evaluate(()=>window.layerScans),0,'unrelated card mutations must not rescan all overlays');
 console.log('nested selection navigation, outer Back and unrelated DOM updates passed');
 await page.close();
}finally{await browser.close();server.close();}
