import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
import {build} from 'esbuild';import postcss from 'postcss';import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/dealer-map';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/dealer-map-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',outfile:out+'/app.js',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'next',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='next/link'?"import React from 'react';export default p=>React.createElement('a',p)":"export const useRouter=()=>({});export const usePathname=()=>'/';export const useSearchParams=()=>new URLSearchParams();",loader:'jsx',resolveDir:process.cwd()}));}}]});
const css=await postcss([tailwindcss({content:['tests/browser/dealer-map-fixture.tsx','apps/web/components/dealers/**/*.tsx','apps/web/components/home/**/*.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;body{margin:0;font-family:Arial;background:var(--ac-bg);color:var(--ac-text)}html{--ac-bg:#171f2a;--ac-surface:#25303d;--ac-text:#fff;--ac-muted:#b8c0cd;--ac-border:#465368}html[data-theme=light]{--ac-bg:#f5f6f8;--ac-surface:#fff;--ac-text:#18212e;--ac-muted:#586374;--ac-border:#d3d9e2}select,input,textarea{color:var(--ac-text);background:var(--ac-surface)}',{from:undefined});
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);return;}let file=u.pathname==='/app.js'?out+'/app.js':/^\/(dealers|buyers|brands)\//.test(u.pathname)?'apps/web/public'+u.pathname:null;if(file&&!fs.existsSync(file)&&/^\/buyers\/webp\/\d+-\d+\.webp$/.test(u.pathname))file='apps/web/public'+u.pathname.replace(/\/webp\/(\d+)-\d+\.webp$/,'/$1.jpg');if(!file||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.png')?'image/png':'image/webp');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{for(const width of [390,1440])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://yandex.ru/map-widget/**',r=>r.fulfill({contentType:'text/html',body:'<html lang="ru"><body>Яндекс Карты — тест виджета</body></html>'}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 await page.locator('.dealer-profile-hero img').first().evaluate(img=>img.decode());
 if(width>700){const box=await page.locator('.dealer-profile-hero').boundingBox();assert.ok(box.height<=360,'Cover has a bounded height');const profile=await page.locator('.dealer-profile').boundingBox();assert.equal(profile.width,width); }
 await page.locator('.ac-buyers-rail').scrollIntoViewIfNeeded();await page.locator('.ac-buyers-rail img').first().evaluate(img=>img.decode());await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:`${out}/profile-${theme}-${width}.png`});
 assert.equal(await page.locator('.dealer-profile a[href^="tel:"]').count(),0);
 assert.equal(await page.locator('.dealer-profile').getByText('+79991234567').count(),0);
 assert.ok((await page.locator('.dealer-profile a[href*="/request?dealer="]').first().getAttribute('href')).includes('dealer_topavto'));
 await page.getByRole('button',{name:'Адреса',exact:true}).click();
 assert.equal(await page.locator('iframe').count(),0);
 await page.getByRole('button',{name:'Показать Яндекс Карту',exact:true}).click();
 let url=new URL(await page.locator('iframe').getAttribute('src'));assert.equal(url.searchParams.get('text'),'Новокузнецк, ТРК Планета');
 await page.getByLabel('Выберите офис').selectOption('point');url=new URL(await page.locator('iframe').getAttribute('src'));assert.equal(url.searchParams.get('pt'),'37.61,55.75,pm2rdm');
 await page.getByRole('button',{name:'Использовать новый баннер TopAvto',exact:true}).click();assert.ok(await page.locator('img[src="/dealers/topavto-banner-v3.webp"]').count()>1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 await page.screenshot({path:`${out}/${theme}-${width}.png`});console.log(`${theme} ${width}: map activation, office switching, banner selection, no overflow/errors OK`);await page.close();
}}finally{await browser.close();server.close();}
